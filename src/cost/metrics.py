"""Derived metrics, defined once (docs/CONTRACT.md section 4). Area 2.

These are the reference definitions; the other areas re-implement them from the contract
and the tests compare numbers, not code.
"""
from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from src.cost.model import Instance


def approx_ratio(cost: float, cost_min: float, cost_max: float, feasible: bool = True) -> float:
    """(cost_max - cost) / (cost_max - cost_min) for one valid plan, clipped to [0, 1].

    1.0 is the exact optimum. An infeasible plan scores 0. If every valid plan has the same
    cost (cost_max == cost_min) any feasible plan scores 1.0.
    """
    if not feasible:
        return 0.0
    span = cost_max - cost_min
    if abs(span) <= 1e-12:
        return 1.0
    return float(min(1.0, max(0.0, (cost_max - cost) / span)))


def plan_hours(inst: Instance, plan: Any) -> list:
    """Hours each feeder is off in the plan (length N, protected feeders included)."""
    return [float(v) for v in inst.to_matrix(plan).sum(axis=0)]


def _burden(inst: Instance, hours: Sequence[float]) -> np.ndarray:
    """H_f = ledger_hours[f] + plan hours of f, over non-protected feeders in id order."""
    h = np.asarray(hours, dtype=float)
    if h.size != inst.n_feeders:
        raise ValueError(f"expected {inst.n_feeders} per-feeder hour values, got {h.size}")
    free = inst.free
    return np.asarray([inst.ledger_hours[f] for f in free], dtype=float) + h[free]


def fairness_entropy(inst: Instance, expected_hours: Sequence[float]) -> float:
    """Normalised entropy of the burden H_f = ledger + expected plan hours (non-protected).

    p_f = H_f / sum H_f ;  result = -sum p_f ln p_f / ln(n_free).
    1.0 means the burden is spread perfectly evenly; all-zero burden counts as 1.0.
    """
    burden = _burden(inst, expected_hours)
    n_free = burden.size
    total = float(burden.sum())
    if n_free <= 1 or total <= 0.0:
        return 1.0
    p = burden / total
    p = p[p > 0]
    return float(min(1.0, max(0.0, -float((p * np.log(p)).sum()) / math.log(n_free))))


def fairness_std(inst: Instance, plan: Any) -> float:
    """Population standard deviation (hours) of ledger + plan hours over non-protected feeders."""
    return float(np.std(_burden(inst, plan_hours(inst, plan))))
