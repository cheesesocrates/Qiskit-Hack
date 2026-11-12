"""Build the payload of results/forecast.json (CLASSICAL ridge forecast of a SYNTHETIC shortfall)."""
from __future__ import annotations

import numpy as np

from src.cost.model import quota_from_shortfall
from src.forecast import demand as demand_mod
from src.forecast import weather as weather_mod
from src.forecast.ridge import FEATURE_NAMES, fit_ridge, make_features, regression_metrics

ALPHA = 1.0
TRAIN_DAYS = 21
TEST_DAYS = 7
N_BINS = 8


def residual_histogram(residuals: np.ndarray, n_bins: int = N_BINS) -> dict:
    """Equal-width histogram of residuals as a probability table the quantum risk module can use."""
    r = np.asarray(residuals, dtype=float)
    lo, hi = float(r.min()), float(r.max())
    if hi - lo < 1e-9:                      # degenerate: widen so the bins have a width
        lo, hi = lo - 0.5, hi + 0.5
    edges = np.linspace(lo, hi, n_bins + 1)
    idx = np.minimum(((r - lo) / (hi - lo) * n_bins).astype(int), n_bins - 1)
    counts = np.bincount(idx, minlength=n_bins)
    bins = [{"lo": float(edges[i]), "hi": float(edges[i + 1]),
             "mid": float((edges[i] + edges[i + 1]) / 2.0), "prob": float(counts[i] / r.size)}
            for i in range(n_bins)]
    return {"n": int(r.size), "std_mw": float(r.std()), "bins": bins}


def build_forecast(seed: int = 7, refresh: bool = False, weather: weather_mod.Weather | None = None) -> dict:
    wx = weather or weather_mod.load_weather(refresh=refresh)
    n = len(wx.times)
    n_days = n // 24
    n_train = (n_days - TEST_DAYS) * 24
    if n_days != TRAIN_DAYS + TEST_DAYS:
        raise ValueError(f"expected {TRAIN_DAYS + TEST_DAYS} days of weather, got {n_days}")

    sim = demand_mod.simulate(wx.times, wx.temperature_c, seed)
    y = sim["shortfall_mw"]
    X = make_features(wx.times, wx.temperature_c)

    model = fit_ridge(X[:n_train], y[:n_train], ALPHA)
    pred = np.round(np.maximum(0.0, model.predict(X)), 3)       # a negative shortfall is just 0
    test = slice(n_train, n)
    metrics = regression_metrics(y[test], pred[test])
    residuals = y[test] - pred[test]

    series = []
    for i in range(n):
        series.append({"time": wx.times[i], "hour": int(sim["hours"][i]),
                       "temperature_c": float(wx.temperature_c[i]),
                       "shortfall_actual_mw": float(y[i]), "shortfall_pred_mw": float(pred[i]),
                       "split": "train" if i < n_train else "test"})

    last_day = slice(n - 24, n)
    day_ahead, n_quota_clipped = [], 0
    for i in range(n - 24, n):
        raw_q = quota_from_shortfall(float(pred[i]), demand_mod.FEEDER_MW)
        q = min(demand_mod.MAX_QUOTA, max(0, raw_q))
        n_quota_clipped += int(q != raw_q)
        day_ahead.append({"hour": int(sim["hours"][i]), "shortfall_pred_mw": float(pred[i]), "quota": int(q)})

    last_date = wx.times[-1][:10]
    actual_q = [min(demand_mod.MAX_QUOTA, quota_from_shortfall(float(v), demand_mod.FEEDER_MW)) for v in y[last_day]]
    notes = (
        f"CLASSICAL ridge regression (closed form, alpha {ALPHA:g}, standardised features), trained on the first "
        f"{TRAIN_DAYS} days and tested on the last {TEST_DAYS}. "
        f"Weather: {wx.detail}. Weather provenance: {wx.provenance}. "
        f"The demand, supply and shortfall series are SYNTHETIC (a seeded generator for an illustrative "
        f"8-feeder cluster of 5 MW feeders; seed {seed}); they are not measurements of any real network. "
        f"Shortfall = max(0, demand - supply) is capped at {demand_mod.MAX_SHEDDABLE_MW:g} MW so a quota never "
        f"exceeds {demand_mod.MAX_QUOTA} feeders ({sim['n_capped']} of {n} hours were capped). "
        f"Predictions are clipped at 0 MW. Residuals are actual minus predicted on the {n - n_train} test hours, "
        f"split into {N_BINS} equal-width bins; the quantum risk module consumes them. "
        f"day_ahead covers {last_date} (last test day) and feeds the weather-observed temperature of that day "
        f"into the model as if it were a weather forecast, so it carries no weather-forecast error; "
        f"quota = ceil(pred / {demand_mod.FEEDER_MW:g} MW) clipped to 0..{demand_mod.MAX_QUOTA} "
        f"({n_quota_clipped} hours clipped). Actual-shortfall quotas that day: {actual_q}."
    )
    return {
        "label": "classical",
        "model": {"type": "ridge regression (closed form, numpy)", "alpha": ALPHA,
                  "features": list(FEATURE_NAMES), "n_train": int(n_train), "n_test": int(n - n_train)},
        "weather_source": wx.source,
        "weather_provenance": wx.provenance,
        "demand_provenance": "synthetic",
        "location": weather_mod.LOCATION,
        "metrics": metrics,
        "series": series,
        "residuals": residual_histogram(residuals),
        "day_ahead": day_ahead,
        "notes": notes,
    }
