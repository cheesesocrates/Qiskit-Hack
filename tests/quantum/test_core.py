"""Core quantum checks (Area 1): mapping, Dicke states, mixers, bit order, reproducibility."""
from __future__ import annotations

import json
from math import comb

import numpy as np
import pytest
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator

from src.quantum.circuits import qubo_to_ising, state_prep
from src.quantum.dicke import dicke_circuit, dicke_statevector
from src.quantum.problem import QProblem
from src.quantum.qaoa import QAOARunner, tie_groups
from src.quantum.stages import decide, solve_window
from tests.quantum import helpers as H

SMALL = [H.make_instance(4, 2, (2, 1), (3,), seed=1),
         H.make_instance(4, 3, (1, 2, 1), (1,), seed=2, prev_off=[1, 0, 0, 1]),
         H.make_instance(5, 2, (2, 2), (2,), seed=3)]


@pytest.mark.check(id="Q01", name="Quantum cost table and Ising form equal the contract cost on every bitstring")
def test_cost_table_matches_contract(check_detail):
    n_checked = 0
    for inst in SMALL:
        qp = QProblem(inst)
        vec = qp.cost_vector()
        const, h, J = qp.ising()
        for i in range(1 << qp.n):
            bits = qp.index_to_bits(i)
            direct = H.direct_cost(inst, bits)
            z = [1 - 2 * ((i >> c) & 1) for c in range(qp.n)]
            ising = const + sum(h[a] * z[a] for a in range(qp.n)) + sum(v * z[a] * z[b] for (a, b), v in J.items())
            assert abs(vec[i] - direct) < 1e-9 and abs(ising - direct) < 1e-9
            assert abs(qp.cost_of_bits(bits) - direct) < 1e-9
            assert bool(qp.feasible_mask()[i]) == H.is_valid(inst, bits)
            n_checked += 1
    check_detail(f"{n_checked} bitstrings over {len(SMALL)} instances: table = Ising = direct formula")


@pytest.mark.check(id="Q02", name="Dicke preparation gives uniform weight-m states")
def test_dicke_states(check_detail):
    worst, cases = 0.0, 0
    for n in range(1, 8):
        for k in range(0, n + 1):
            sv = Statevector(dicke_circuit(n, k)).data
            worst = max(worst, float(np.abs(sv - dicke_statevector(n, k)).max()))
            cases += 1
    assert worst < 1e-9
    # and the per-hour product state is uniform over exactly the valid plans
    inst = SMALL[1]
    qp = QProblem(inst)
    probs = np.abs(Statevector(state_prep(qp)).data) ** 2
    feas = qp.feasible_mask()
    assert abs(probs[feas].sum() - 1) < 1e-9 and np.allclose(probs[feas], 1 / qp.n_valid())
    check_detail(f"{cases} (n, k) pairs up to n=7, max amplitude error {worst:.1e}; "
                 f"block product uniform over {qp.n_valid()} valid plans")


@pytest.mark.check(id="Q03", name="Bit order: Qiskit count keys map to the right (hour, feeder) cell")
def test_bit_order(check_detail):
    inst = H.make_instance(4, 3, (1, 2, 1), (1,), seed=2)
    qp = QProblem(inst)
    sim = AerSimulator(method="statevector")
    for c in range(qp.n):
        qc = QuantumCircuit(qp.n)
        qc.x(c)
        qc.measure_all()
        key = next(iter(sim.run(transpile(qc, sim), shots=8).result().get_counts()))
        bits = qp.key_to_bits(key)
        t, k = divmod(c, qp.n_free)
        f = qp.free[k]
        assert bits.count("1") == 1 and bits[t * qp.N + f] == "1", (c, key, bits)
        assert qp.bits_to_matrix(bits)[t][f] == 1
        assert key[qp.n - 1 - c] == "1"                       # Qiskit puts qubit 0 on the right
        assert qp.bits_to_index(bits) == 1 << c
        assert all(bits[tt * qp.N + pf] == "0" for tt in range(qp.T) for pf in qp.protected)
    check_detail(f"{qp.n} single-qubit flips: key[n-1-c] -> bits[t*N+f] -> matrix[t][f], protected stay 0")


