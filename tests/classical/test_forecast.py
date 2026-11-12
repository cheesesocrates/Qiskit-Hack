"""Tests for the classical ridge forecast (Area 2): ridge maths, weather provenance, reproducibility.

No test here touches the network: Open-Meteo is replaced by a stub that fails or answers from a
tmp file, so results never depend on connectivity.
"""
from __future__ import annotations

import datetime as dt
import json
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
from jsonschema import Draft202012Validator

from src.cost.model import quota_from_shortfall
from src.export.writer import RESULTS, schema_for, strip_volatile, with_meta
from src.forecast import weather as W
from src.forecast.pipeline import build_forecast
from src.forecast.ridge import FEATURE_NAMES, fit_ridge, make_features, regression_metrics


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise W.WeatherFetchError("network", "network disabled in tests")
    monkeypatch.setattr(W, "fetch_live", refuse)


def _fake_live_doc(start="2026-10-01", end="2026-10-28") -> dict:
    """A stand-in for an Open-Meteo answer, built from the scenario generator (test data only)."""
    doc = W.build_scenario_doc()
    doc.update({"kind": "open-meteo-archive-snapshot", "provenance": "real", "url": W.build_url(start, end),
                "fetched_at": "2026-11-12T00:00:00Z", "start_date": start, "end_date": end})
    return doc


# ---------------------------------------------------------------------------- ridge maths
def test_ridge_closed_form_matches_lstsq_at_alpha_zero():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(200, 6)) * [1, 5, 0.2, 3, 1, 2] + [0, 10, 1, -4, 0, 7]
    y = X @ rng.normal(size=6) + 3.0 + rng.normal(scale=0.1, size=200)
    model = fit_ridge(X, y, alpha=0.0)
    design = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(design, y, rcond=None)
    assert np.allclose(model.predict(X), design @ beta, atol=1e-8)
    # coefficients in raw feature units: coef / scale; intercept: mean(y) - sum(coef * mean / scale)
    raw = model.coef / model.scale
    assert np.allclose(raw, beta[1:], atol=1e-8)
    assert np.isclose(model.intercept - float((raw * model.mean).sum()), beta[0], atol=1e-8)


def test_ridge_penalty_shrinks_coefficients():
    rng = np.random.default_rng(4)
    X = rng.normal(size=(100, 4))
    y = X @ np.array([2.0, -1.0, 0.5, 0.0]) + rng.normal(scale=0.2, size=100)
    small, large = fit_ridge(X, y, 0.0), fit_ridge(X, y, 500.0)
    assert np.linalg.norm(large.coef) < np.linalg.norm(small.coef)
    assert np.isclose(large.intercept, y.mean())


def test_feature_matrix_shape_and_names():
    times = ["2026-10-03T14:00", "2026-10-04T02:00"]       # a Saturday and a Sunday
    X = make_features(times, [33.0, 25.0])
    assert X.shape == (2, len(FEATURE_NAMES) - 1)             # intercept is handled by the model
    assert FEATURE_NAMES[-1] == "intercept"
    assert X[0, 0] == 33.0 and X[0, 1] == 33.0 ** 2 and X[0, -1] == 1.0 and X[1, -1] == 1.0
    assert make_features(["2026-10-05T14:00"], [30.0])[0, -1] == 0.0      # Monday


# ---------------------------------------------------------------------------- weather
def test_request_contains_only_coordinates_dates_and_variable_names():
    url = W.build_url("2026-10-01", "2026-10-28")
    q = parse_qs(urlparse(url).query)
    assert set(q) == {"latitude", "longitude", "start_date", "end_date", "hourly", "timezone"}
    assert q["latitude"] == ["24.86"] and q["longitude"] == ["67.01"]
    assert q["hourly"] == ["temperature_2m,relative_humidity_2m"]


