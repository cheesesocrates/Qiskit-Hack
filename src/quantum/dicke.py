"""Deterministic Dicke-state preparation (Baertschi & Eidenbenz, FCT 2019).

|D^n_k> is the uniform superposition of all n-bit strings with exactly k ones: exactly the
set of ways to switch off k of n feeders in one hour. The circuit uses O(k*n) gates and no
ancillas, and is exact (no post-selection).

Construction: start from |0^(n-k) 1^k>, then apply "split and cyclic shift" blocks
SCS_{n,k}, SCS_{n-1,k}, ..., SCS_{k+1,k}, SCS_{k,k-1}, ..., SCS_{2,1}.
"""
from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import RYGate


def _scs(qc: QuantumCircuit, m: int, k: int) -> None:
    """Split-and-cyclic-shift SCS_{m,k} acting on qubits 0..m-1 of qc (k < m)."""
    # two-qubit gate (i): |01> -> sqrt(1/m)|01> + sqrt((m-1)/m)|10> on qubits (m-2, m-1)
    qc.cx(m - 2, m - 1)
    qc.cry(2.0 * np.arccos(np.sqrt(1.0 / m)), m - 1, m - 2)
    qc.cx(m - 2, m - 1)
    # three-qubit gates (ii)_l: |011> -> sqrt(l/m)|011> + sqrt((m-l)/m)|110>
    for l in range(2, k + 1):
        qc.cx(m - l - 1, m - 1)
        ccry = RYGate(2.0 * np.arccos(np.sqrt(l / m))).control(2, annotated=False)
        qc.append(ccry, [m - 1, m - l, m - l - 1])
        qc.cx(m - l - 1, m - 1)


def dicke_circuit(n: int, k: int) -> QuantumCircuit:
    """Circuit U with U|0^n> = |D^n_k>."""
    if not 0 <= k <= n:
        raise ValueError(f"need 0 <= k <= n, got n={n}, k={k}")
    qc = QuantumCircuit(n, name=f"dicke_{n}_{k}")
    if n == 0 or k == 0:
        return qc
    if k == n:
        qc.x(range(n))
        return qc
    if k > n // 2:
        # |D^n_k> = X^(tensor n) |D^n_(n-k)>  (fewer gates)
        qc.compose(dicke_circuit(n, n - k), inplace=True)
        qc.x(range(n))
        return qc
    qc.x(range(n - k, n))
    for m in range(n, k, -1):
        _scs(qc, m, k)
    for m in range(k, 1, -1):
        _scs(qc, m, m - 1)
    return qc


def dicke_statevector(n: int, k: int) -> np.ndarray:
    """Analytic |D^n_k> amplitudes (for tests)."""
    from math import comb
    vec = np.zeros(1 << n)
    for i in range(1 << n):
        if bin(i).count("1") == k:
            vec[i] = 1.0
    return vec / np.sqrt(comb(n, k))