def _all_valid(inst, kind, p, seed, shots=2000):
    qp = QProblem(inst)
    runner = QAOARunner(qp, kind, p, seed=seed)
    theta = np.random.default_rng(seed).uniform(-2, 2, size=2 * p)
    counts = runner.sample(theta, shots=shots, seed=seed)
    bad = [k for k in counts if not H.is_valid(inst, qp.key_to_bits(k))]
    outside = float(runner.probabilities(theta)[~qp.feasible_mask()].sum())
    return sum(counts.values()), len(counts), bad, outside


@pytest.mark.check(id="Q04", name="Every sampled bitstring from the Dicke + XY-mixer circuit is a valid plan")
def test_xy_samples_valid(check_detail):
    total = 0
    for s, inst in enumerate(SMALL):
        shots, distinct, bad, outside = _all_valid(inst, "xy", 2, seed=10 + s)
        assert not bad and outside < 1e-12
        total += shots
    check_detail(f"{total} of {total} samples valid at random angles; probability outside the valid subspace < 1e-12")


@pytest.mark.check(id="Q05", name="Every sampled bitstring from the Grover-mixer circuit is a valid plan")
def test_grover_samples_valid(check_detail):
    total = 0
    for s, inst in enumerate(SMALL):
        shots, distinct, bad, outside = _all_valid(inst, "grover", 2, seed=20 + s)
        assert not bad and outside < 1e-12
        total += shots
    check_detail(f"{total} of {total} samples valid at random angles; probability outside the valid subspace < 1e-12")


@pytest.mark.check(id="Q06", name="Equal-cost plans get equal Grover-mixer amplitude")
def test_grover_equal_amplitude(check_detail):
    inst = H.make_instance(5, 2, (2, 2), (2,), seed=3)
    qp = QProblem(inst)
    runner = QAOARunner(qp, "grover", 2, seed=5)
    sv = runner.statevector([0.7, -0.4, 1.9, 0.8])
    cost, feas = qp.cost_vector(), qp.feasible_mask()
    idx = np.nonzero(feas)[0]
    keys = np.round(cost[idx], 9)
    groups, worst = 0, 0.0
    for c in np.unique(keys):
        amps = sv[idx[keys == c]]
        if len(amps) > 1:
            groups += 1
            worst = max(worst, float(np.abs(amps - amps[0]).max()))
    assert groups >= 1, "test instance has no tied plans"
    assert worst < 1e-9
    # the XY mixer gives no such guarantee; record its spread for contrast (not asserted)
    xy = QAOARunner(qp, "xy", 2, seed=5)
    xy_spread = max((g["prob_spread"] for g in tie_groups(qp, xy.probabilities([0.7, -0.4, 1.9, 0.8]))), default=0.0)
    check_detail(f"{groups} tie groups, max complex-amplitude difference {worst:.1e} "
                 f"(XY mixer on the same instance: probability spread {xy_spread:.1e})")


@pytest.mark.check(id="Q07", name="Fixed seed reproduces QAOA angles and samples")
def test_seed_reproducible(check_detail):
    inst = SMALL[0]
    out = []
    for _ in range(2):
        qp = QProblem(inst)
        runner = QAOARunner(qp, "grover", 1, seed=7)
        opt = runner.optimize(maxiter=30)
        out.append((opt["theta"], runner.sample(opt["theta"], shots=500, seed=7)))
    assert out[0][0] == out[1][0] and out[0][1] == out[1][1]
    check_detail(f"two runs: identical angles {np.round(out[0][0], 4).tolist()} and identical counts over 500 shots")