def test_committed_scenario_file_is_deterministic_and_marked_synthetic():
    committed = json.loads(W.SCENARIO_PATH.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(W.build_scenario_doc()))
    assert committed["provenance"] == "synthetic" and committed["synthetic"] is True
    assert "SYNTHETIC" in committed["note"] and len(committed["hourly"]["time"]) == 672


def test_live_fetch_success_saves_snapshot_with_url_and_timestamp(tmp_path, monkeypatch):
    monkeypatch.setattr(W, "fetch_live", lambda *a, **k: _fake_live_doc())
    snap = tmp_path / "snap.json"
    wx = W.load_weather(snapshot_path=snap, scenario_path=tmp_path / "scn.json")
    assert (wx.source, wx.provenance) == ("open-meteo-live", "real")
    saved = json.loads(snap.read_text(encoding="utf-8"))
    assert saved["url"].startswith("https://archive-api.open-meteo.com/") and saved["fetched_at"]
    again = W.load_weather(snapshot_path=snap, scenario_path=tmp_path / "scn.json")   # now a snapshot
    assert (again.source, again.provenance) == ("open-meteo-snapshot", "real")
    assert again.temperature_c == wx.temperature_c


def test_no_snapshot_and_no_network_uses_synthetic_scenario(tmp_path):
    wx = W.load_weather(snapshot_path=tmp_path / "missing.json", scenario_path=tmp_path / "scn.json")
    assert (wx.source, wx.provenance) == ("synthetic-scenario-file", "synthetic")
    assert "SYNTHETIC" in wx.detail
    assert not (tmp_path / "missing.json").exists()           # a synthetic series never becomes a snapshot


def test_refresh_with_failed_fetch_keeps_the_real_snapshot(tmp_path):
    snap = tmp_path / "snap.json"
    W.save_snapshot(_fake_live_doc(), snap)
    wx = W.load_weather(refresh=True, snapshot_path=snap, scenario_path=tmp_path / "scn.json")
    assert (wx.source, wx.provenance) == ("open-meteo-snapshot", "real")


def test_rejected_window_falls_back_to_newest_28_day_window(monkeypatch):
    asked = []

    def fake(start, end, timeout=20):
        asked.append((start, end))
        if (start, end) == (W.WINDOW_START, W.WINDOW_END):
            raise W.WeatherFetchError("http", "HTTP 400")
        return _fake_live_doc(start, end)
    monkeypatch.setattr(W, "fetch_live", fake)
    W.fetch_live_with_fallback(today=dt.date(2026, 12, 1))
    assert asked == [(W.WINDOW_START, W.WINDOW_END), ("2026-10-28", "2026-11-24")]   # today - 7 days, 28 days long


def test_network_error_is_not_retried_with_another_window(monkeypatch):
    calls = []

    def fake(start, end, timeout=20):
        calls.append(1)
        raise W.WeatherFetchError("network", "unreachable")
    monkeypatch.setattr(W, "fetch_live", fake)
    with pytest.raises(W.WeatherFetchError):
        W.fetch_live_with_fallback()
    assert len(calls) == 1


