"""Exact MILP solver for the load-shedding QUBO (scipy.optimize.milp, HiGHS). Area 2.

x_q binary (q = t*N + f). Every quadratic pair (i, j) of the weighted QUBO gets an auxiliary
y_ij in [0, 1] with the standard linearisation  y <= x_i,  y <= x_j,  y >= x_i + x_j - 1,
which forces y = x_i * x_j for binary x. Quota rows are equalities, protected variables have
upper bound 0.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from src.classical.exact import brute_force, count_valid
from src.cost.model import Instance

MAX_OPTIMAL_BITS = 200


def solve_milp(inst: Instance, weights: dict | None = None, sense: str = "min",
               time_limit: float | None = None) -> dict:
    """Exact optimum over valid plans. sense is "min" or "max".

    Returns {"method": "milp", "cost": float, "bits": str, "status": str}. `cost` is
    re-evaluated with Instance.evaluate on the returned bits (not read from the solver).
    Raises RuntimeError if HiGHS does not prove optimality.
    """
    if sense not in ("min", "max"):
        raise ValueError("sense must be 'min' or 'max'")
    offset, linear, quad = inst.qubo_total(weights)
    pairs = sorted(quad)
    n, m = inst.n_vars, len(pairs)
    sign = 1.0 if sense == "min" else -1.0

    c = np.concatenate([sign * linear, sign * np.asarray([quad[p] for p in pairs], dtype=float)])

    rows, cols, vals, lo, hi = [], [], [], [], []
    r = 0
    for t in range(inst.n_hours):                       # quota equalities
        for f in range(inst.n_feeders):
            rows.append(r); cols.append(inst.q(t, f)); vals.append(1.0)
        lo.append(float(inst.quotas[t])); hi.append(float(inst.quotas[t]))
        r += 1
    for k, (i, j) in enumerate(pairs):                  # linearisation of y_ij = x_i * x_j
        y = n + k
        rows += [r, r]; cols += [y, i]; vals += [1.0, -1.0]; lo.append(-np.inf); hi.append(0.0); r += 1
        rows += [r, r]; cols += [y, j]; vals += [1.0, -1.0]; lo.append(-np.inf); hi.append(0.0); r += 1
        rows += [r, r, r]; cols += [y, i, j]; vals += [1.0, -1.0, -1.0]; lo.append(-1.0); hi.append(np.inf); r += 1
    A = coo_matrix((vals, (rows, cols)), shape=(r, n + m)).tocsr()

    ub = np.ones(n + m)
    for f in inst.protected:
        for t in range(inst.n_hours):
            ub[inst.q(t, f)] = 0.0
    integrality = np.concatenate([np.ones(n), np.zeros(m)])   # y follows x, so it may stay continuous
    options = {"disp": False, "mip_rel_gap": 0.0}
    if time_limit is not None:
        options["time_limit"] = float(time_limit)

    res = milp(c, constraints=LinearConstraint(A, lo, hi), integrality=integrality,
               bounds=Bounds(np.zeros(n + m), ub), options=options)
    if res.status != 0 or res.x is None:
        raise RuntimeError(f"MILP not solved to optimality: status={res.status} {res.message}")
    bits = "".join("1" if v > 0.5 else "0" for v in res.x[:n])
    cost = inst.evaluate(bits, weights)
    return {"method": "milp", "cost": float(cost), "bits": bits, "status": "optimal"}


def exact_reference(inst: Instance, max_brute: int = 200_000, weights: dict | None = None) -> dict:
    """Exact reference in the shape of the schema's `exact` object.

    Brute force over all valid plans when count_valid(inst) <= max_brute, otherwise the MILP
    for both the minimum and the maximum (n_optimal is None; optimal_bits holds the one argmin).
    """
    n_valid = count_valid(inst)
    if n_valid <= max_brute:
        out = brute_force(inst, weights, max_plans=max(max_brute, n_valid))
        optimal = sorted(out["optimal_bits"])
        return {"method": "brute_force", "cost_min": float(out["cost_min"]),
                "cost_max": float(out["cost_max"]), "n_valid": int(n_valid),
                "n_optimal": len(optimal), "optimal_bits": optimal[:MAX_OPTIMAL_BITS]}
    lo = solve_milp(inst, weights, "min")
    hi = solve_milp(inst, weights, "max")
    return {"method": "milp", "cost_min": float(lo["cost"]), "cost_max": float(hi["cost"]),
            "n_valid": int(n_valid), "n_optimal": None, "optimal_bits": [lo["bits"]]}
