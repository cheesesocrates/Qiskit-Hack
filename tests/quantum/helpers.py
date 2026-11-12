"""Test helpers for Area 1.

`make_instance` builds a contract-shaped instance dict WITHOUT importing Area 2 code, and
`direct_cost` evaluates the cost straight from the formulas in docs/CONTRACT.md section 2.
Together they give the quantum tests an independent second implementation of the contract.
"""
from __future__ import annotations

import json
from itertools import combinations, product
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def make_instance(n_feeders=4, n_hours=2, quotas=(2, 1), protected=(3,), seed=1,
                  weights=None, prev_off=None, name=None) -> dict:
    rng = np.random.default_rng(seed)
    N, T = n_feeders, n_hours
    free = [f for f in range(N) if f not in protected]
    hardship = [[float(rng.integers(1, 9)) / 2.0 for _ in range(N)] for _ in range(T)]
    ledger = [0.0 if f in protected else float(rng.integers(0, 4)) for f in range(N)]
    prev = list(prev_off) if prev_off is not None else [0] * N
    mu = (sum(ledger[f] for f in free) + sum(quotas)) / len(free)
    q = lambda t, f: t * N + f
    n = N * T
    hard = {"offset": 0.0, "linear": [0.0] * n, "quadratic": []}
    fair = {"offset": 0.0, "linear": [0.0] * n, "quadratic": []}
    cons = {"offset": 0.0, "linear": [0.0] * n, "quadratic": []}
    for f in free:
        d = ledger[f] - mu
        fair["offset"] += d * d
        for t in range(T):
            hard["linear"][q(t, f)] = hardship[t][f]
            fair["linear"][q(t, f)] = 2 * d + 1
            for t2 in range(t + 1, T):
                fair["quadratic"].append([q(t, f), q(t2, f), 2.0])
        for t in range(T - 1):
            cons["quadratic"].append([q(t, f), q(t + 1, f), 1.0])
        cons["linear"][q(0, f)] = float(prev[f])
    feeders = [{"id": f, "name": f"F{f}", "zone": f"Z{f}", "kind": "hospital" if f in protected else "residential",
                "protected": f in protected, "population": 10000, "heat_index": 1.0,
                "lat": 24.86, "lon": 67.0} for f in range(N)]
    return {
        "name": name or f"test_{N}x{T}_s{seed}", "n_feeders": N, "n_hours": T, "start_hour": 18,
        "feeder_mw": 5.0, "shortfall_mw": [5.0 * m for m in quotas], "quotas": list(quotas),
        "feeders": feeders, "hardship": hardship, "ledger_hours": ledger, "prev_off": prev,
        "weights": dict(weights or {"hardship": 1.0, "fairness": 1.0, "consecutive": 2.0}),
        "rules": {"max_consecutive": 2, "max_daily_hours": 5}, "fairness_target": mu,
        "qubo": {"n_vars": n, "var_order": "q = t*n_feeders + f", "terms":
                 {"hardship": hard, "fairness": fair, "consecutive": cons}},
    }


def direct_cost(inst: dict, bits: str, weights: dict | None = None) -> float:
    """C(x) from the formulas in docs/CONTRACT.md section 2 (no QUBO involved)."""
    N, T = inst["n_feeders"], inst["n_hours"]
    w = weights or inst["weights"]
    x = [[int(bits[t * N + f]) for f in range(N)] for t in range(T)]
    free = [f["id"] for f in inst["feeders"] if not f["protected"]]
    mu = (sum(inst["ledger_hours"][f] for f in free) + sum(inst["quotas"])) / len(free)
    hardship = sum(inst["hardship"][t][f] * x[t][f] for t in range(T) for f in free)
    fairness = sum((inst["ledger_hours"][f] + sum(x[t][f] for t in range(T)) - mu) ** 2 for f in free)
    consecutive = sum(x[t][f] * x[t + 1][f] for t in range(T - 1) for f in free)
    consecutive += sum(inst["prev_off"][f] * x[0][f] for f in free)
    return w["hardship"] * hardship + w["fairness"] * fairness + w["consecutive"] * consecutive


def is_valid(inst: dict, bits: str) -> bool:
    N, T = inst["n_feeders"], inst["n_hours"]
    prot = [f["id"] for f in inst["feeders"] if f["protected"]]
    for t in range(T):
        row = bits[t * N:(t + 1) * N]
        if row.count("1") != inst["quotas"][t] or any(row[f] == "1" for f in prot):
            return False
    return True


def all_valid_bits(inst: dict) -> list:
    """Every valid plan as an index-ordered bit string, by direct enumeration."""
    N, T = inst["n_feeders"], inst["n_hours"]
    free = [f["id"] for f in inst["feeders"] if not f["protected"]]
    out = []
    for combo in product(*[list(combinations(free, m)) for m in inst["quotas"]]):
        chars = ["0"] * (N * T)
        for t, offs in enumerate(combo):
            for f in offs:
                chars[t * N + f] = "1"
        out.append("".join(chars))
    return out


def load_scenario(name: str) -> dict:
    """A committed results/plans/<name>.json (the real contract file written by Area 2)."""
    return json.loads((ROOT / "results" / "plans" / f"{name}.json").read_text(encoding="utf-8"))
