"""SYNTHETIC demand, supply and shortfall for an illustrative 8-feeder cluster (Area 2).

Nothing here is measured. Demand is generated from the (real or scenario) temperature, an
hour-of-day profile, a weekday/weekend effect and seeded noise; supply is a made-up available
capacity with a per-day derating. shortfall = max(0, demand - supply), capped at
MAX_SHEDDABLE_MW because the cluster has 8 feeders of 5 MW, 2 of them protected, and the
brief's quota logic never cuts more than 4 of the 6 non-protected feeders.
"""
from __future__ import annotations

import datetime as _dt
import math

import numpy as np

FEEDER_MW = 5.0
N_FEEDERS = 8
MAX_QUOTA = 4
MAX_SHEDDABLE_MW = MAX_QUOTA * FEEDER_MW          # 20 MW: shortfall above this is clipped

COOLING_THRESHOLD_C = 24.0
COOLING_MW_PER_C = 1.25          # extra demand per degree above the threshold at full occupancy
BASE_NIGHT_MW = 19.0
MIDDAY_BUMP_MW = 2.0
EVENING_BUMP_MW = 12.5
WEEKEND_FACTOR = 0.93            # Saturday and Sunday demand is about 7 percent lower
SUPPLY_BASE_MW = 25.5
SUPPLY_EVENING_DERATE_MW = 3.0   # a bit less available capacity in the evening ramp
DEMAND_NOISE_MW = 0.9
SUPPLY_DAY_SD_MW = 1.0


def _bump(hour: float, centre: float, width: float) -> float:
    """Circular gaussian bump on the 24 h clock, peak value 1."""
    d = abs(hour - centre)
    d = min(d, 24.0 - d)
    return math.exp(-0.5 * (d / width) ** 2)


def hour_profile_mw(hour: int) -> float:
    """Temperature-independent demand of the cluster by hour of day (MW)."""
    return (BASE_NIGHT_MW + MIDDAY_BUMP_MW * _bump(hour, 13.0, 3.5)
            + EVENING_BUMP_MW * _bump(hour, 20.5, 2.5))


def occupancy(hour: int) -> float:
    """Share of the cooling load that is switched on (homes are occupied in the evening)."""
    return 0.6 + 0.4 * _bump(hour, 20.5, 4.5)


def is_weekend(time_iso: str) -> bool:
    return _dt.date.fromisoformat(time_iso[:10]).weekday() >= 5


def simulate(times: list, temperature_c: list, seed: int) -> dict:
    """Return arrays demand_mw, supply_mw, shortfall_mw (capped, rounded to 0.01) and cap_hits."""
    n = len(times)
    rng = np.random.default_rng(seed)
    hours = np.array([int(t[11:13]) for t in times])
    weekend = np.array([is_weekend(t) for t in times])
    temp = np.asarray(temperature_c, dtype=float)

    base = np.array([hour_profile_mw(int(h)) for h in hours])
    occ = np.array([occupancy(int(h)) for h in hours])
    cooling = COOLING_MW_PER_C * np.maximum(0.0, temp - COOLING_THRESHOLD_C) * occ
    day_factor = np.where(weekend, WEEKEND_FACTOR, 1.0)

    noise = np.zeros(n)                       # smooth-ish (AR(1)) demand noise
    for i in range(n):
        prev = noise[i - 1] if i else 0.0
        noise[i] = 0.5 * prev + rng.normal(0.0, DEMAND_NOISE_MW)
    demand = (base + cooling) * day_factor + noise

    n_days = n // 24
    day_derate = rng.normal(0.0, SUPPLY_DAY_SD_MW, size=n_days)
    day_idx = np.arange(n) // 24
    evening = np.array([_bump(int(h), 20.5, 2.5) for h in hours])
    supply = SUPPLY_BASE_MW - SUPPLY_EVENING_DERATE_MW * evening + day_derate[day_idx] + rng.normal(0.0, 0.3, n)

    raw = np.maximum(0.0, demand - supply)
    short = np.round(np.minimum(raw, MAX_SHEDDABLE_MW), 2)
    return {"demand_mw": demand, "supply_mw": supply, "shortfall_mw": short,
            "n_capped": int((raw > MAX_SHEDDABLE_MW).sum()), "hours": hours, "weekend": weekend}
