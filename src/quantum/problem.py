"""Quantum-side view of an instance, built ONLY from the JSON contract (docs/CONTRACT.md).

Registers
---------
Logical variable index (results files):  q = t*N + f              (T*N variables)
Compact qubit index (circuits):          c = t*n_free + k         (T*n_free qubits)
  where k is the position of feeder f in the sorted list of non-protected feeders.
Protected feeders have no qubit: they are 0 by construction.

Bit order (the part that bites)
-------------------------------
* Statevector / probability index i: qubit c is bit c of i (little-endian), x_c = (i >> c) & 1.
* Qiskit count keys are strings with qubit 0 on the RIGHT: x_c = key[n-1-c].
* Results `bits` strings are index-ordered over the LOGICAL variables: bits[q] = x_q.
"""
from __future__ import annotations

from math import comb

import numpy as np

TERMS = ("hardship", "fairness", "consecutive")
TOL = 1e-9


class QProblem:
    def __init__(self, instance: dict, weights: dict | None = None):
        self.instance = instance
        self.name = instance.get("name", "instance")
        self.N = int(instance["n_feeders"])
        self.T = int(instance["n_hours"])
        self.quotas = [int(m) for m in instance["quotas"]]
        self.protected = sorted(f["id"] for f in instance["feeders"] if f["protected"])
        self.free = sorted(f["id"] for f in instance["feeders"] if not f["protected"])
        self.n_free = len(self.free)
        self.n = self.T * self.n_free                      # compact qubits
        self.weights = dict(weights or instance["weights"])
        self.ledger = [float(v) for v in instance["ledger_hours"]]
        # compact <-> logical maps
        self.c2q = [t * self.N + f for t in range(self.T) for f in self.free]
        self.q2c = {q: c for c, q in enumerate(self.c2q)}
        self.blocks = [list(range(t * self.n_free, (t + 1) * self.n_free)) for t in range(self.T)]
        self._build_qubo(instance["qubo"]["terms"])
        self._cost_vec = None
        self._feas = None

    # ---- QUBO / Ising over the compact register ---------------------------
    def _build_qubo(self, terms: dict) -> None:
        self.offset = 0.0
        self.lin = np.zeros(self.n)
        self.quad: dict = {}
        for k in TERMS:
            w = float(self.weights[k])
            self.offset += w * float(terms[k]["offset"])
            for q, v in enumerate(terms[k]["linear"]):
                if q in self.q2c:
                    self.lin[self.q2c[q]] += w * float(v)
                elif abs(v) > 1e-12:
                    raise ValueError("contract violation: protected variable has a non-zero coefficient")
            for i, j, v in terms[k]["quadratic"]:
                a, b = sorted((self.q2c[int(i)], self.q2c[int(j)]))
                self.quad[(a, b)] = self.quad.get((a, b), 0.0) + w * float(v)

    def ising(self) -> tuple:
        """C = const + sum_a h[a] Z_a + sum_(a<b) J[(a,b)] Z_a Z_b  with x = (1 - Z)/2."""
        const = self.offset + self.lin.sum() / 2.0 + sum(self.quad.values()) / 4.0
        h = -self.lin / 2.0
        J = {}
        for (a, b), v in self.quad.items():
            h[a] -= v / 4.0
            h[b] -= v / 4.0
            J[(a, b)] = v / 4.0
        return float(const), h, J

    def energy_scale(self) -> float:
        """Std-dev of the cost over uniformly random bitstrings: sqrt(sum h^2 + sum J^2)."""
        _c, h, J = self.ising()
        return float(np.sqrt((h ** 2).sum() + sum(v * v for v in J.values()))) or 1.0

    def penalty_qubo(self, strength: float) -> tuple:
        """QUBO plus strength * sum_t (sum_k x[t,k] - m_t)^2 (quota as a soft penalty)."""
        offset, lin, quad = self.offset, self.lin.copy(), dict(self.quad)
        for t, block in enumerate(self.blocks):
            m = self.quotas[t]
            offset += strength * m * m
            for a in block:
                lin[a] += strength * (1 - 2 * m)
            for i, a in enumerate(block):
                for b in block[i + 1:]:
                    quad[(a, b)] = quad.get((a, b), 0.0) + 2.0 * strength
        return offset, lin, quad

    def default_penalty(self) -> float:
        """Upper bound on the cost change from flipping one variable (so the penalty dominates)."""
        bound = np.abs(self.lin).copy()
        for (a, b), v in self.quad.items():
            bound[a] += abs(v)
            bound[b] += abs(v)
        return float(bound.max())

    # ---- dense tables over all 2^n compact basis states --------------------
    def _bit_table(self) -> np.ndarray:
        idx = np.arange(1 << self.n, dtype=np.int64)
        return ((idx[:, None] >> np.arange(self.n)) & 1).astype(np.float64)

    @staticmethod
    def qubo_vector(offset: float, lin: np.ndarray, quad: dict, bits: np.ndarray) -> np.ndarray:
        vec = offset + bits @ lin
        for (a, b), v in quad.items():
            vec += v * bits[:, a] * bits[:, b]
        return vec

    def cost_vector(self) -> np.ndarray:
        """cost_vector()[i] = C(x) for basis state i (little-endian)."""
        if self._cost_vec is None:
            self._cost_vec = self.qubo_vector(self.offset, self.lin, self.quad, self._bit_table())
        return self._cost_vec

    def feasible_mask(self) -> np.ndarray:
        """True where every hour block has exactly quotas[t] ones."""
        if self._feas is None:
            idx = np.arange(1 << self.n, dtype=np.int64)
            ok = np.ones(idx.shape, dtype=bool)
            for t, block in enumerate(self.blocks):
                weight = np.zeros(idx.shape, dtype=np.int64)
                for c in block:
                    weight += (idx >> c) & 1
                ok &= weight == self.quotas[t]
            self._feas = ok
        return self._feas

    def n_valid(self) -> int:
        out = 1
        for m in self.quotas:
            out *= comb(self.n_free, m)
        return out

    def reference(self) -> dict:
        """Exact reference recomputed on the quantum side by enumeration of the feasible subspace."""
        cost, feas = self.cost_vector(), self.feasible_mask()
        fc = cost[feas]
        cmin, cmax = float(fc.min()), float(fc.max())
        return {"cost_min": cmin, "cost_max": cmax, "n_valid": int(feas.sum()),
                "n_optimal": int((fc <= cmin + TOL).sum())}

    # ---- conversions ---------------------------------------------------------
    def index_to_bits(self, i: int) -> str:
        """Basis-state index -> logical index-ordered bits (protected feeders are '0')."""
        out = ["0"] * (self.T * self.N)
        for c, q in enumerate(self.c2q):
            if (int(i) >> c) & 1:
                out[q] = "1"
        return "".join(out)

    def key_to_index(self, key: str) -> int:
        """Qiskit count key (qubit 0 on the right, spaces ignored) -> basis-state index."""
        return int(key.replace(" ", ""), 2)

    def key_to_bits(self, key: str) -> str:
        return self.index_to_bits(self.key_to_index(key))

    def bits_to_index(self, bits: str) -> int:
        """Logical bits -> basis-state index. Raises if a protected feeder is set."""
        i = 0
        for q, ch in enumerate(bits):
            if ch == "1":
                if q not in self.q2c:
                    raise ValueError("bits switch off a protected feeder; no compact state exists")
                i |= 1 << self.q2c[q]
        return i

    def bits_to_matrix(self, bits: str) -> list:
        return [[int(bits[t * self.N + f]) for f in range(self.N)] for t in range(self.T)]

    def cost_of_bits(self, bits: str) -> float:
        """Cost straight from the QUBO (no dense table needed; works for any size)."""
        x = np.zeros(self.n)
        for q, ch in enumerate(bits):
            if ch == "1" and q in self.q2c:
                x[self.q2c[q]] = 1.0
        val = self.offset + float(x @ self.lin)
        return float(val + sum(v * x[a] * x[b] for (a, b), v in self.quad.items()))

    def is_valid_bits(self, bits: str) -> bool:
        m = self.bits_to_matrix(bits)
        if any(sum(m[t]) != self.quotas[t] for t in range(self.T)):
            return False
        return not any(m[t][f] for t in range(self.T) for f in self.protected)

    def breakdown_of_bits(self, bits: str) -> dict:
        """Unweighted term values from the per-term QUBOs in the instance JSON."""
        x = [1 if ch == "1" else 0 for ch in bits]
        out = {}
        for k in TERMS:
            term = self.instance["qubo"]["terms"][k]
            val = float(term["offset"]) + sum(float(v) * x[q] for q, v in enumerate(term["linear"]))
            val += sum(float(v) * x[int(i)] * x[int(j)] for i, j, v in term["quadratic"])
            out[k] = float(val)
        return out

    # ---- metrics (docs/CONTRACT.md section 4) --------------------------------
    def plan_hours(self, bits: str) -> list:
        m = self.bits_to_matrix(bits)
        return [float(sum(m[t][f] for t in range(self.T))) for f in range(self.N)]

    def fairness_entropy(self, expected_hours) -> float:
        tot = np.array([self.ledger[f] + float(expected_hours[f]) for f in self.free])
        if tot.sum() <= 0 or self.n_free < 2:
            return 1.0
        p = tot / tot.sum()
        p = p[p > 0]
        return float(-(p * np.log(p)).sum() / np.log(self.n_free))

    def fairness_std(self, bits: str) -> float:
        hrs = self.plan_hours(bits)
        return float(np.std([self.ledger[f] + hrs[f] for f in self.free]))

    @staticmethod
    def approx_ratio(cost: float, cmin: float, cmax: float, feasible: bool = True) -> float:
        if not feasible:
            return 0.0
        if cmax - cmin < 1e-12:
            return 1.0
        return float(min(1.0, max(0.0, (cmax - cost) / (cmax - cmin))))
