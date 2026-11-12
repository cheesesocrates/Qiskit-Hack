"""Quantum counting of valid plans (the "flexibility" number) by iterative amplitude estimation.

Question answered: how many of the 2^(T*N) on/off patterns are valid plans (quota met in every
hour AND every protected feeder on)? That count is the number of fair choices the planner has.

Circuit (a real reversible validity check, not a lookup table)
---------------------------------------------------------------
* Search register: all T*N logical qubits, qubit q = t*N + f, in uniform superposition (H on all).
* For each hour t a small sum register s_t (bit_length(N) qubits) is built with N controlled
  increments (one per feeder). Each increment is a ripple of multi-controlled X gates, so s_t
  holds the Hamming weight of hour t.
* eq_t = 1 iff s_t == quotas[t]  (one multi-controlled X with a control pattern).
* flag = AND(eq_0 .. eq_{T-1}, NOT x_p for every protected qubit p)  (one multi-controlled X).

A = H on the search register followed by the validity check, so
    A|0> = sqrt(1-a) |bad> |0>_flag + sqrt(a) |good> |1>_flag,   a = (#valid) / 2^(T*N).
The sum/eq qubits keep "garbage" (the counts); that is fine for amplitude estimation because
Q = A S_0 A^dagger S_f is built on the full register. IAE estimates a, and count = a * 2^(T*N).

Simulator only (Aer statevector, seeded). At 8 search qubits the answer is trivial to get
classically, by enumeration (done here as the reference); no quantum speed-up is claimed.
"""
from __future__ import annotations

import time
from functools import lru_cache
from math import log2
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_aer import AerSimulator
from qiskit_aer.primitives import SamplerV2 as _AerSamplerV2
from qiskit_algorithms import EstimationProblem, IterativeAmplitudeEstimation

from src.quantum.io import load_scenario, write_result

SOURCE = "src/quantum/counting.py"
DEFAULT_SHOTS = 100          # shots per IAE round (the value used in the IAE paper)


# --------------------------------------------------------------------------------------
# Simulator plumbing shared with risk.py
# --------------------------------------------------------------------------------------
class SeededAerSampler(_AerSamplerV2):
    """Aer SamplerV2 whose simulator seed advances on every run() call.

    A plain `SamplerV2(seed=s)` reuses the same seed for every circuit, which would make all IAE
    rounds draw correlated shot noise. Here round k uses seed + k, so rounds are independent
    but the whole sequence is still fully reproducible from `seed`.
    """

    def __init__(self, seed: int, default_shots: int = DEFAULT_SHOTS):
        super().__init__(default_shots=default_shots, seed=int(seed))
        self._base_seed = int(seed)
        self._calls = 0

    def run(self, pubs, *, shots=None):
        self._seed = self._base_seed + self._calls
        self._calls += 1
        return super().run(pubs, shots=shots)


@lru_cache(maxsize=1)
def aer_pass_manager():
    """Level-0 pass manager for Aer: unrolls the composite Grover gate Q^k into Aer's basis."""
    return generate_preset_pass_manager(optimization_level=0, backend=AerSimulator())


def make_iae(epsilon_target: float, alpha: float, seed: int, shots: int = DEFAULT_SHOTS):
    """IterativeAmplitudeEstimation(epsilon_target, alpha, sampler=<seeded Aer V2>, transpiler=pm).

    Verified against qiskit-algorithms 0.4.0: sampler must be a primitives V2 sampler and Aer
    circuits must be transpiled, which is what the `transpiler` argument is for.
    """
    return IterativeAmplitudeEstimation(
        epsilon_target=epsilon_target, alpha=alpha,
        sampler=SeededAerSampler(seed, shots), transpiler=aer_pass_manager())


# --------------------------------------------------------------------------------------
# The validity circuit
# --------------------------------------------------------------------------------------
def protected_ids(instance: dict) -> list:
    return sorted(int(f["id"]) for f in instance["feeders"] if f["protected"])


def build_validity_oracle(n_feeders: int, n_hours: int, quotas, protected) -> tuple:
    """Reversible validity check on |x>|0...0>. Returns (circuit, layout).

    layout: x (search qubits), sums (per-hour sum registers, little-endian), eq (per-hour flags),
    flag (the objective qubit). The circuit contains no Hadamards; it is a permutation of basis
    states (X / CX / multi-controlled X only), so it can be tested on classical inputs.
    """
    N, T = int(n_feeders), int(n_hours)
    quotas = [int(m) for m in quotas]
    protected = sorted(int(p) for p in protected)
    n = N * T
    w = N.bit_length()                                   # enough bits to hold a weight of 0..N
    x = list(range(n))
    sums = [list(range(n + t * w, n + (t + 1) * w)) for t in range(T)]
    eq = [n + T * w + t for t in range(T)]
    flag = n + T * w + T
    qc = QuantumCircuit(flag + 1, name="validity")
    for t in range(T):
        reg = sums[t]
        for f in range(N):                               # controlled increment of s_t by x[t*N+f]
            xq = t * N + f
            for j in reversed(range(w)):                 # MSB first so carries read the old low bits
                ctrls = [xq] + reg[:j]
                if len(ctrls) == 1:
                    qc.cx(ctrls[0], reg[j])
                else:
                    qc.mcx(ctrls, reg[j])
        qc.mcx(reg, eq[t], ctrl_state=quotas[t])         # eq_t = [s_t == quotas[t]]
    prot_q = [t * N + f for t in range(T) for f in protected]
    # flag = AND(eq_t = 1 for all t, protected qubits = 0); ctrl_state bit i belongs to control i
    ctrls = eq + prot_q
    state = (1 << T) - 1                                 # eq bits must be 1, protected bits 0
    qc.mcx(ctrls, flag, ctrl_state=state)
    layout = {"x": x, "sums": sums, "eq": eq, "flag": flag, "width": w}
    return qc, layout


