"""C01, C02, C08, C09: cost model, brute force, base instance, bit order (Area 2)."""
from __future__ import annotations

from itertools import product

import numpy as np
import pytest

from src.classical.exact import brute_force, count_valid
from src.cost.model import evaluate_pauli, evaluate_qubo
from src.data.generator import base_instance, generate
from src.data.scenarios import SCENARIOS

W = {"hardship": 1.3, "fairness": 0.7, "consecutive": 2.5}


def small_instances() -> dict:
    """Three small instances (n <= 12). The first has prev_off and a protected feeder."""
    return {
        "4x3_prevoff_protected": generate(4, 3, quotas=[1, 2, 1], seed=3, name="t1", protected={1: "hospital"},
                                          prev_off=[1, 1, 0, 1], weights=W),
        "5x2_prevoff_protected": generate(5, 2, quotas=[2, 1], seed=5, name="t2", protected={0: "water_pump"},
                                          prev_off=[1, 0, 1, 0, 1], weights=W),
        "block_4x2": SCENARIOS["block_4x2"]()[0],
    }


def all_bitstrings(n: int):
    for combo in product("01", repeat=n):
        yield "".join(combo)


def independent_valid(inst, bits: str) -> bool:
    x = np.array([int(c) for c in bits]).reshape(inst.n_hours, inst.n_feeders)
    return all(x[t].sum() == inst.quotas[t] for t in range(inst.n_hours)) and not any(x[:, f].any() for f in inst.protected)


@pytest.mark.check(id="C01", name="Cost model equals QUBO and Pauli forms on every bitstring")
def test_cost_equals_qubo_and_pauli(check_detail):
    total, worst = 0, 0.0
    for name, inst in small_instances().items():
        assert inst.n_vars <= 12
        offset, linear, quad = inst.qubo_total()
        pauli = inst.pauli_terms()
        for bits in all_bitstrings(inst.n_vars):
            c = inst.evaluate(bits)
            cq = evaluate_qubo(offset, linear, quad, bits)
            cp = evaluate_pauli(pauli, bits)
            worst = max(worst, abs(c - cq), abs(c - cp))
            assert cq == pytest.approx(c, rel=1e-9, abs=1e-9), (name, bits)
            assert cp == pytest.approx(c, rel=1e-9, abs=1e-9), (name, bits)
            total += 1
    check_detail(f"{total} bitstrings over 3 instances (8-12 variables), max |diff| {worst:.1e}")


@pytest.mark.check(id="C02", name="Brute force over valid plans equals the minimum over all 2^n bitstrings filtered by validity")
def test_brute_force_equals_filtered_full_enumeration(check_detail):
    parts = []
    for name, inst in small_instances().items():
        valid = [(b, inst.evaluate(b)) for b in all_bitstrings(inst.n_vars) if independent_valid(inst, b)]
        costs = [c for _, c in valid]
        bf = brute_force(inst)
        assert bf["n_valid"] == len(valid) == count_valid(inst)
        assert bf["cost_min"] == pytest.approx(min(costs), abs=1e-9)
        assert bf["cost_max"] == pytest.approx(max(costs), abs=1e-9)
        optimal = sorted(b for b, c in valid if c <= min(costs) + 1e-9)
        assert sorted(bf["optimal_bits"]) == optimal and bf["n_optimal"] == len(optimal)
        parts.append(f"{name}: {len(valid)} valid of {2 ** inst.n_vars}")
    check_detail("; ".join(parts))


@pytest.mark.check(id="C08", name="Base instance matches the spec: 8x3, quotas 3,2,4, feeders 2 and 6 protected")
def test_base_instance_spec(check_detail):
    inst = base_instance()
    assert (inst.n_feeders, inst.n_hours) == (8, 3)
    assert inst.quotas == [3, 2, 4]
    assert inst.protected == [2, 6]
    assert inst.feeders[2]["kind"] == "hospital" and inst.feeders[6]["kind"] == "water_pump"
    assert inst.n_vars == 24 and len(inst.free) == 6
    assert all(inst.hardship[t][f] >= 0 for t in range(3) for f in range(8))
    n_valid = count_valid(inst)
    assert n_valid == 20 * 15 * 15
    sc, _ = SCENARIOS["base"]()
    assert sc.to_dict() == inst.to_dict()
    check_detail(f"8x3, quotas {inst.quotas}, protected {inst.protected}, 24 variables (18 free), {n_valid} valid plans")


@pytest.mark.check(id="C09", name="Bit order: bits[t*N+f] equals matrix[t][f]")
def test_bit_order(check_detail):
    rng = np.random.default_rng(0)
    n_checked = 0
    for name, build in SCENARIOS.items():
        inst, _ = build()
        N, T = inst.n_feeders, inst.n_hours
        for _ in range(5):
            m = rng.integers(0, 2, size=(T, N))
            bits = inst.to_bits(m)
            assert len(bits) == T * N
            for t in range(T):
                for f in range(N):
                    assert bits[t * N + f] == str(m[t][f]) == str(inst.to_matrix(bits)[t][f])
                    n_checked += 1
        # a single set bit: hour 1, feeder 2 lands on index N + 2, and the QUBO hardship uses that index
        single = np.zeros((T, N), dtype=int)
        f = inst.free[1]
        single[T - 1, f] = 1
        assert inst.to_bits(single).index("1") == (T - 1) * N + f == inst.q(T - 1, f)
        lin = inst.qubo_terms()["hardship"]["linear"]
        assert lin[(T - 1) * N + f] == pytest.approx(inst.hardship[T - 1][f])
    check_detail(f"{n_checked} (hour, feeder) cells checked across {len(SCENARIOS)} scenarios; index q = t*N + f")
