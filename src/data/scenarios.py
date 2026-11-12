"""Named scenarios (Area 2). Every instance here is SYNTHETIC.

SCENARIOS[name]() returns (Instance, description). Seeds are fixed per scenario so the
results are reproducible. Zone names are illustrative Karachi labels only.

  base          8 feeders x 3 hours, quotas 3,2,4 (the spec's base case)
  heatwave_cap  8x3 afternoon heatwave with a "no two adjacent hours" cap, built so that
                round-robin and random-valid plans clearly break the cap
  block_4x2     4 feeders x 2 hours, 8 variables, 9 valid plans (counting, Grover search)
  scale_<N>x2   N feeders x 2 hours for the scaling curve (N = 6, 8, 10, 12, 16, 20)
"""
from __future__ import annotations

from src.cost.model import Instance
from src.data.generator import base_instance, generate

HEATWAVE_SEED = 11
# hardship multiplier per hour of the 14:00-17:00 window: heat stress peaks at 15:00
HEATWAVE_HOUR_FACTOR = (0.8, 1.4, 1.1)
SCALE_SIZES = (6, 8, 10, 12, 16, 20)


def _base() -> tuple:
    return base_instance(), (
        "Base case: 8 synthetic feeders x 3 evening hours (18:00-21:00), quotas 3, 2, 4. "
        "Feeder 2 is a hospital and feeder 6 a water pump, so both are never cut. "
        "Feeders 4 and 5 are twins, which creates tied optimal plans.")


def _heatwave_cap() -> tuple:
    """Afternoon heatwave, 14:00-17:00, where hardship-blind baselines break the cap.

    Design (all synthetic, chosen up front, not tuned against the baselines' random draws):
      * rules.max_consecutive = 1: a feeder may not be off two hours running.
      * prev_off = feeders 0 and 1 were cut in the hour before the window. They are the first
        two non-protected feeders in id order, so round-robin from index 0 cuts them again.
      * Feeders 0 and 1 are also dense, hot residential zones (very high hardship) with a
        ledger of 4 outage hours already served (daily limit 5).
      * quotas 2, 3, 3 with 6 non-protected feeders: a cap-respecting plan exists (24 of them).
      * weights.consecutive = 25, so the exact optimum respects the cap.
    """
    inst = generate(
        n_feeders=8, n_hours=3, quotas=[2, 3, 3], seed=HEATWAVE_SEED, name="heatwave_cap",
        protected={2: "hospital", 6: "water_pump"}, start_hour=14,
        weights={"hardship": 1.0, "fairness": 2.0, "consecutive": 25.0},
        rules={"max_consecutive": 1, "max_daily_hours": 5},
        ledger=[4, 4, 0, 1, 2, 1, 0, 0], prev_off=[1, 1, 0, 0, 0, 0, 0, 0],
        feeder_overrides={
            0: {"kind": "residential", "population": 55000, "heat_index": 1.0},
            1: {"kind": "residential", "population": 50000, "heat_index": 1.0},
            3: {"kind": "industrial", "population": 10000, "heat_index": 0.7},
            4: {"kind": "residential", "population": 60000, "heat_index": 0.85},
            5: {"kind": "commercial", "population": 20000, "heat_index": 0.85},
            7: {"kind": "residential", "population": 35000, "heat_index": 1.0},
        })
    inst.hardship = [[max(0.5, round(h * HEATWAVE_HOUR_FACTOR[t] * 2.0) / 2.0) for h in row]
                     for t, row in enumerate(inst.hardship)]
    return inst, (
        "Afternoon heatwave, 14:00-17:00, 8 synthetic feeders x 3 hours, quotas 2, 3, 3. "
        "Hardship is very unequal across feeders and peaks at 15:00. A feeder may not be off "
        "two hours running (max_consecutive = 1). Feeders 0 and 1 (dense hot residential zones) "
        "were cut in the hour before the window and already have 4 outage hours on the ledger "
        "(daily limit 5). Round-robin from feeder 0 and random-valid plans both ignore this; "
        "the exact plan respects the cap.")


def _block_4x2() -> tuple:
    inst = generate(n_feeders=4, n_hours=2, quotas=[2, 1], seed=21, name="block_4x2",
                    protected={3: "telecom"}, start_hour=18)
    return inst, (
        "Small block: 4 synthetic feeders x 2 hours, quotas 2 and 1, feeder 3 is a telecom "
        "tower and never cut. 8 variables, 9 valid plans: used for quantum counting and "
        "Grover Adaptive Search.")


def _scale(n: int):
    def build() -> tuple:
        protected = {2: "hospital"} if n == 6 else {2: "hospital", 6: "water_pump"}
        n_free = n - len(protected)
        q0 = max(1, round(n_free / 3))
        quotas = [q0, min(q0 + 1, n_free)]
        inst = generate(n_feeders=n, n_hours=2, quotas=quotas, seed=100 + n, name=f"scale_{n}x2",
                        protected=protected, start_hour=18)
        return inst, (
            f"Scaling instance: {n} synthetic feeders x 2 hours ({inst.n_vars} variables, "
            f"{n_free} non-protected), quotas {quotas[0]} and {quotas[1]}. Protected: "
            + ", ".join(f"feeder {k} ({v})" for k, v in protected.items()) + ".")
    return build


SCENARIOS: dict = {"base": _base, "heatwave_cap": _heatwave_cap, "block_4x2": _block_4x2}
for _n in SCALE_SIZES:
    SCENARIOS[f"scale_{_n}x2"] = _scale(_n)
