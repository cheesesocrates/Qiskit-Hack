"""QAOA circuit builders for the three variants (Area 1).

xy       Dicke state per hour block + XY ring mixer inside each block. Both preserve the
         Hamming weight of every block, so every measured bitstring meets every quota.
grover   Same Dicke preparation U_S, Grover mixer U_S (I - (1 - e^{-i beta})|0><0|) U_S^dagger
         = exp(-i beta |S><S|). The state stays in the valid subspace AND plans of equal
         cost always carry equal amplitude (a fair lottery among ties).
penalty  Plain QAOA: Hadamards, X mixer, quota as a quadratic penalty. Weak baseline.

Protected feeders have no qubit (compact register), so the protected rule holds by
construction in all three.
"""
from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector

from src.quantum.dicke import dicke_circuit
from src.quantum.problem import QProblem

KINDS = ("xy", "grover", "penalty")


def qubo_to_ising(offset: float, lin: np.ndarray, quad: dict) -> tuple:
    """x = (1 - Z)/2  ->  const + sum h_a Z_a + sum J_ab Z_a Z_b."""
    const = offset + lin.sum() / 2.0 + sum(quad.values()) / 4.0
    h = -np.asarray(lin, dtype=float) / 2.0
    J = {}
    for (a, b), v in quad.items():
        h[a] -= v / 4.0
        h[b] -= v / 4.0
        J[(a, b)] = v / 4.0
    return float(const), h, J


def ising_scale(h: np.ndarray, J: dict) -> float:
    return float(np.sqrt((h ** 2).sum() + sum(v * v for v in J.values()))) or 1.0


def state_prep(qp: QProblem) -> QuantumCircuit:
    """U_S: one Dicke state |D^{n_free}_{m_t}> per hour block. U_S|0> = uniform over valid plans."""
    qc = QuantumCircuit(qp.n, name="U_S")
    for t, block in enumerate(qp.blocks):
        qc.compose(dicke_circuit(len(block), qp.quotas[t]), qubits=block, inplace=True)
    return qc


def add_cost_layer(qc: QuantumCircuit, h: np.ndarray, J: dict, gamma, scale: float) -> None:
    """exp(-i gamma C/scale) up to a global phase, from the Ising form: RZ and RZZ gates."""
    for a, v in enumerate(h):
        if abs(v) > 1e-12:
            qc.rz(2.0 * gamma * float(v) / scale, a)
    for (a, b), v in sorted(J.items()):
        if abs(v) > 1e-12:
            qc.rzz(2.0 * gamma * float(v) / scale, a, b)


def ring_pairs(k: int) -> list:
    """Edges of a ring on k nodes, ordered even pairs, odd pairs, wrap-around."""
    if k < 2:
        return []
    pairs = [(i, i + 1) for i in range(0, k - 1, 2)] + [(i, i + 1) for i in range(1, k - 1, 2)]
    if k > 2:
        pairs.append((k - 1, 0))
    return pairs


def add_xy_mixer(qc: QuantumCircuit, qp: QProblem, beta) -> None:
    """exp(-i beta (XX+YY)/2) on a ring inside each hour block (RXX and RYY commute)."""
    for block in qp.blocks:
        for i, j in ring_pairs(len(block)):
            qc.rxx(beta, block[i], block[j])
            qc.ryy(beta, block[i], block[j])


def add_grover_mixer(qc: QuantumCircuit, us: QuantumCircuit, us_inv: QuantumCircuit, beta) -> None:
    """U_S (I - (1 - e^{-i beta})|0><0|) U_S^dagger: a phase e^{-i beta} on the all-zero state."""
    n = qc.num_qubits
    qc.compose(us_inv, inplace=True)
    qc.x(range(n))
    if n == 1:
        qc.p(-beta, 0)
    else:
        qc.mcp(-beta, list(range(n - 1)), n - 1)
    qc.x(range(n))
    qc.compose(us, inplace=True)


def build_qaoa(qp: QProblem, kind: str, p: int, penalty: float | None = None) -> dict:
    """Parametrised QAOA circuit without measurements.

    Returns {"circuit", "gammas", "betas", "scale", "penalty"}; parameter order used
    everywhere is theta = [gamma_0..gamma_{p-1}, beta_0..beta_{p-1}].
    """
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    gammas = ParameterVector("g", p)
    betas = ParameterVector("b", p)
    qc = QuantumCircuit(qp.n, name=f"qaoa_{kind}_p{p}")
    if kind == "penalty":
        penalty = qp.default_penalty() if penalty is None else float(penalty)
        _c, h, J = qubo_to_ising(*qp.penalty_qubo(penalty))
        scale = ising_scale(h, J)
        qc.h(range(qp.n))
        for layer in range(p):
            add_cost_layer(qc, h, J, gammas[layer], scale)
            qc.rx(2.0 * betas[layer], range(qp.n))
    else:
        _c, h, J = qp.ising()
        scale = ising_scale(h, J)
        us = state_prep(qp)
        us_inv = us.inverse()
        qc.compose(us, inplace=True)
        for layer in range(p):
            add_cost_layer(qc, h, J, gammas[layer], scale)
            if kind == "xy":
                add_xy_mixer(qc, qp, betas[layer])
            else:
                add_grover_mixer(qc, us, us_inv, betas[layer])
    return {"circuit": qc, "gammas": gammas, "betas": betas, "scale": scale, "penalty": penalty}
