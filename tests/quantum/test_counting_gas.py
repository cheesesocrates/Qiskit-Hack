"""Counting (IAE) and Grover Adaptive Search checks (Area 1)."""
from __future__ import annotations

import pytest

from src.quantum.counting import count_valid_plans, exact_valid_count
from src.quantum.gas import run_gas
from src.quantum.io import load_scenario
from tests.quantum import helpers as H


@pytest.mark.check(id="Q10", name="Quantum counting (IAE) of valid plans is within tolerance of exact enumeration")
def test_counting_within_tolerance(check_detail):
    cases = [load_scenario("block_4x2")["instance"],
             H.make_instance(3, 2, (1, 2), (), seed=4)]
    details = []
    for inst in cases:
        out = count_valid_plans(inst, epsilon_target=0.01, alpha=0.05, seed=7)
        exact = exact_valid_count(int(inst["n_feeders"]), int(inst["n_hours"]), inst["quotas"],
                                  sorted(f["id"] for f in inst["feeders"] if f["protected"]))
        assert out["exact_count"] == exact
        assert out["within_tolerance"], out
        assert abs(out["estimated_count"] - exact) <= out["tolerance"] + 1e-9
        details.append(f"{inst['n_feeders']}x{inst['n_hours']}: exact {exact}, estimate {out['estimated_count']:.2f}")
    check_detail("; ".join(details))


@pytest.mark.check(id="Q11", name="Grover Adaptive Search returns plans scored with the true cost")
def test_gas_rows_consistent(check_detail):
    row = run_gas(scenario="block_4x2", seed=7, n_runs=2)[0]
    sc = load_scenario("block_4x2")
    assert row["kind"] == "quantum" and row["shots"] == 2
    assert 0.0 <= row["p_optimal"] <= row["feasibility_pct"] / 100.0 + 1e-12
    if row["best_cost"] is not None:
        assert row["best_cost"] >= sc["exact"]["cost_min"] - 1e-9
        assert len(row["best_bits"]) == sc["instance"]["n_feeders"] * sc["instance"]["n_hours"]
    check_detail(f"2 runs: {row['feasibility_pct']:.0f}% valid, P(optimal) {row['p_optimal']:.2f}, "
                 f"best cost {row['best_cost']} vs exact {sc['exact']['cost_min']:.4f}")