# ---------------------------------------------------------------------------- C10
@pytest.mark.check(id="C10", name="Ridge forecast is reproducible and beats a mean predictor on the test set")
def test_ridge_forecast_reproducible_and_beats_mean_predictor(check_detail):
    a, b = build_forecast(seed=7), build_forecast(seed=7)
    assert strip_volatile(with_meta(a, 7, "test")) == strip_volatile(with_meta(b, 7, "test"))
    assert a["series"] != build_forecast(seed=8)["series"]              # the seed really drives the series

    ser = a["series"]
    test_rows = [r for r in ser if r["split"] == "test"]
    train_rows = [r for r in ser if r["split"] == "train"]
    assert (len(train_rows), len(test_rows)) == (504, 168)
    assert all(r["split"] == "train" for r in ser[:504]) and all(r["split"] == "test" for r in ser[504:])
    y = np.array([r["shortfall_actual_mw"] for r in test_rows])
    p = np.array([r["shortfall_pred_mw"] for r in test_rows])
    m = regression_metrics(y, p)
    for key in ("mae_mw", "rmse_mw", "r2"):
        assert a["metrics"][key] == pytest.approx(m[key], rel=1e-9)     # file metrics are reproducible from the series
    assert a["metrics"]["r2"] > 0.0
    mean_mae = float(np.abs(y - np.mean([r["shortfall_actual_mw"] for r in train_rows])).mean())
    assert a["metrics"]["mae_mw"] < mean_mae

    res = a["residuals"]
    assert len(res["bins"]) == 8 and res["n"] == 168
    assert sum(bn["prob"] for bn in res["bins"]) == pytest.approx(1.0, abs=1e-9)
    assert all(bn["hi"] > bn["lo"] and bn["lo"] <= bn["mid"] <= bn["hi"] for bn in res["bins"])
    assert res["std_mw"] == pytest.approx(float(np.std(y - p)), rel=1e-9)

    da = a["day_ahead"]
    assert [r["hour"] for r in da] == list(range(24))
    for row, ser_row in zip(da, ser[-24:]):
        assert row["shortfall_pred_mw"] == ser_row["shortfall_pred_mw"]
        assert row["quota"] == min(4, max(0, quota_from_shortfall(row["shortfall_pred_mw"], 5.0)))
    assert all(0 <= r["shortfall_actual_mw"] <= 20.0 for r in ser) and all(r["shortfall_pred_mw"] >= 0 for r in ser)
    errs = list(Draft202012Validator(schema_for("forecast.json")).iter_errors(with_meta(a, 7, "test")))
    assert not errs, errs[:2]
    check_detail(f"R2 {m['r2']:.3f}, MAE {m['mae_mw']:.2f} MW vs {mean_mae:.2f} MW for a mean predictor on "
                 f"{len(test_rows)} held-out hours; two seed-7 runs identical")


# ---------------------------------------------------------------------------- C11
@pytest.mark.check(id="C11", name="Forecast file states weather provenance and synthetic demand")
def test_forecast_states_weather_provenance_and_synthetic_demand(check_detail, tmp_path):
    expected = {"open-meteo-snapshot": "real", "open-meteo-live": "real", "synthetic-scenario-file": "synthetic"}
    live_snap = tmp_path / "live.json"
    W.save_snapshot(_fake_live_doc(), live_snap)
    cases = {"committed": W.load_weather(),
             "scenario": W.load_weather(snapshot_path=tmp_path / "none.json", scenario_path=tmp_path / "s.json"),
             "tmp-snapshot": W.load_weather(snapshot_path=live_snap)}
    seen = []
    for name, wx in cases.items():
        fc = build_forecast(seed=7, weather=wx)
        assert fc["label"] == "classical"
        assert fc["demand_provenance"] == "synthetic"
        assert fc["weather_source"] in expected and fc["weather_provenance"] == expected[fc["weather_source"]]
        notes = fc["notes"].lower()
        assert "synthetic" in notes and "demand" in notes and "shortfall" in notes
        assert fc["weather_source"] == wx.source and wx.detail in fc["notes"]
        if fc["weather_provenance"] == "synthetic":
            assert "synthetic weather" in notes and "not available" in notes
        else:
            assert "real hourly temperature" in notes and "synthetic weather" not in notes
        seen.append(f"{fc['weather_source']}={fc['weather_provenance']}")
    path = RESULTS / "forecast.json"
    if path.exists():                                                      # the file the dashboard reads
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert doc["demand_provenance"] == "synthetic" and doc["label"] == "classical"
        assert doc["weather_provenance"] == expected[doc["weather_source"]]
        assert doc["data_provenance"] == "synthetic" and "SYNTHETIC" in doc["notes"]
        seen.append(f"results/forecast.json: {doc['weather_source']}={doc['weather_provenance']}")
    check_detail("; ".join(seen) + "; demand_provenance synthetic in every case")
