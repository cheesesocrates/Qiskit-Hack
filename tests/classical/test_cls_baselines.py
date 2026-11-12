"""C04, C05, C06: baselines, the heatwave_cap scenario, reproducibility (Area 2)."""
from __future__ import annotations

import json

import numpy as np
import pytest

from src.audit.rules import audit
from src.classical.baselines import random_valid, random_valid_stats, round_robin
from src.classical.exact import enumerate_valid
from src.classical.milp import exact_reference
from src.classical.plans import build_plans
from src.cost.metrics import approx_ratio
from src.data.generator import generate
from src.data.scenarios import SCENARIOS
from src.export.writer import strip_volatile, with_meta


@pytest.mark.check(id="C04", name="Round-robin and random-valid baselines always return valid plans")
def test_baselines_always_valid(check_detail):
    n_rr = n_rv = 0
    for name, build in SCENARIOS.items():
        inst, _ = build()
        for start in range(len(inst.free) + 2):
            bits = round_robin(inst, start)
            assert inst.is_valid(bits), (name, start)
            n_rr += 1
        rng = np.random.default_rng(123)
        for _ in range(150):
            bits = random_valid(inst, rng)
            assert inst.is_valid(bits), name
            a = audit(inst, bits)["per_rule"]
            assert a["quota"]["passed"] and a["protected"]["passed"]
            n_rv += 1
    check_detail(f"{n_rr} round-robin plans and {n_rv} random plans valid across {len(SCENARIOS)} scenarios")


def test_round_robin_pointer_semantics():
    inst = generate(4, 2, quotas=[2, 1], seed=1, protected={3: "telecom"})   # free = 0, 1, 2
    assert inst.to_matrix(round_robin(inst, 0)).tolist() == [[1, 1, 0, 0], [0, 0, 1, 0]]
    assert inst.to_matrix(round_robin(inst, 1)).tolist() == [[0, 1, 1, 0], [1, 0, 0, 0]]   # wraps around
    assert round_robin(inst, 0) == round_robin(inst, 3)                                     # start is modulo n_free


def test_random_valid_is_uniform_per_hour():
    inst = generate(4, 1, quotas=[2], seed=1, protected={3: "telecom"})     # 3 equally likely pairs
    rng = np.random.default_rng(5)
    counts: dict = {}
    for _ in range(3000):
        b = random_valid(inst, rng)
        counts[b] = counts.get(b, 0) + 1
    assert len(counts) == 3 and all(900 < c < 1100 for c in counts.values()), counts


@pytest.mark.check(id="C05", name="Scenario heatwave_cap: round-robin and random fail the cap, the exact plan passes")
def test_heatwave_cap_baselines_fail(check_detail):
    inst, _ = SCENARIOS["heatwave_cap"]()
    assert inst.rules["max_consecutive"] == 1 and any(inst.prev_off)
    exact = exact_reference(inst)
    opt = exact["optimal_bits"][0]
    a_opt = audit(inst, opt)
    assert inst.is_valid(opt) and a_opt["passed"] and a_opt["score"] == 100.0

    rr = round_robin(inst)
    a_rr = audit(inst, rr)
    c_opt, c_rr = inst.evaluate(opt), inst.evaluate(rr)
    ratio_rr = approx_ratio(c_rr, exact["cost_min"], exact["cost_max"])
    assert inst.is_valid(rr) and not a_rr["passed"]
    assert a_rr["per_rule"]["max_consecutive"]["count"] >= 1
    assert c_rr >= 2.0 * c_opt and ratio_rr < 0.8

    stats = random_valid_stats(inst, exact, n_samples=2000, seed=1007)
    assert stats["cap_violation_pct"] >= 90.0 and stats["mean_approx_ratio"] < 0.8 and stats["p_optimal"] < 0.01

    # the exact optimum is also the best of all plans that pass every audit rule
    n_pass, best = 0, float("inf")
    n_valid = 0
    for x in enumerate_valid(inst):
        n_valid += 1
        if audit(inst, x)["passed"]:
            n_pass += 1
            best = min(best, inst.evaluate(x))
    assert best == pytest.approx(exact["cost_min"], abs=1e-9)
    check_detail(
        f"exact cost {c_opt:.2f}, audit passes; round-robin cost {c_rr:.2f} ({c_rr / c_opt:.1f}x, approx ratio {ratio_rr:.2f}, "
        f"{len(a_rr['violations'])} violations); random-valid breaks the cap in {stats['cap_violation_pct']:.1f}% of "
        f"{stats['n_samples']} samples (mean ratio {stats['mean_approx_ratio']:.2f}); {n_pass} of {n_valid} valid plans pass the audit")


@pytest.mark.check(id="C06", name="Fixed seed reproduces identical instance and plans")
def test_fixed_seed_reproduces(check_detail):
    names = ("base", "heatwave_cap", "block_4x2", "scale_8x2", "scale_16x2")
    for name in names:
        a, b = SCENARIOS[name](), SCENARIOS[name]()
        assert json.dumps(a[0].to_dict(), sort_keys=True) == json.dumps(b[0].to_dict(), sort_keys=True)
        pa = strip_volatile(with_meta(build_plans(name, seed=7, n_samples=300), 7, "test"))
        pb = strip_volatile(with_meta(build_plans(name, seed=7, n_samples=300), 7, "test"))
        assert json.dumps(pa, sort_keys=True) == json.dumps(pb, sort_keys=True), name
    other = build_plans("heatwave_cap", seed=8, n_samples=300)["random_valid_stats"]
    same = build_plans("heatwave_cap", seed=7, n_samples=300)["random_valid_stats"]
    assert other != same           # the seed really drives the random draws
    check_detail(f"{len(names)} scenarios built twice with seed 7: instance and plans files identical after strip_volatile")
