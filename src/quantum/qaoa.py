"""QAOA runner on the Aer statevector simulator (Area 1). Simulator only.

The hybrid loop is the standard one: a classical optimiser (COBYLA) proposes angles, the
Qiskit circuit is simulated on Aer, the expected cost is read from the output state.
Samples are drawn by Aer from the measured circuit with a fixed seed.
"""
from __future__ import annotations

import time

import numpy as np
from qiskit import transpile
from qiskit_aer import AerSimulator
from scipy.optimize import minimize

from src.quantum.circuits import build_qaoa
from src.quantum.problem import TOL, QProblem

LABELS = {
    "xy": "Dicke + XY-mixer QAOA",
    "grover": "Grover-mixer QAOA",
    "penalty": "Penalty QAOA (X mixer)",
}


class QAOARunner:
    def __init__(self, qp: QProblem, kind: str, p: int, seed: int = 7, penalty: float | None = None):
        self.qp, self.kind, self.p, self.seed = qp, kind, int(p), int(seed)
        built = build_qaoa(qp, kind, self.p, penalty)
        self.circuit = built["circuit"]
        self.penalty = built["penalty"]
        self.scale = built["scale"]
        self.params = list(built["gammas"]) + list(built["betas"])
        self.sim = AerSimulator(method="statevector")
        sv_circ = self.circuit.copy()
        sv_circ.save_statevector()
        self._sv = transpile(sv_circ, self.sim, optimization_level=1, seed_transpiler=self.seed)
        meas = self.circuit.copy()
        meas.measure_all()
        self._meas = transpile(meas, self.sim, optimization_level=1, seed_transpiler=self.seed)
        self.depth = int(self._meas.depth())
        self.gate_counts = {k: int(v) for k, v in self._meas.count_ops().items()}
        self.true_cost = qp.cost_vector()
        if kind == "penalty":
            off, lin, quad = qp.penalty_qubo(self.penalty)
            self.objective = qp.qubo_vector(off, lin, quad, qp._bit_table())
        else:
            self.objective = self.true_cost
        self.nfev = 0

    # ---- simulation ----------------------------------------------------------
    def _bind(self, circ, theta):
        return circ.assign_parameters(dict(zip(self.params, [float(v) for v in theta])))

    def statevector(self, theta) -> np.ndarray:
        if self.p == 0:
            theta = []
        result = self.sim.run(self._bind(self._sv, theta)).result()
        return np.asarray(result.get_statevector())

    def probabilities(self, theta) -> np.ndarray:
        return np.abs(self.statevector(theta)) ** 2

    def energy(self, theta) -> float:
        self.nfev += 1
        return float(self.probabilities(theta) @ self.objective)

    def sample(self, theta, shots: int = 1024, seed: int | None = None) -> dict:
        """Counts {qiskit_key: count} from Aer. Keys have qubit 0 on the right."""
        job = self.sim.run(self._bind(self._meas, theta), shots=int(shots),
                           seed_simulator=self.seed if seed is None else int(seed))
        return dict(job.result().get_counts())

    # ---- optimisation ----------------------------------------------------------
    def ramp(self, g0: float, b0: float) -> np.ndarray:
        """Linear-ramp initial angles: gamma rises, beta falls."""
        j = (np.arange(self.p) + 0.5) / max(self.p, 1)
        return np.concatenate([g0 * j, b0 * (1.0 - j)])

    def optimize(self, init=None, maxiter: int = 120, grid: bool = True) -> dict:
        """COBYLA from `init` (warm start) or from the best of a small grid of ramps."""
        t0 = time.perf_counter()
        self.nfev = 0
        if self.p == 0:
            return {"theta": [], "energy": self.energy([]), "nfev": 1, "runtime_s": time.perf_counter() - t0,
                    "warm_started": False}
        warm = init is not None and len(init) == 2 * self.p
        candidates = [np.asarray(init, dtype=float)] if warm else []
        if grid and not warm:
            b_grid = (1.0, 2.0, 3.0) if self.kind == "grover" else (0.3, 0.6, 1.0)
            candidates += [self.ramp(g0, b0) for g0 in (0.4, 0.8, 1.4) for b0 in b_grid]
        elif not warm:
            candidates.append(self.ramp(0.8, 2.0 if self.kind == "grover" else 0.6))
        scored = [(self.energy(c), i) for i, c in enumerate(candidates)]
        x0 = candidates[min(scored)[1]]
        res = minimize(self.energy, x0, method="COBYLA",
                       options={"maxiter": int(maxiter), "rhobeg": 0.15 if warm else 0.3, "tol": 1e-4})
        theta = res.x if res.fun <= min(scored)[0] else x0
        return {"theta": [float(v) for v in theta], "energy": float(min(res.fun, min(scored)[0])),
                "nfev": int(self.nfev), "runtime_s": time.perf_counter() - t0, "warm_started": bool(warm)}


