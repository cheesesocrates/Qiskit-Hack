"""Tail risk by amplitude estimation (Area 1): expected loss, tail probability, VaR and CVaR.

Question answered: at the forecast peak hour, the plan sheds `quota` feeders of `feeder_mw` each,
sized for the predicted shortfall. If the real shortfall is higher, the part the plan does not
cover has to be met by an unplanned cut. How large is that uncovered shortfall in a bad hour?

Inputs (results files only, written by Area 2): `forecast.json` (day-ahead prediction and the
histogram of test-set residuals, 8 bins) and `instance.json` (feeder size, protected feeders).

Model
-----
* Scenario i = residual bin i (bin mid-point r_i, probability p_i). 8 bins -> 3 qubits.
* Loss L_i = max(0, predicted + r_i - quota * feeder_mw)  [MW not covered by the plan].
* A = StatePreparation(sqrt(p)) on the scenario register, then one objective qubit:
    expected loss    RY on pattern i with sin^2(theta_i/2) = L_i / L_max   ->  a = E[L] / L_max
    tail probability X on every pattern with L_i > 0                        ->  a = P(L > 0)
    P(L <= v)        X on every pattern with L_i <= v                       ->  used to find VaR
    CVaR numerator   RY as above, only where L_i >= VaR                     ->  a = E[L 1{L>=VaR}] / L_max
* Each amplitude is estimated with qiskit-algorithms IterativeAmplitudeEstimation on the Aer
  simulator (seeded sampler shared with counting.py) and compared with the exact classical value.

Simulator only. Three scenario qubits are trivial classically (the exact values are computed here
from the same distribution); this demonstrates the estimator, not a speed-up.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import RYGate, StatePreparation, XGate
from qiskit_algorithms import EstimationProblem

from src.quantum.counting import DEFAULT_SHOTS, make_iae
from src.quantum.io import load_json, write_result

SOURCE = "src/quantum/risk.py"
ALPHA = 0.95            # VaR / CVaR level
EPSILON = 0.005         # IAE target half-width on each amplitude
CONF_ALPHA = 0.05       # 95% confidence intervals


def _scenario_register(probs: np.ndarray) -> tuple:
    k = int(np.log2(len(probs)))
    if 2 ** k != len(probs):
        raise ValueError("the number of residual bins must be a power of two")
    amps = np.sqrt(np.asarray(probs, dtype=float) / np.sum(probs))
    return k, StatePreparation(amps)


def _circuit(prep, k: int, angles: dict | None = None, flips: list | None = None) -> QuantumCircuit:
    """Scenario register (qubits 0..k-1) + objective qubit k. Pattern i controls on index i."""
    qc = QuantumCircuit(k + 1)
    qc.append(prep, range(k))
    for i, theta in (angles or {}).items():
        if theta > 0:
            qc.append(RYGate(float(theta)).control(k, ctrl_state=int(i)), list(range(k)) + [k])
    for i in flips or []:
        qc.append(XGate().control(k, ctrl_state=int(i)), list(range(k)) + [k])
    # plain u/cx gates: Aer 0.18.2 crashed (exit 139) assembling the raw StatePreparation/controlled ops
    return transpile(qc, basis_gates=["u", "cx"], optimization_level=0)


def _estimate(qc: QuantumCircuit, k: int, seed: int) -> tuple:
    """(estimate, [ci_lo, ci_hi], oracle_queries) for P(objective qubit = 1)."""
    res = make_iae(EPSILON, CONF_ALPHA, seed).estimate(EstimationProblem(state_preparation=qc, objective_qubits=[k]))
    lo, hi = (float(v) for v in res.confidence_interval)
    return float(res.estimation), [max(lo, 0.0), min(hi, 1.0)], int(res.num_oracle_queries)


def exact_measures(losses: np.ndarray, probs: np.ndarray, alpha: float = ALPHA) -> dict:
    """VaR_alpha = smallest loss v with P(L <= v) >= alpha; CVaR = E[L | L >= VaR]."""
    order = np.argsort(losses)
    cdf = np.cumsum(probs[order])
    var = float(losses[order][np.searchsorted(cdf, alpha - 1e-12)])
    tail = losses >= var - 1e-12
    cvar = float(np.sum(losses[tail] * probs[tail]) / np.sum(probs[tail]))
    return {"expected_loss": float(np.sum(losses * probs)), "tail_prob": float(np.sum(probs[losses > 1e-12])),
            "var": var, "cvar": cvar}


def run_risk(seed: int = 7, alpha: float = ALPHA) -> Path:
    fc = load_json("forecast.json")
    inst = load_json("instance.json")
    feeder_mw = float(inst["feeder_mw"])
    critical = sorted(int(f["id"]) for f in inst["feeders"] if f["protected"])
    peak = max(fc["day_ahead"], key=lambda d: d["shortfall_pred_mw"])
    pred, quota = float(peak["shortfall_pred_mw"]), int(peak["quota"])
    capacity = quota * feeder_mw
    bins = fc["residuals"]["bins"]
    r = np.array([float(b["mid"]) for b in bins])
    p = np.array([float(b["prob"]) for b in bins])
    p = p / p.sum()
    losses = np.maximum(0.0, pred + r - capacity)
    lmax = float(losses.max())
    if lmax <= 0:
        raise RuntimeError("no residual scenario exceeds the shed capacity; the loss is zero everywhere")
    exact = exact_measures(losses, p, alpha)

    k, prep = _scenario_register(p)
    t0 = time.perf_counter()
    queries = 0
    theta = {i: 2 * np.arcsin(np.sqrt(L / lmax)) for i, L in enumerate(losses)}

    a, ci, q = _estimate(_circuit(prep, k, angles=theta), k, seed)
    queries += q
    est_el, el_ci = a * lmax, [ci[0] * lmax, ci[1] * lmax]

    a_tail, tail_ci, q = _estimate(_circuit(prep, k, flips=[i for i, L in enumerate(losses) if L > 1e-12]), k, seed + 1)
    queries += q

    # VaR: walk up the distinct loss levels until the estimated P(L <= v) reaches alpha
    var_est, cdf_trace = None, []
    for j, v in enumerate(sorted(set(np.round(losses, 12)))):
        a_cdf, cdf_ci, q = _estimate(_circuit(prep, k, flips=[i for i, L in enumerate(losses) if L <= v + 1e-12]), k, seed + 10 + j)
        queries += q
        cdf_trace.append(f"P(L<={v:.3f}) ~ {a_cdf:.4f}")
        if a_cdf >= alpha - 1e-12:
            var_est = float(v)
            break
    if var_est is None:
        var_est = lmax

    tail_idx = [i for i, L in enumerate(losses) if L >= var_est - 1e-12]
    a_num, num_ci, q = _estimate(_circuit(prep, k, angles={i: theta[i] for i in tail_idx}), k, seed + 2)
    queries += q
    a_ge, ge_ci, q = _estimate(_circuit(prep, k, flips=tail_idx), k, seed + 3)
    queries += q
    cvar_est = lmax * a_num / a_ge if a_ge > 0 else lmax
    cvar_ci = [lmax * num_ci[0] / max(ge_ci[1], 1e-12), min(lmax, lmax * num_ci[1] / max(ge_ci[0], 1e-12))]
    runtime = time.perf_counter() - t0

    def ok(x, lo_hi, ex, tol):
        return bool(lo_hi[0] - tol <= ex <= lo_hi[1] + tol or abs(x - ex) <= tol)

    tol_l = 0.02 * lmax
    within = (ok(est_el, el_ci, exact["expected_loss"], tol_l) and ok(a_tail, tail_ci, exact["tail_prob"], 0.02)
              and abs(var_est - exact["var"]) < 1e-9 and ok(cvar_est, cvar_ci, exact["cvar"], tol_l))
    scenarios = [{"label": f"residual {b['lo']:+.2f} to {b['hi']:+.2f} MW", "shortfall_extra_mw": float(ri),
                  "prob": float(pi), "loss": float(Li)} for b, ri, pi, Li in zip(bins, r, p, losses)]
    payload = {
        "method": "iterative_amplitude_estimation",
        "block": {
            "n_feeders": int(inst["n_feeders"]), "feeder_ids": [int(f["id"]) for f in inst["feeders"]],
            "critical_feeder_ids": critical,
            "description": (f"The synthetic {inst['n_feeders']}-feeder cluster of {feeder_mw:g} MW feeders at the forecast "
                            f"peak hour ({peak['hour']:02d}:00 on the day-ahead forecast): predicted shortfall "
                            f"{pred:.3f} MW, plan sheds {quota} feeders = {capacity:g} MW. Critical (protected) "
                            f"feeders {critical} are never in the plan; any shortfall the plan does not cover needs "
                            "an unplanned cut."),
        },
        "alpha": float(alpha),
        "loss_unit": "MW of shortfall not covered by the plan at the peak hour",
        "residual_source": ("results/forecast.json residuals: actual minus predicted on the ridge model's test hours, "
                            f"{len(bins)} equal-width bins (mid-points used), n={fc['residuals']['n']}"),
        "scenarios": scenarios,
        "n_qubits": k + 1,
        "epsilon_target": EPSILON,
        "confidence_alpha": CONF_ALPHA,
        "oracle_queries": int(queries),
        "exact": exact,
        "estimated": {"expected_loss": float(est_el), "expected_loss_ci": el_ci, "tail_prob": float(a_tail),
                      "tail_prob_ci": tail_ci, "var": float(var_est), "cvar": float(cvar_est), "cvar_ci": cvar_ci},
        "within_tolerance": within,
        "notes": (f"IterativeAmplitudeEstimation (qiskit-algorithms 0.4.0), epsilon_target={EPSILON} per amplitude, "
                  f"{1 - CONF_ALPHA:.0%} confidence, {DEFAULT_SHOTS} shots per round, seeded Aer sampler. "
                  f"{k} scenario qubits loaded exactly with StatePreparation, 1 objective qubit. "
                  f"VaR search: {'; '.join(cdf_trace)}. tail_prob is P(L > 0), the chance that the plan falls short "
                  f"and an unplanned cut is needed. CVaR CI combines the numerator and denominator intervals. "
                  f"Simulation time {runtime:.2f} s. Exact values come from the same discrete distribution; at "
                  f"{k} scenario qubits this is classically trivial, so no speed-up is claimed. Demand and "
                  f"shortfall are synthetic."),
    }
    return write_result("risk.json", payload, seed, SOURCE)


if __name__ == "__main__":
    print(run_risk())
