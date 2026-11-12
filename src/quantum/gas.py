"""Grover Adaptive Search comparator (Area 1): qiskit-optimization GroverOptimizer on a small block.

What it does
------------
* Reads the 8-variable `block_4x2` scenario (4 feeders x 2 hours, one protected feeder, so 6
  compact variables) from results/plans (written by Area 2).
* Builds the penalised QUBO  C(x) + P * sum_t (sum_k x[t,k] - m_t)^2  over the compact variables
  (QProblem.penalty_qubo). GroverOptimizer encodes objective values as integers in a two's
  complement value register, so every coefficient is multiplied by a scale factor and rounded.
  The scale is the smallest integer in 1..12 that makes all coefficients integral; otherwise 12
  is used and the largest rounding error is reported in the notes.
* Runs GroverOptimizer (qiskit-optimization 0.7.0) `n_runs` times with different seeds on the
  Aer SamplerV2 simulator (circuits transpiled for Aer, optimisation level 1), and scores each returned plan with the true,
  unscaled, unpenalised cost against the exact reference.

Each "sample" in the ablation row is the final answer of one complete GAS run, so
`p_optimal` is the fraction of runs that returned an optimal valid plan. Simulator only; at
6 variables classical enumeration gives the exact answer, so no speed-up is claimed.
"""
from __future__ import annotations

import math
import time

import numpy as np
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_aer import AerSimulator
from qiskit_aer.primitives import SamplerV2 as AerSamplerV2
from qiskit_optimization import QuadraticProgram
from qiskit_optimization.algorithms import GroverOptimizer
from qiskit_optimization.utils import algorithm_globals

from src.quantum.io import load_scenario
from src.quantum.problem import TOL, QProblem

N_RUNS = 20
SHOTS = 1024
NUM_ITERATIONS = 3          # GroverOptimizer stops after this many non-improving iterations


def _integer_scale(values: list) -> tuple:
    """(scale, max_rounding_error_after_scaling)."""
    for s in range(1, 13):
        err = max(abs(v * s - round(v * s)) for v in values)
        if err < 1e-6:
            return s, err
    s = 12
    return s, max(abs(v * s - round(v * s)) for v in values)


def build_program(qp: QProblem, strength: float) -> tuple:
    """(QuadraticProgram over compact variables, scale, rounding error, integer value range)."""
    offset, lin, quad = qp.penalty_qubo(strength)
    coeffs = [offset] + list(lin) + list(quad.values())
    scale, err = _integer_scale(coeffs)
    prog = QuadraticProgram("fairshed_block")
    for c in range(qp.n):
        prog.binary_var(name=f"x{c}")
    prog.minimize(constant=int(round(offset * scale)),
                  linear={f"x{c}": int(round(v * scale)) for c, v in enumerate(lin) if round(v * scale) != 0},
                  quadratic={(f"x{a}", f"x{b}"): int(round(v * scale)) for (a, b), v in quad.items()
                             if round(v * scale) != 0})
    # exact range of the integer objective over all 2^n strings, to size the value register
    bits = qp._bit_table()
    ilin = np.array([round(v * scale) for v in lin], dtype=float)
    iquad = {k: float(round(v * scale)) for k, v in quad.items()}
    vec = QProblem.qubo_vector(float(round(offset * scale)), ilin, iquad, bits)
    return prog, scale, err, (float(vec.min()), float(vec.max()))


def run_gas(scenario: str = "block_4x2", seed: int = 7, n_runs: int = N_RUNS, shots: int = SHOTS) -> list:
    """Return the ablation rows (one row) for Grover Adaptive Search on `scenario`."""
    sc = load_scenario(scenario)
    qp = QProblem(sc["instance"])
    ref = qp.reference()
    strength = qp.default_penalty()
    prog, scale, err, (vmin, vmax) = build_program(qp, strength)
    # value register must hold any difference (value - threshold) in two's complement
    span = vmax - vmin
    n_value = int(math.ceil(math.log2(span + 1))) + 1

    pm = generate_preset_pass_manager(optimization_level=1, backend=AerSimulator(), seed_transpiler=seed)
    t0 = time.perf_counter()
    answers = []
    for r in range(n_runs):
        run_seed = seed * 1000 + r
        algorithm_globals.random_seed = run_seed
        sampler = AerSamplerV2(default_shots=shots, seed=run_seed)
        gas = GroverOptimizer(num_value_qubits=n_value, num_iterations=NUM_ITERATIONS, sampler=sampler,
                              pass_manager=pm)
        res = gas.solve(prog)
        idx = sum(int(round(v)) << c for c, v in enumerate(res.x))
        bits = qp.index_to_bits(idx)
        answers.append(bits)
    runtime = time.perf_counter() - t0

    valid = [b for b in answers if qp.is_valid_bits(b)]
    costs = [qp.cost_of_bits(b) for b in answers]
    ratios = [qp.approx_ratio(c, ref["cost_min"], ref["cost_max"], qp.is_valid_bits(b))
              for b, c in zip(answers, costs)]
    n_opt = sum(1 for b, c in zip(answers, costs) if qp.is_valid_bits(b) and c <= ref["cost_min"] + TOL)
    best = min(valid, key=qp.cost_of_bits) if valid else None
    hours = np.mean([qp.plan_hours(b) for b in answers], axis=0).tolist()
    distinct = len(set(answers))
    notes = (f"GroverOptimizer (qiskit-optimization 0.7.0), {n_runs} independent runs with seeds "
             f"{seed * 1000}..{seed * 1000 + n_runs - 1}, Aer SamplerV2 (statevector simulator) with {shots} shots per "
             f"circuit, num_iterations={NUM_ITERATIONS}. Quota enforced as a penalty of strength {strength:.3f}; "
             f"coefficients multiplied by {scale} and rounded to integers (largest rounding error "
             f"{err:.2e} in scaled units). {qp.n} key qubits + {n_value} value qubits. Each sample is the "
             f"final answer of one full run: {len(valid)} of {n_runs} valid, {n_opt} of {n_runs} optimal, "
             f"{distinct} distinct answers. Costs are the true unscaled cost. Simulator only; no speed-up claimed.")
    return [{
        "method": "grover_adaptive_search", "label": "Grover Adaptive Search (GroverOptimizer)",
        "kind": "quantum", "instance": scenario, "n_qubits": qp.n + n_value, "layers": None,
        "shots": n_runs, "feasibility_pct": 100.0 * len(valid) / n_runs, "p_optimal": n_opt / n_runs,
        "approx_ratio": float(np.mean(ratios)), "fairness_entropy": qp.fairness_entropy(hours),
        "runtime_s": round(runtime, 3), "best_cost": None if best is None else qp.cost_of_bits(best),
        "best_bits": best, "notes": notes,
    }]


if __name__ == "__main__":
    import json
    print(json.dumps(run_gas(), indent=2))
