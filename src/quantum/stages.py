"""Quantum stages that write results files (Area 1): ablation, lottery, pareto, window solver.

Inputs come only from results/plans/*.json (written by Area 2). Simulator only.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from src.quantum.io import RESULTS, load_scenario, write_result
from src.quantum.problem import TOL, QProblem
from src.quantum.qaoa import LABELS, QAOARunner, exact_state_metrics, sample_metrics, tie_groups

SOURCE = "scripts/run_quantum.py"
ABLATION_SHOTS = 4096
DECISION_SHOTS = 256          # shots used when a QAOA run has to pick one plan
DECISION_KIND, DECISION_P = "grover", 2
PARETO_WEIGHTS = (0.0, 0.25, 0.5, 1.0, 2.0, 4.0)
CACHE = RESULTS / "tmp" / "qaoa_angles.json"


# ---- small angle cache so later stages reuse the ablation's optimisation ----------
def _cache_key(qp: QProblem, kind: str, p: int, seed: int) -> str:
    w = qp.weights
    return f"{qp.name}|{w['hardship']}|{w['fairness']}|{w['consecutive']}|{kind}|{p}|{seed}"


def _cache_get(key: str):
    try:
        return json.loads(CACHE.read_text(encoding="utf-8")).get(key)
    except Exception:
        return None


def _cache_put(key: str, value: dict) -> None:
    try:
        data = json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    data[key] = value
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(data), encoding="utf-8")


def optimised_runner(qp: QProblem, kind: str, p: int, seed: int, maxiter: int = 150,
                     init=None, use_cache: bool = True) -> tuple:
    """(runner, opt) with opt = {theta, energy, nfev, runtime_s, warm_started}."""
    runner = QAOARunner(qp, kind, p, seed=seed)
    key = _cache_key(qp, kind, p, seed)
    cached = _cache_get(key) if (use_cache and init is None) else None
    if cached and len(cached["theta"]) == 2 * p:
        return runner, {**cached, "from_cache": True}
    opt = runner.optimize(init=init, maxiter=maxiter)
    if init is None:
        _cache_put(key, opt)
    return runner, opt


# ---- decision rule ------------------------------------------------------------------
def decide(qp: QProblem, counts: dict, seed: int, prefer_bits: str | None = None) -> dict | None:
    """Pick one plan from samples: lowest cost among valid samples.

    Ties on cost are broken by (1) fewest changes versus `prefer_bits` (the previous plan,
    if given), (2) highest count, (3) a seeded random draw. With the Grover mixer tied plans
    are equally likely, so (2)-(3) amount to a fair lottery.
    """
    cand = []
    for key, cnt in counts.items():
        bits = qp.key_to_bits(key)
        if qp.is_valid_bits(bits):
            cand.append((qp.cost_of_bits(bits), bits, cnt))
    if not cand:
        return None
    best_cost = min(c for c, _b, _n in cand)
    tied = [(b, n) for c, b, n in cand if c <= best_cost + TOL]
    if prefer_bits and len(prefer_bits) == len(tied[0][0]):
        dist = lambda b: sum(x != y for x, y in zip(b, prefer_bits))
        dmin = min(dist(b) for b, _n in tied)
        tied = [(b, n) for b, n in tied if dist(b) == dmin]
    nmax = max(n for _b, n in tied)
    tied = sorted(b for b, n in tied if n == nmax)
    bits = tied[int(np.random.default_rng(seed).integers(len(tied)))]
    return {"bits": bits, "cost": float(best_cost), "n_tied": len(tied)}


# ---- ablation -------------------------------------------------------------------------
def _classical_rows(sc: dict, qp: QProblem, name: str) -> list:
    ex, rows = sc["exact"], []
    by_method = {r["method"]: r for r in sc["plans"]}
    uniform_hours = [0.0 if f in qp.protected else sum(qp.quotas) / qp.n_free for f in range(qp.N)]

    def base(method, label, notes, **kw):
        row = {"method": method, "label": label, "kind": "classical", "instance": name,
               "n_qubits": None, "layers": None, "shots": None, "runtime_s": None, "notes": notes}
        row.update(kw)
        return row

    if "exact" in by_method:
        r = by_method["exact"]
        rows.append(base("exact", "Exact (" + ex["method"].replace("_", " ") + ")",
                         f"Reference from Area 2 over {ex['n_valid']} valid plans.",
                         feasibility_pct=100.0, p_optimal=1.0, approx_ratio=1.0,
                         fairness_entropy=r["fairness_entropy"], best_cost=r["cost"], best_bits=r["bits"]))
    if "round_robin" in by_method:
        r = by_method["round_robin"]
        rows.append(base("round_robin", "Round-robin", "One deterministic hardship-blind plan (Area 2).",
                         feasibility_pct=100.0 if r["feasible"] else 0.0,
                         p_optimal=1.0 if r["feasible"] and r["cost"] <= ex["cost_min"] + TOL else 0.0,
                         approx_ratio=r["approx_ratio"] or 0.0, fairness_entropy=r["fairness_entropy"],
                         best_cost=r["cost"], best_bits=r["bits"]))
    st = sc.get("random_valid_stats")
    if st:
        rows.append(base("random_valid", "Random valid plan",
                         f"Mean over {st['n_samples']} uniform valid plans (Area 2).",
                         feasibility_pct=100.0, p_optimal=st["p_optimal"], approx_ratio=st["mean_approx_ratio"],
                         fairness_entropy=qp.fairness_entropy(uniform_hours), best_cost=None, best_bits=None))
    return rows


def quantum_row(qp: QProblem, kind: str, p: int, seed: int, name: str, ref: dict,
                shots: int = ABLATION_SHOTS, maxiter: int = 150) -> dict:
    t0 = time.perf_counter()
    runner, opt = optimised_runner(qp, kind, p, seed, maxiter=maxiter)
    counts = runner.sample(opt["theta"], shots=shots, seed=seed)
    m = sample_metrics(qp, counts, ref)
    ex = exact_state_metrics(qp, runner.probabilities(opt["theta"]), ref)
    runtime = time.perf_counter() - t0
    if opt.get("from_cache"):          # report the optimiser time even when the angles were reused
        runtime += float(opt.get("runtime_s") or 0.0)
    label = "Dicke state only (uniform over valid plans)" if p == 0 else f"{LABELS[kind]}, p={p}"
    notes = (f"Exact simulated state: P(optimal)={ex['p_optimal']:.4f}, approx ratio={ex['approx_ratio']:.4f}, "
             f"valid probability={ex['feasible_prob']:.4f}. Optimiser evaluations: {opt['nfev']}. "
             f"Transpiled depth {runner.depth}.")
    if kind == "penalty":
        notes += f" Quota penalty strength {runner.penalty:.2f}; invalid samples score 0."
    return {"method": f"{kind}_qaoa_p{p}" if p else "dicke_uniform", "label": label, "kind": "quantum",
            "instance": name, "n_qubits": qp.n, "layers": p, "shots": shots,
            "feasibility_pct": m["feasibility_pct"], "p_optimal": m["p_optimal"],
            "approx_ratio": m["approx_ratio"], "fairness_entropy": m["fairness_entropy"],
            "runtime_s": round(runtime, 3), "best_cost": m["best_cost"], "best_bits": m["best_bits"],
            "notes": notes}


def run_ablation(seed: int = 7, layers: tuple = (1, 3), scenario: str = "base",
                 block: str = "block_4x2", with_gas: bool = True) -> Path:
    sc = load_scenario(scenario)
    qp = QProblem(sc["instance"])
    ref = qp.reference()
    rows = _classical_rows(sc, qp, scenario)
    rows.append(quantum_row(qp, "grover", 0, seed, scenario, ref))
    for kind in ("xy", "grover", "penalty"):
        for p in layers:
            rows.append(quantum_row(qp, kind, p, seed, scenario, ref))
            print(f"  ablation {kind} p={p}: P(opt)={rows[-1]['p_optimal']:.4f} "
                  f"ratio={rows[-1]['approx_ratio']:.3f} valid={rows[-1]['feasibility_pct']:.1f}%")
    notes = ("Quantum rows are sampled from the Aer statevector simulator. approx_ratio is the mean over all "
             "samples with invalid samples scored 0. No speed-up is claimed: at this size classical brute force gives the exact answer.")
    # same-instance comparison on the 8-variable block for Grover Adaptive Search
    try:
        bsc = load_scenario(block)
        bqp = QProblem(bsc["instance"])
        bref = bqp.reference()
        rows += _classical_rows(bsc, bqp, block)
        rows.append(quantum_row(bqp, "grover", 2, seed, block, bref, shots=1024))
        if with_gas:
            from src.quantum.gas import run_gas
            rows += run_gas(scenario=block, seed=seed)
    except Exception as exc:  # honest: say what is missing instead of inventing a row
        notes += f" Block comparison incomplete: {type(exc).__name__}: {str(exc)[:160]}"
        print("  ablation block rows not available:", exc)
    return write_result("ablation.json", {"instance_name": scenario, "reference": ref, "rows": rows,
                                          "notes": notes}, seed, SOURCE)


# ---- lottery ----------------------------------------------------------------------------
def run_lottery(seed: int = 7, scenario: str = "base", p: int = 3, shots: int = ABLATION_SHOTS) -> Path:
    sc = load_scenario(scenario)
    qp = QProblem(sc["instance"])
    ref = qp.reference()
    runner, opt = optimised_runner(qp, "grover", p, seed)
    probs = runner.probabilities(opt["theta"])
    m = sample_metrics(qp, runner.sample(opt["theta"], shots=shots, seed=seed), ref)
    ties = tie_groups(qp, probs)
    payload = {
        "method": f"{LABELS['grover']}, p={p}", "instance_name": scenario, "shots": shots,
        "n_qubits": qp.n, "layers": p, "all_feasible": m["feasibility_pct"] >= 100.0,
        "samples": m["samples"][:12], "marginals": m["marginals"], "expected_hours": m["expected_hours"],
        "tie_groups": ties,
        "notes": ("Samples and marginals come from Aer shots. Tie groups use the exact simulated probabilities: "
                  "plans with equal cost receive equal probability under the Grover mixer, so the draw among "
                  f"tied plans is unbiased. {ref['n_optimal']} optimal plans tie at cost {ref['cost_min']}."),
    }
    return write_result("lottery.json", payload, seed, SOURCE)


# ---- pareto -------------------------------------------------------------------------------
def run_pareto(seed: int = 7, scenario: str = "base", weights: tuple = PARETO_WEIGHTS) -> Path:
    sc = load_scenario(scenario)
    inst = sc["instance"]
    points, theta = [], None
    for w in weights:
        qp = QProblem(inst, weights={**inst["weights"], "fairness": float(w)})
        ref = qp.reference()
        runner, opt = optimised_runner(qp, DECISION_KIND, DECISION_P, seed, maxiter=80, init=theta)
        theta = opt["theta"]
        pick = decide(qp, runner.sample(theta, shots=DECISION_SHOTS, seed=seed), seed)
        ex = exact_state_metrics(qp, runner.probabilities(theta), ref)
        if pick is None:
            raise RuntimeError(f"no valid sample at fairness weight {w}")
        bits = pick["bits"]
        bd = qp.breakdown_of_bits(bits)
        points.append({
            "fairness_weight": float(w), "plan": {"bits": bits, "matrix": qp.bits_to_matrix(bits)},
            "cost": pick["cost"], "breakdown": bd, "fairness_metric": qp.fairness_std(bits),
            "fairness_entropy": qp.fairness_entropy(qp.plan_hours(bits)), "hardship_total": bd["hardship"],
            "exact_cost": ref["cost_min"], "matches_exact": bool(pick["cost"] <= ref["cost_min"] + TOL),
            "p_optimal": ex["p_optimal"],
        })
        print(f"  pareto w_f={w}: cost={pick['cost']:.2f} exact={ref['cost_min']:.2f} "
              f"match={points[-1]['matches_exact']} P(opt)={ex['p_optimal']:.4f}")
    base_w = float(inst["weights"]["fairness"])
    default_index = min(range(len(points)), key=lambda i: abs(points[i]["fairness_weight"] - base_w))
    payload = {
        "instance_name": scenario, "method": f"{LABELS[DECISION_KIND]}, p={DECISION_P}",
        "fairness_metric_name": "Std-dev of total outage hours (ledger + plan) across non-protected feeders",
        "default_index": default_index, "points": points,
        "notes": (f"Each point: best valid plan among {DECISION_SHOTS} Aer shots of the optimised circuit; "
                  "p_optimal is the exact simulated probability of an optimal plan per shot; exact_cost is the "
                  "brute-force optimum for that weight. Angles are warm-started from the previous weight."),
    }
    return write_result("pareto.json", payload, seed, SOURCE)


# ---- window solver (the one cross-area call, docs/CONTRACT.md section 6) ----------------
def solve_window(in_path: str, out_path: str) -> dict:
    t0 = time.perf_counter()
    req = json.loads(Path(in_path).read_text(encoding="utf-8"))
    seed = int(req.get("seed", 7))
    warm = req.get("warm_start") or {}
    qp = QProblem(req["instance"])
    method = f"{LABELS[DECISION_KIND]}, p={DECISION_P}, best of {DECISION_SHOTS} shots"
    if qp.n_valid() == 1:
        # a single valid plan (for example every quota is zero): nothing to optimise
        bits = qp.index_to_bits(int(np.nonzero(qp.feasible_mask())[0][0]))
        out = {"bits": bits, "cost": qp.cost_of_bits(bits), "feasible": True, "p_optimal": 1.0,
               "method": "trivial (only one valid plan)", "warm_start": {k: v for k, v in warm.items()}}
    else:
        init = warm.get("theta") if warm.get("kind") == DECISION_KIND and warm.get("p") == DECISION_P else None
        runner = QAOARunner(qp, DECISION_KIND, DECISION_P, seed=seed)
        opt = runner.optimize(init=init, maxiter=40 if init else 80)
        pick = decide(qp, runner.sample(opt["theta"], shots=DECISION_SHOTS, seed=seed), seed,
                      prefer_bits=warm.get("prev_window_bits_shifted"))
        ex = exact_state_metrics(qp, runner.probabilities(opt["theta"]))
        if pick is None:
            out = {"bits": "0" * (qp.T * qp.N), "cost": 0.0, "feasible": False, "p_optimal": ex["p_optimal"],
                   "method": method, "warm_start": None}
        else:
            out = {"bits": pick["bits"], "cost": pick["cost"], "feasible": True, "p_optimal": ex["p_optimal"],
                   "method": method,
                   "warm_start": {"theta": opt["theta"], "kind": DECISION_KIND, "p": DECISION_P,
                                  "angles_warm_started": bool(init)}}
    out["runtime_s"] = round(time.perf_counter() - t0, 3)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out
