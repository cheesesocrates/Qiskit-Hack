"""Seeded synthetic instance generator (Area 2).

Everything produced here is SYNTHETIC. Zone names are real Karachi neighbourhoods used only
as illustrative labels with approximate coordinates; feeders, populations, heat classes,
hardship values and the outage ledger are made up by a seeded random generator.
"""
from __future__ import annotations

import math

import numpy as np

from src.cost.model import PROTECTED_KINDS, Instance, quota_from_shortfall

# (zone label, approx lat, approx lon) - illustrative only
ZONES = [
    ("Lyari", 24.871, 66.997), ("Saddar", 24.856, 67.023), ("Civil Lines", 24.846, 67.033),
    ("Korangi", 24.830, 67.132), ("Gulshan-e-Iqbal", 24.918, 67.097), ("North Nazimabad", 24.942, 67.045),
    ("Dhabeji Pumping", 24.905, 67.140), ("Orangi Town", 24.951, 66.985), ("Malir", 24.893, 67.196),
    ("Landhi", 24.848, 67.200), ("SITE", 24.899, 66.990), ("Gulistan-e-Jauhar", 24.914, 67.130),
    ("Federal B Area", 24.928, 67.073), ("Baldia", 24.917, 66.955), ("Keamari", 24.820, 66.975),
    ("Shah Faisal", 24.877, 67.160), ("PECHS", 24.868, 67.060), ("Clifton", 24.813, 67.030),
    ("Surjani", 25.010, 67.060), ("New Karachi", 24.980, 67.066),
]
KIND_MULT = {"residential": 1.0, "commercial": 0.7, "industrial": 0.5,
             "hospital": 3.0, "water_pump": 2.5, "telecom": 2.0}
DEFAULT_WEIGHTS = {"hardship": 1.0, "fairness": 1.0, "consecutive": 2.0}
DEFAULT_RULES = {"max_consecutive": 2, "max_daily_hours": 5}


def heat_factor(hour: int) -> float:
    """Diurnal heat curve in [0, 1], peaking mid-afternoon (15:00)."""
    return 0.5 * (1.0 + math.cos(2.0 * math.pi * ((hour % 24) - 15) / 24.0))


def hardship_value(kind: str, population: int, heat_index: float, hour: int) -> float:
    """Per-feeder per-hour harm of an outage, quantised to 0.5 so equal-cost plans exist."""
    h = hour % 24
    base = KIND_MULT[kind] * (0.5 + population / 40000.0) * heat_index * (1.0 + heat_factor(h))
    if kind == "residential" and (h >= 18 or h < 6):
        base *= 1.25          # people are at home in the evening and night
    if kind == "commercial" and 9 <= h < 18:
        base *= 1.3           # shops and offices are open
    return max(0.5, round(base * 2.0) / 2.0)


def generate(n_feeders: int = 8, n_hours: int = 3, quotas: list | None = None, seed: int = 7,
             name: str | None = None, protected: dict | None = None, start_hour: int = 18,
             weights: dict | None = None, rules: dict | None = None, twins: tuple = (),
             feeder_mw: float = 5.0, ledger: list | None = None, prev_off: list | None = None,
             max_ledger: int = 3, feeder_overrides: dict | None = None) -> Instance:
    """Build a synthetic instance.

    protected: {feeder_id: kind} with kind in PROTECTED_KINDS. Default: none.
    twins: pairs (a, b); feeder b copies a's kind, population, heat class and ledger, which
           guarantees tied (equal-cost) plans for the lottery demonstration.
    feeder_overrides: {feeder_id: {"kind"|"population"|"heat_index": value}} applied after the
           random draw (so the random stream, and every default output, is unchanged); used by
           hand-designed scenarios such as heatwave_cap.
    """
    if n_feeders > len(ZONES):
        raise ValueError(f"at most {len(ZONES)} feeders supported by the zone table")
    rng = np.random.default_rng(seed)
    protected = dict(protected or {})
    assert all(k in PROTECTED_KINDS for k in protected.values())

    feeders = []
    for f in range(n_feeders):
        zone, lat, lon = ZONES[f]
        if f in protected:
            kind = protected[f]
            population = int(rng.integers(2, 6)) * 5000
        else:
            kind = str(rng.choice(["residential", "commercial", "industrial"], p=[0.6, 0.25, 0.15]))
            lo, hi = {"residential": (4, 13), "commercial": (1, 5), "industrial": (1, 3)}[kind]
            population = int(rng.integers(lo, hi)) * 5000
        heat_index = float(rng.choice([0.7, 0.85, 1.0]))
        feeders.append({"id": f, "name": f"F{f} {zone}", "zone": zone, "kind": kind,
                        "protected": f in protected, "population": population,
                        "heat_index": heat_index, "lat": lat, "lon": lon})

    led = [float(rng.integers(0, max_ledger + 1)) for _ in range(n_feeders)]
    if ledger is not None:
        led = [float(v) for v in ledger]
    for f in protected:
        led[f] = 0.0
    for a, b in twins:
        for key in ("kind", "population", "heat_index"):
            feeders[b][key] = feeders[a][key]
        led[b] = led[a]
    for f, over in (feeder_overrides or {}).items():
        for key, value in over.items():
            assert key in ("kind", "population", "heat_index"), key
            feeders[f][key] = value

    n_free = n_feeders - len(protected)
    if quotas is None:
        quotas = [int(rng.integers(1, max(2, n_free // 2 + 1))) for _ in range(n_hours)]
    assert len(quotas) == n_hours
    # a shortfall consistent with the quota: quota = ceil(shortfall / feeder_mw)
    shortfall = [round((m - float(rng.uniform(0.1, 0.9))) * feeder_mw, 1) if m > 0 else 0.0 for m in quotas]
    assert [quota_from_shortfall(s, feeder_mw) for s in shortfall] == list(quotas)

    hardship = [[hardship_value(fd["kind"], fd["population"], fd["heat_index"], start_hour + t)
                 for fd in feeders] for t in range(n_hours)]

    return Instance(
        name=name or f"synthetic_{n_feeders}x{n_hours}_seed{seed}",
        n_feeders=n_feeders, n_hours=n_hours, start_hour=start_hour % 24, feeder_mw=feeder_mw,
        shortfall_mw=shortfall, quotas=[int(m) for m in quotas], feeders=feeders, hardship=hardship,
        ledger_hours=led, prev_off=[int(v) for v in (prev_off or [0] * n_feeders)],
        weights=dict(weights or DEFAULT_WEIGHTS), rules=dict(rules or DEFAULT_RULES),
    )


BASE_SEED = 7


def base_instance(seed: int = BASE_SEED) -> Instance:
    """The 8 feeders x 3 hours base case: quotas 3, 2, 4; feeder 2 hospital, feeder 6 water pump.

    24 logical variables, 18 non-protected (the QAOA register). Feeders 4 and 5 are twins so
    that tied optimal plans exist (used by the fair-lottery demonstration).
    """
    return generate(n_feeders=8, n_hours=3, quotas=[3, 2, 4], seed=seed, name="base_8x3",
                    protected={2: "hospital", 6: "water_pump"}, start_hour=18, twins=((4, 5),))
