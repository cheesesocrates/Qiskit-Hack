"""FairShed cost model (Area 2). Pure Python + numpy, no Qiskit.

Conventions are fixed by docs/CONTRACT.md:
  x[t][f] = 1  -> feeder f is OFF in hour t;  variable index q = t*N + f;
  `bits` strings are index-ordered (bits[q] is variable q), NOT Qiskit display order.
All three cost terms sum over non-protected feeders only, so protected variables have
zero coefficients; a plan with a protected feeder off is simply invalid.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

PROTECTED_KINDS = ("hospital", "water_pump", "telecom")
TERMS = ("hardship", "fairness", "consecutive")


@dataclass
class Instance:
    name: str
    n_feeders: int
    n_hours: int
    start_hour: int
    feeder_mw: float
    shortfall_mw: list
    quotas: list
    feeders: list
    hardship: list          # [T][N]
    ledger_hours: list      # [N] outage hours already served before this window
    prev_off: list          # [N] 1 if off in the hour just before the window
    weights: dict           # {hardship, fairness, consecutive}
    rules: dict             # {max_consecutive, max_daily_hours}

    def __post_init__(self) -> None:
        n, t = self.n_feeders, self.n_hours
        assert len(self.feeders) == n and len(self.ledger_hours) == n and len(self.prev_off) == n
        assert len(self.quotas) == t and len(self.shortfall_mw) == t and len(self.hardship) == t
        assert all(len(row) == n for row in self.hardship)
        assert all(0 <= m <= len(self.free) for m in self.quotas), "quota exceeds free feeders"

    # ---- structure -------------------------------------------------------
    @property
    def n_vars(self) -> int:
        return self.n_feeders * self.n_hours

    @property
    def protected(self) -> list:
        return [f["id"] for f in self.feeders if f["protected"]]

    @property
    def free(self) -> list:
        return [f["id"] for f in self.feeders if not f["protected"]]

    @property
    def fairness_target(self) -> float:
        free = self.free
        return (sum(self.ledger_hours[f] for f in free) + sum(self.quotas)) / len(free)

    def q(self, t: int, f: int) -> int:
        """Logical variable / qubit index of (hour t, feeder f)."""
        return t * self.n_feeders + f

    # ---- plan conversions ------------------------------------------------
    def to_matrix(self, plan: Any) -> np.ndarray:
        """Accepts an index-ordered bit string, a flat 0/1 sequence or a T x N matrix."""
        if isinstance(plan, str):
            flat = np.fromiter((1 if c == "1" else 0 for c in plan), dtype=int, count=len(plan))
        else:
            flat = np.asarray(plan, dtype=int).reshape(-1)
        if flat.size != self.n_vars:
            raise ValueError(f"plan has {flat.size} variables, expected {self.n_vars}")
        return flat.reshape(self.n_hours, self.n_feeders)

    def to_bits(self, plan: Any) -> str:
        return "".join(str(int(v)) for v in self.to_matrix(plan).reshape(-1))

    # ---- constraints -----------------------------------------------------
    def is_valid(self, plan: Any) -> bool:
        x = self.to_matrix(plan)
        if any(int(x[t].sum()) != self.quotas[t] for t in range(self.n_hours)):
            return False
        return not any(x[:, f].any() for f in self.protected)

    # ---- cost ------------------------------------------------------------
    def breakdown(self, plan: Any) -> dict:
        """Unweighted term values. Defined for every bitstring, valid or not."""
        x = self.to_matrix(plan)
        free = self.free
        h = np.asarray(self.hardship, dtype=float)
        hardship = float((h[:, free] * x[:, free]).sum())
        mu = self.fairness_target
        totals = x[:, free].sum(axis=0) + np.asarray([self.ledger_hours[f] for f in free], dtype=float)
        fairness = float(((totals - mu) ** 2).sum())
        consecutive = float((x[:-1, free] * x[1:, free]).sum()) if self.n_hours > 1 else 0.0
        consecutive += float(sum(self.prev_off[f] * x[0, f] for f in free))
        return {"hardship": hardship, "fairness": fairness, "consecutive": consecutive}

    def evaluate(self, plan: Any, weights: dict | None = None) -> float:
        w = weights or self.weights
        b = self.breakdown(plan)
        return float(sum(w[k] * b[k] for k in TERMS))

    # ---- QUBO / Pauli export ----------------------------------------------
    def qubo_terms(self) -> dict:
        """Unweighted QUBO per term: {term: {offset, linear[n], quadratic[[i,j,w],...]}} with i<j."""
        n = self.n_vars
        free, T = self.free, self.n_hours
        mu = self.fairness_target
        hard_lin, fair_lin, cons_lin = [0.0] * n, [0.0] * n, [0.0] * n
        fair_quad, cons_quad = [], []
        fair_off = 0.0
        for f in free:
            d = self.ledger_hours[f] - mu
            fair_off += d * d
            for t in range(T):
                hard_lin[self.q(t, f)] = float(self.hardship[t][f])
                fair_lin[self.q(t, f)] = 2.0 * d + 1.0          # x^2 = x
                for t2 in range(t + 1, T):
                    fair_quad.append([self.q(t, f), self.q(t2, f), 2.0])
            for t in range(T - 1):
                cons_quad.append([self.q(t, f), self.q(t + 1, f), 1.0])
            cons_lin[self.q(0, f)] = float(self.prev_off[f])
        return {
            "hardship": {"offset": 0.0, "linear": hard_lin, "quadratic": []},
            "fairness": {"offset": fair_off, "linear": fair_lin, "quadratic": fair_quad},
            "consecutive": {"offset": 0.0, "linear": cons_lin, "quadratic": cons_quad},
        }

    def qubo_total(self, weights: dict | None = None) -> tuple:
        """Weighted total QUBO: (offset, linear ndarray, {(i,j): w})."""
        w = weights or self.weights
        terms = self.qubo_terms()
        offset = sum(w[k] * terms[k]["offset"] for k in TERMS)
        linear = sum(w[k] * np.asarray(terms[k]["linear"], dtype=float) for k in TERMS)
        quad: dict = {}
        for k in TERMS:
            for i, j, v in terms[k]["quadratic"]:
                quad[(i, j)] = quad.get((i, j), 0.0) + w[k] * v
        return float(offset), linear, quad

    def pauli_terms(self, weights: dict | None = None) -> dict:
        """Ising form via x_i = (1 - Z_i)/2.

        Returns {"constant": c, "terms": [["Z", [i], coeff], ["ZZ", [i, j], coeff], ...]}.
        The list is the exact input format of qiskit SparsePauliOp.from_sparse_list.
        """
        offset, linear, quad = self.qubo_total(weights)
        const = offset + float(linear.sum()) / 2.0 + sum(quad.values()) / 4.0
        z = -linear / 2.0
        zz = []
        for (i, j), v in sorted(quad.items()):
            z[i] -= v / 4.0
            z[j] -= v / 4.0
            zz.append(["ZZ", [i, j], v / 4.0])
        terms = [["Z", [i], float(c)] for i, c in enumerate(z) if abs(c) > 1e-12] + zz
        return {"constant": float(const), "terms": terms}

    # ---- (de)serialisation -------------------------------------------------
    def to_dict(self) -> dict:
        """Instance object as fixed by schemas/instance.schema.json (without meta fields)."""
        return {
            "name": self.name,
            "n_feeders": self.n_feeders,
            "n_hours": self.n_hours,
            "start_hour": self.start_hour,
            "feeder_mw": self.feeder_mw,
            "shortfall_mw": list(self.shortfall_mw),
            "quotas": [int(m) for m in self.quotas],
            "feeders": self.feeders,
            "hardship": [list(map(float, row)) for row in self.hardship],
            "ledger_hours": [float(v) for v in self.ledger_hours],
            "prev_off": [int(v) for v in self.prev_off],
            "weights": {k: float(self.weights[k]) for k in TERMS},
            "rules": dict(self.rules),
            "fairness_target": self.fairness_target,
            "qubo": {
                "n_vars": self.n_vars,
                "var_order": "q = t*n_feeders + f ; bits[q] is variable q (index-ordered)",
                "terms": self.qubo_terms(),
            },
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Instance":
        keys = ("name", "n_feeders", "n_hours", "start_hour", "feeder_mw", "shortfall_mw", "quotas",
                "feeders", "hardship", "ledger_hours", "prev_off", "weights", "rules")
        return cls(**{k: d[k] for k in keys})


def quota_from_shortfall(shortfall_mw: float, feeder_mw: float) -> int:
    """Feeders are equal-size, so the quota is a count: ceil(shortfall / feeder size)."""
    return max(0, int(math.ceil(shortfall_mw / feeder_mw - 1e-9)))


def evaluate_qubo(offset: float, linear, quad: dict, bits: str) -> float:
    """Reference QUBO evaluation used by tests to cross-check Instance.evaluate."""
    x = [1 if c == "1" else 0 for c in bits]
    val = offset + sum(float(linear[i]) * x[i] for i in range(len(x)))
    return float(val + sum(v * x[i] * x[j] for (i, j), v in quad.items()))


def evaluate_pauli(pauli: dict, bits: str) -> float:
    """Reference Ising evaluation (Z eigenvalue = 1 - 2x) used by tests."""
    z = [1 - 2 * (1 if c == "1" else 0) for c in bits]
    val = pauli["constant"]
    for _label, idx, coeff in pauli["terms"]:
        prod = 1
        for i in idx:
            prod *= z[i]
        val += coeff * prod
    return float(val)