@pytest.mark.check(id="Q08", name="Penalty-QAOA objective equals cost plus quota penalty on every bitstring")
def test_penalty_objective(check_detail):
    inst = SMALL[0]
    qp = QProblem(inst)
    A = qp.default_penalty()
    off, lin, quad = qp.penalty_qubo(A)
    vec = qp.qubo_vector(off, lin, quad, qp._bit_table())
    const, h, J = qubo_to_ising(off, lin, quad)
    for i in range(1 << qp.n):
        bits = qp.index_to_bits(i)
        viol = sum((bits[t * qp.N:(t + 1) * qp.N].count("1") - qp.quotas[t]) ** 2 for t in range(qp.T))
        assert abs(vec[i] - (H.direct_cost(inst, bits) + A * viol)) < 1e-9
    runner = QAOARunner(qp, "penalty", 1, seed=3)
    invalid = float(runner.probabilities([0.5, 0.4])[~qp.feasible_mask()].sum())
    assert invalid > 0.0
    check_detail(f"{1 << qp.n} bitstrings; at sample angles the X mixer leaves {invalid:.0%} probability on invalid plans")


@pytest.mark.check(id="Q09", name="Quantum-side reference equals the classical exact reference in plans/base.json")
def test_reference_matches_area2(check_detail):
    sc = H.load_scenario("base")
    qp = QProblem(sc["instance"])
    ref, ex = qp.reference(), sc["exact"]
    assert qp.n == 18 and qp.T * qp.N == 24
    assert abs(ref["cost_min"] - ex["cost_min"]) < 1e-9 and abs(ref["cost_max"] - ex["cost_max"]) < 1e-9
    assert ref["n_valid"] == ex["n_valid"] == comb(6, 3) * comb(6, 2) * comb(6, 4)
    assert ref["n_optimal"] == ex["n_optimal"]
    for bits in ex["optimal_bits"]:
        assert abs(qp.cost_of_bits(bits) - ex["cost_min"]) < 1e-9 and qp.is_valid_bits(bits)
        assert abs(qp.cost_vector()[qp.bits_to_index(bits)] - ex["cost_min"]) < 1e-9
    check_detail(f"18 qubits for 24 variables; cost_min {ref['cost_min']}, cost_max {ref['cost_max']}, "
                 f"{ref['n_valid']} valid, {ref['n_optimal']} optimal: identical on both sides")


def test_decide_prefers_previous_plan_among_ties():
    inst = H.make_instance(4, 2, (2, 1), (3,), seed=1)
    qp = QProblem(inst)
    valid = H.all_valid_bits(inst)
    counts = {format(qp.bits_to_index(b), f"0{qp.n}b"): 5 for b in valid}
    best = min(H.direct_cost(inst, b) for b in valid)
    pick = decide(qp, counts, seed=1)
    assert abs(pick["cost"] - best) < 1e-9 and H.is_valid(inst, pick["bits"])


def test_solve_window_roundtrip(tmp_path):
    inst = H.make_instance(4, 2, (2, 1), (3,), seed=1)
    src, dst = tmp_path / "in.json", tmp_path / "out.json"
    src.write_text(json.dumps({"instance": inst, "warm_start": None, "seed": 7}), encoding="utf-8")
    out = solve_window(str(src), str(dst))
    assert out["feasible"] and H.is_valid(inst, out["bits"])
    assert abs(out["cost"] - H.direct_cost(inst, out["bits"])) < 1e-9
    # second call warm-started from the first call's angles
    src.write_text(json.dumps({"instance": inst, "warm_start": out["warm_start"], "seed": 7}), encoding="utf-8")
    out2 = solve_window(str(src), str(dst))
    assert out2["feasible"] and out2["warm_start"]["angles_warm_started"] is True
    # an all-zero-quota window has exactly one valid plan
    zero = H.make_instance(4, 2, (0, 0), (3,), seed=1)
    src.write_text(json.dumps({"instance": zero, "warm_start": None, "seed": 7}), encoding="utf-8")
    assert solve_window(str(src), str(dst))["bits"] == "0" * 8
