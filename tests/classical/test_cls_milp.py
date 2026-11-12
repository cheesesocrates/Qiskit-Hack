"""C03: the MILP optimum equals the brute-force optimum (Area 2)."""
from __future__ import annotations

import pytest

from src.classical.exact import brute_force
from src.classical.milp import exact_reference, solve_milp
from src.data.generator import generate
from src.data.scenarios import SCENARIOS

W2 = {"hardship": 0.8, "fairness": 1.7, "consecutive": 3.0}


def instances() -> dict:
    out = {f"6x2_seed{s}": generate(6, 2, seed=s, protected={2: "hospital"}) for s in (1, 2, 3, 4)}
    out["7x3_prevoff_weights"] = generate(7, 3, quotas=[2, 3, 1], seed=9, protected={1: "telecom", 4: "hospital"},
                                          prev_off=[1, 0, 1, 0, 0, 1, 0], weights=W2)
    out["5x3_seed12"] = generate(5, 3, seed=12, protected={0: "water_pump"})
    for name in ("base", "heatwave_cap", "block_4x2", "scale_8x2"):
        out[name] = SCENARIOS[name]()[0]
    return out


@pytest.mark.check(id="C03", name="MILP optimum equals brute-force optimum")
def test_milp_equals_brute_force(check_detail):
    n = 0
    for name, inst in instances().items():
        bf = brute_force(inst)
        lo = solve_milp(inst, sense="min")
        hi = solve_milp(inst, sense="max")
        assert lo["status"] == "optimal" and hi["status"] == "optimal"
        assert lo["cost"] == pytest.approx(bf["cost_min"], abs=1e-6), name
        assert hi["cost"] == pytest.approx(bf["cost_max"], abs=1e-6), name
        assert inst.is_valid(lo["bits"]) and inst.is_valid(hi["bits"]), name
        assert lo["bits"] in bf["optimal_bits"], name
        n += 1
    check_detail(f"min and max agree with brute force on {n} instances (12-24 variables), all MILP plans valid")


def test_exact_reference_milp_branch_matches_brute_branch():
    for name in ("base", "heatwave_cap", "scale_6x2"):
        inst = SCENARIOS[name]()[0]
        a = exact_reference(inst)                     # brute force
        b = exact_reference(inst, max_brute=0)        # forced MILP
        assert a["method"] == "brute_force" and b["method"] == "milp"
        assert b["n_optimal"] is None and len(b["optimal_bits"]) == 1
        assert a["cost_min"] == pytest.approx(b["cost_min"], abs=1e-6)
        assert a["cost_max"] == pytest.approx(b["cost_max"], abs=1e-6)
        assert a["n_valid"] == b["n_valid"]
        assert b["optimal_bits"][0] in a["optimal_bits"]


def test_exact_reference_shape_and_cap():
    inst = SCENARIOS["scale_12x2"]()[0]
    ex = exact_reference(inst)
    assert set(ex) == {"method", "cost_min", "cost_max", "n_valid", "n_optimal", "optimal_bits"}
    assert len(ex["optimal_bits"]) <= 200 and ex["optimal_bits"] == sorted(ex["optimal_bits"])
    assert ex["n_optimal"] >= len(ex["optimal_bits"])
    big = SCENARIOS["scale_20x2"]()[0]
    r = exact_reference(big)
    assert r["method"] == "milp" and r["n_valid"] > 200_000 and r["cost_min"] < r["cost_max"]
