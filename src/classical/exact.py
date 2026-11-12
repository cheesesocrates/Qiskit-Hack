"""Exact reference by brute force over every valid plan (Area 2)."""
from __future__ import annotations

from itertools import combinations, product

import numpy as np

from src.cost.model import Instance

TOL = 1e-9


def hour_patterns(inst: Instance, t: int) -> list:
    """All ways to switch off exactly quotas[t] non-protected feeders in hour t."""
    return list(combinations(inst.free, inst.quotas[t]))


def count_valid(inst: Instance) -> int:
    from math import comb
    n_free = len(inst.free)
    out = 1
    for m in inst.quotas:
        out *= comb(n_free, m)
    return out


def enumerate_valid(inst: Instance):
    """Yield every valid plan as a T x N 0/1 numpy matrix."""
    per_hour = [hour_patterns(inst, t) for t in range(inst.n_hours)]
    for combo in product(*per_hour):
        x = np.zeros((inst.n_hours, inst.n_feeders), dtype=int)
        for t, offs in enumerate(combo):
            x[t, list(offs)] = 1
        yield x


def brute_force(inst: Instance, weights: dict | None = None, keep_all: bool = False,
                max_plans: int = 2_000_000) -> dict:
    """Exact minimum and maximum cost over all valid plans.

    Returns {method, cost_min, cost_max, n_valid, n_optimal, optimal_bits[, all_bits, all_costs]}.
    """
    n_valid = count_valid(inst)
    if n_valid > max_plans:
        raise ValueError(f"{n_valid} valid plans is too many for brute force; use the MILP solver")
    bits_list, costs = [], []
    for x in enumerate_valid(inst):
        bits_list.append(inst.to_bits(x))
        costs.append(inst.evaluate(x, weights))
    costs_arr = np.asarray(costs)
    cmin, cmax = float(costs_arr.min()), float(costs_arr.max())
    optimal = [b for b, c in zip(bits_list, costs) if c <= cmin + TOL]
    out = {"method": "brute_force", "cost_min": cmin, "cost_max": cmax, "n_valid": n_valid,
           "n_optimal": len(optimal), "optimal_bits": optimal}
    if keep_all:
        out["all_bits"], out["all_costs"] = bits_list, costs
    return out