# ---- metrics on samples (docs/CONTRACT.md section 4) -------------------------------
def sample_metrics(qp: QProblem, counts: dict, ref: dict | None = None) -> dict:
    """Feasibility, P(optimal), approximation ratio, fairness entropy, best plan, marginals."""
    ref = ref or qp.reference()
    cost, feas = qp.cost_vector(), qp.feasible_mask()
    shots = sum(counts.values())
    n_feas = n_opt = 0
    ratio_sum = 0.0
    marg = np.zeros(qp.T * qp.N)
    rows = []
    for key, cnt in counts.items():
        i = qp.key_to_index(key)
        ok = bool(feas[i])
        c = float(cost[i])
        bits = qp.index_to_bits(i)
        rows.append((bits, cnt, c, ok))
        marg += cnt * np.fromiter((ch == "1" for ch in bits), dtype=float, count=len(bits))
        if ok:
            n_feas += cnt
            ratio_sum += cnt * qp.approx_ratio(c, ref["cost_min"], ref["cost_max"])
            if c <= ref["cost_min"] + TOL:
                n_opt += cnt
    marg /= shots
    marginals = marg.reshape(qp.T, qp.N)
    expected_hours = marginals.sum(axis=0)
    feasible_rows = [r for r in rows if r[3]]
    best = min(feasible_rows, key=lambda r: (r[2], -r[1], r[0])) if feasible_rows else None
    rows.sort(key=lambda r: (-r[1], r[2], r[0]))
    return {
        "shots": int(shots),
        "feasibility_pct": 100.0 * n_feas / shots,
        "p_optimal": n_opt / shots,
        "approx_ratio": ratio_sum / shots,
        "fairness_entropy": qp.fairness_entropy(expected_hours),
        "best_bits": best[0] if best else None,
        "best_cost": best[2] if best else None,
        "marginals": [[float(v) for v in row] for row in marginals],
        "expected_hours": [float(v) for v in expected_hours],
        "samples": [{"bits": b, "count": int(n), "prob": n / shots, "cost": c, "feasible": ok,
                     "is_optimal": bool(ok and c <= ref["cost_min"] + TOL)} for b, n, c, ok in rows],
    }


def exact_state_metrics(qp: QProblem, probs: np.ndarray, ref: dict | None = None) -> dict:
    """Same quantities straight from the simulated probabilities (no shot noise)."""
    ref = ref or qp.reference()
    cost, feas = qp.cost_vector(), qp.feasible_mask()
    span = max(ref["cost_max"] - ref["cost_min"], 1e-12)
    ratio = np.clip((ref["cost_max"] - cost) / span, 0.0, 1.0) * feas
    return {"feasible_prob": float(probs[feas].sum()),
            "p_optimal": float(probs[feas & (cost <= ref["cost_min"] + TOL)].sum()),
            "approx_ratio": float(probs @ ratio)}


def tie_groups(qp: QProblem, probs: np.ndarray, max_groups: int = 8) -> list:
    """Equal-cost valid plans and the spread of their probabilities (lowest costs first)."""
    cost, feas = qp.cost_vector(), qp.feasible_mask()
    idx = np.nonzero(feas)[0]
    keys = np.round(cost[idx], 9)
    out = []
    for c in np.unique(keys):
        members = idx[keys == c]
        if len(members) < 2:
            continue
        pr = probs[members]
        out.append({"cost": float(c), "n_plans": int(len(members)), "prob_min": float(pr.min()),
                    "prob_max": float(pr.max()), "prob_spread": float(pr.max() - pr.min())})
        if len(out) >= max_groups:
            break
    return out
