"""Builds the content of results/plans/<scenario>.json (Area 2). Pure functions, no file I/O.

scripts/run_classical.py writes these payloads; tests call the same builders to check
reproducibility. Plan rows are built from the genuine algorithms only.
"""
from __future__ import annotations

import numpy as np

from src.audit.rules import audit
from src.classical.baselines import random_valid, random_valid_stats, round_robin
from src.classical.milp import exact_reference
from src.cost.metrics import approx_ratio, fairness_entropy, plan_hours
from src.cost.model import Instance
from src.data.scenarios import SCENARIOS

N_SAMPLES = 2000


def plan_row(inst: Instance, exact: dict, method: str, label: str, bits: str, notes: str) -> dict:
    """One schema `plan row` for a classical plan, evaluated and audited from scratch."""
    cost = inst.evaluate(bits)
    feasible = inst.is_valid(bits)
    a = audit(inst, bits)
    return {
        "method": method, "label": label, "kind": "classical",
        "bits": bits, "matrix": inst.to_matrix(bits).tolist(),
        "cost": float(cost), "breakdown": inst.breakdown(bits),
        "feasible": bool(feasible),
        "approx_ratio": approx_ratio(cost, exact["cost_min"], exact["cost_max"], feasible),
        "fairness_entropy": fairness_entropy(inst, plan_hours(inst, bits)),
        "audit_passed": bool(a["passed"]), "n_violations": len(a["violations"]),
        "notes": notes,
    }


def _violation_note(a: dict) -> str:
    bad = {k: v["count"] for k, v in a["per_rule"].items() if v["count"]}
    return ("audit passes all four rules" if not bad
            else "audit violations: " + ", ".join(f"{k} x{n}" for k, n in bad.items()))


def build_plans(name: str, seed: int = 7, n_samples: int = N_SAMPLES) -> dict:
    """Payload of results/plans/<name>.json without the meta fields."""
    inst, description = SCENARIOS[name]()
    exact = exact_reference(inst)

    opt_bits = exact["optimal_bits"][0]      # sorted for brute force, the single argmin for MILP
    n_opt = exact["n_optimal"]
    if exact["method"] == "brute_force":
        exact_note = (f"Exact optimum (brute force over {exact['n_valid']} valid plans); "
                      f"first of {n_opt} optimal plan(s) in sorted order. ")
    else:
        exact_note = (f"Exact optimum (MILP, HiGHS, {exact['n_valid']} valid plans); "
                      "one optimal plan, there may be ties. ")
    rr_bits = round_robin(inst)
    rv_bits = random_valid(inst, np.random.default_rng(seed))

    plans = [
        plan_row(inst, exact, "exact", "Exact optimum", opt_bits,
                 exact_note + _violation_note(audit(inst, opt_bits))),
        plan_row(inst, exact, "round_robin", "Round-robin", rr_bits,
                 "Hardship-blind rotating pointer from the first non-protected feeder; "
                 + _violation_note(audit(inst, rr_bits))),
        plan_row(inst, exact, "random_valid", "Random valid (one draw)", rv_bits,
                 f"One uniform valid plan, rng seed {seed}; " + _violation_note(audit(inst, rv_bits))),
    ]
    stats = random_valid_stats(inst, exact, n_samples=n_samples, seed=seed + 1000)
    return {"scenario": name, "description": description, "instance": inst.to_dict(),
            "exact": exact, "plans": plans, "random_valid_stats": stats}