def build_state_preparation(n_feeders, n_hours, quotas, protected) -> tuple:
    """A = H on the search register + validity check. Returns (circuit, layout)."""
    oracle, layout = build_validity_oracle(n_feeders, n_hours, quotas, protected)
    qc = QuantumCircuit(oracle.num_qubits, name="A")
    qc.h(layout["x"])
    qc.compose(oracle, inplace=True)
    return qc, layout


def classical_valid(x_int: int, n_feeders: int, n_hours: int, quotas, protected) -> bool:
    """Reference validity of search string x_int (bit q = variable q = t*N + f)."""
    for t in range(n_hours):
        row = [(x_int >> (t * n_feeders + f)) & 1 for f in range(n_feeders)]
        if sum(row) != quotas[t] or any(row[p] for p in protected):
            return False
    return True


def exact_valid_count(n_feeders: int, n_hours: int, quotas, protected) -> int:
    """Our own enumeration of all 2^(T*N) strings (independent of Area 2's n_valid)."""
    return sum(classical_valid(i, n_feeders, n_hours, quotas, protected)
               for i in range(1 << (n_feeders * n_hours)))


# --------------------------------------------------------------------------------------
# Counting
# --------------------------------------------------------------------------------------
def count_valid_plans(instance: dict, epsilon_target: float = 0.01, alpha: float = 0.05,
                      seed: int = 7) -> dict:
    """Estimate the number of valid plans with IAE; returns the counting-schema payload."""
    N, T = int(instance["n_feeders"]), int(instance["n_hours"])
    quotas = [int(m) for m in instance["quotas"]]
    prot = protected_ids(instance)
    n = N * T
    space = 1 << n

    state_prep, layout = build_state_preparation(N, T, quotas, prot)
    problem = EstimationProblem(state_preparation=state_prep, objective_qubits=[layout["flag"]])
    t0 = time.time()
    res = make_iae(epsilon_target, alpha, seed).estimate(problem)
    runtime = time.time() - t0

    a_lo, a_hi = (float(v) for v in res.confidence_interval)
    estimate = float(res.estimation) * space
    ci = [a_lo * space, a_hi * space]
    half = (ci[1] - ci[0]) / 2.0
    exact = exact_valid_count(N, T, quotas, prot)
    tolerance = max(half, 1.0)
    within = bool(ci[0] <= exact <= ci[1] or abs(estimate - exact) <= tolerance)
    notes = (
        f"Iterative amplitude estimation (qiskit-algorithms IterativeAmplitudeEstimation, "
        f"epsilon_target={epsilon_target} on the amplitude a = count/{space}, confidence "
        f"{1 - alpha:.0%}, {DEFAULT_SHOTS} shots per round, Grover powers {list(res.powers)}) on the "
        f"Aer statevector SIMULATOR, seeded. The oracle is a reversible circuit: per-hour Hamming "
        f"weight by controlled increments, comparison with the quota, AND with 'protected feeders "
        f"are on'. Tolerance = max(CI half-width in counts, 1 plan) = {tolerance:.3f}; "
        f"within_tolerance means the exact count is inside the CI or within the tolerance of the "
        f"estimate. The exact count comes from enumerating all {space} strings; at "
        f"{n} search qubits this is classically trivial, so no quantum speed-up is claimed. "
        f"oracle_queries counts shots x Grover power over all rounds (Q-calls, from the IAE "
        f"result). Runtime of the simulation: {runtime:.2f} s."
    )
    return {
        "method": "iterative_amplitude_estimation",
        "instance": {"n_feeders": N, "n_hours": T, "quotas": quotas, "protected": prot},
        "n_qubits_search": n,
        "n_qubits_total": int(state_prep.num_qubits),
        "search_space": space,
        "exact_count": int(exact),
        "estimated_count": float(estimate),
        "estimated_count_rounded": int(round(estimate)),
        "ci": [float(ci[0]), float(ci[1])],
        "tolerance": float(tolerance),
        "within_tolerance": within,
        "epsilon_target": float(epsilon_target),
        "confidence_alpha": float(alpha),
        "oracle_queries": int(res.num_oracle_queries),
        "flexibility_bits": float(log2(exact)) if exact > 0 else 0.0,
        "notes": notes,
    }


def run_counting(seed: int = 7, scenario: str = "block_4x2") -> Path:
    """Count the valid plans of results/plans/<scenario>.json and write results/counting.json."""
    sc = load_scenario(scenario)
    payload = count_valid_plans(sc["instance"], epsilon_target=0.01, alpha=0.05, seed=seed)
    n_valid_file = int(sc["exact"]["n_valid"])
    if payload["exact_count"] != n_valid_file:
        raise RuntimeError(
            f"our enumeration found {payload['exact_count']} valid plans but "
            f"results/plans/{scenario}.json says exact.n_valid = {n_valid_file}")
    payload["notes"] += f" Cross-check: enumeration equals exact.n_valid = {n_valid_file} in the plans file."
    return write_result("counting.json", payload, seed, SOURCE)


if __name__ == "__main__":
    print(run_counting())
