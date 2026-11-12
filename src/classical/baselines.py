"""Classical baselines (Area 2): hardship-blind round-robin and uniform random-valid.

Both are the genuine algorithms. Neither looks at hardship, the ledger or the consecutive
rule, which is exactly why they are baselines: they always satisfy the quota and protected
constraints but know nothing about fairness or the cap.
"""
from __future__ import annotations

import numpy as np

from src.audit.rules import audit
from src.cost.metrics import approx_ratio
from src.cost.model import Instance

TOL = 1e-9


def _bits(inst: Instance, x: np.ndarray) -> str:
    return "".join(str(int(v)) for v in x.reshape(-1))


def round_robin(inst: Instance, start: int = 0) -> str:
    """Rotate a pointer over the non-protected feeders in id order.

    Hour 0 switches off the next m_0 feeders from the pointer, hour 1 continues from where
    hour 0 stopped, wrapping around. `start` is the pointer's index into the free-feeder list.
    """
    free = inst.free
    n_free = len(free)
    x = np.zeros((inst.n_hours, inst.n_feeders), dtype=int)
    ptr = int(start) % n_free
    for t, m in enumerate(inst.quotas):
        for k in range(m):
            x[t, free[(ptr + k) % n_free]] = 1
        ptr = (ptr + m) % n_free
    return _bits(inst, x)


def random_valid(inst: Instance, rng: np.random.Generator) -> str:
    """Uniform valid plan: each hour an independent uniform m_t-subset of the free feeders."""
    free = inst.free
    x = np.zeros((inst.n_hours, inst.n_feeders), dtype=int)
    for t, m in enumerate(inst.quotas):
        if m:
            x[t, rng.choice(free, size=m, replace=False)] = 1
    return _bits(inst, x)


def random_valid_stats(inst: Instance, exact: dict, n_samples: int = 2000, seed: int = 7) -> dict:
    """Monte-Carlo statistics of random_valid, in the schema's `random_valid_stats` shape.

    cap_violation_pct = percent of samples the audit flags for max_consecutive.
    p_optimal = fraction of samples with cost <= cost_min + 1e-9 (every sample is valid).
    """
    rng = np.random.default_rng(seed)
    cmin, cmax = exact["cost_min"], exact["cost_max"]
    costs, ratios, n_cap, n_opt = [], [], 0, 0
    for _ in range(n_samples):
        bits = random_valid(inst, rng)
        c = inst.evaluate(bits)
        costs.append(c)
        ratios.append(approx_ratio(c, cmin, cmax, True))
        if not audit(inst, bits)["per_rule"]["max_consecutive"]["passed"]:
            n_cap += 1
        if c <= cmin + TOL:
            n_opt += 1
    return {"n_samples": int(n_samples), "mean_cost": float(np.mean(costs)),
            "mean_approx_ratio": float(np.mean(ratios)),
            "cap_violation_pct": 100.0 * n_cap / n_samples, "p_optimal": n_opt / n_samples}
