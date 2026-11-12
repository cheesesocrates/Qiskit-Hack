"""Weather source for the classical forecast (Area 2).

Source precedence (the label always says which one was really used):
  1. committed snapshot  src/forecast/data/open_meteo_karachi_snapshot.json
       -> weather_source "open-meteo-snapshot", provenance "real"
  2. live fetch from the Open-Meteo archive API (saves the snapshot, with URL and timestamp)
       -> "open-meteo-live", provenance "real"
  3. synthetic scenario file  src/forecast/data/weather_scenario.json
       -> "synthetic-scenario-file", provenance "synthetic"
`refresh=True` skips step 1 and forces step 2.

The request contains nothing but coordinates, dates, variable names and the time zone name.
Standard library only (plus numpy for the scenario generator).
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
SNAPSHOT_PATH = DATA_DIR / "open_meteo_karachi_snapshot.json"
SCENARIO_PATH = DATA_DIR / "weather_scenario.json"

LAT, LON = 24.86, 67.01
LOCATION = "Karachi (24.86 N, 67.01 E)"
TIMEZONE = "Asia/Karachi"
WINDOW_START, WINDOW_END = "2026-10-01", "2026-10-28"
N_DAYS = 28
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY_VARS = ("temperature_2m", "relative_humidity_2m")
TIMEOUT_S = 20

SCENARIO_SEED = 20261001   # fixed: the committed scenario file never depends on the run seed


class WeatherFetchError(Exception):
    """kind is 'http' (server rejected the request), 'network' (unreachable) or 'data' (bad payload)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


@dataclass
class Weather:
    source: str            # open-meteo-snapshot | open-meteo-live | synthetic-scenario-file
    provenance: str        # real | synthetic
    times: list            # ISO strings "YYYY-MM-DDTHH:00", local time, N_DAYS*24 entries
    temperature_c: list
    humidity_pct: list
    start_date: str
    end_date: str
    detail: str            # one human sentence used in the forecast notes


# ---------------------------------------------------------------------------- live fetch
def build_url(start_date: str, end_date: str) -> str:
    """Only coordinates, dates, variable names and the time zone name go over the wire."""
    query = urllib.parse.urlencode({
        "latitude": LAT, "longitude": LON, "start_date": start_date, "end_date": end_date,
        "hourly": ",".join(HOURLY_VARS), "timezone": TIMEZONE,
    })
    return f"{ARCHIVE_URL}?{query}"


def _fill_gaps(values: list) -> list:
    """Linear interpolation over null entries (edges copy the nearest value)."""
    arr = np.array([np.nan if v is None else float(v) for v in values], dtype=float)
    bad = np.isnan(arr)
    if bad.all():
        raise WeatherFetchError("data", "all values are null")
    if bad.any():
        idx = np.arange(arr.size)
        arr[bad] = np.interp(idx[bad], idx[~bad], arr[~bad])
    return [float(v) for v in arr]


def check_hourly(hourly: dict) -> dict:
    """Validate and normalise an Open-Meteo style hourly block."""
    times = list(hourly["time"])
    if len(times) != N_DAYS * 24:
        raise WeatherFetchError("data", f"expected {N_DAYS * 24} hourly rows, got {len(times)}")
    out = {"time": times,
           "temperature_2m": _fill_gaps(hourly["temperature_2m"]),
           "relative_humidity_2m": _fill_gaps(hourly["relative_humidity_2m"])}
    for key in ("temperature_2m", "relative_humidity_2m"):
        if len(out[key]) != len(times):
            raise WeatherFetchError("data", f"{key} length differs from time length")
    return out


def fetch_live(start_date: str, end_date: str, timeout: float = TIMEOUT_S) -> dict:
    """One GET to the archive API. Returns a snapshot document (not yet saved)."""
    url = build_url(start_date, end_date)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise WeatherFetchError("http", f"HTTP {exc.code} from the archive endpoint") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise WeatherFetchError("network", f"network unreachable or timed out ({exc})") from exc
    except ValueError as exc:
        raise WeatherFetchError("data", f"response was not JSON ({exc})") from exc
    try:
        hourly = check_hourly(raw["hourly"])
    except (KeyError, TypeError) as exc:
        raise WeatherFetchError("data", f"unexpected response shape ({exc!r})") from exc
    return {
        "kind": "open-meteo-archive-snapshot",
        "provenance": "real",
        "url": url,
        "fetched_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latitude": LAT, "longitude": LON, "timezone": TIMEZONE,
        "start_date": start_date, "end_date": end_date,
        "units": raw.get("hourly_units", {}),
        "hourly": hourly,
    }


def fetch_live_with_fallback(today: _dt.date | None = None) -> dict:
    """Fixed window first; if the server rejects it, the newest 28-day window it accepts."""
    try:
        return fetch_live(WINDOW_START, WINDOW_END)
    except WeatherFetchError as exc:
        if exc.kind != "http":
            raise
    today = today or _dt.date.today()
    end = today - _dt.timedelta(days=7)           # the archive lags real time by a few days
    start = end - _dt.timedelta(days=N_DAYS - 1)
    return fetch_live(start.isoformat(), end.isoformat())


def save_snapshot(doc: dict, path: Path | None = None) -> Path:
    path = Path(path or SNAPSHOT_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")
    return path


# ---------------------------------------------------------------------------- scenario file
def build_scenario_doc(seed: int = SCENARIO_SEED) -> dict:
    """Deterministic, plausible October weather for Karachi. SYNTHETIC: not a measurement."""
    rng = np.random.default_rng(seed)
    start = _dt.date.fromisoformat(WINDOW_START)
    drift, day_mean = 0.0, []
    for _ in range(N_DAYS):
        drift = 0.7 * drift + float(rng.normal(0.0, 1.1))
        day_mean.append(29.0 + drift)
    times, temps, hum = [], [], []
    for d in range(N_DAYS):
        day = start + _dt.timedelta(days=d)
        for h in range(24):
            diurnal = 4.6 * math.cos(2.0 * math.pi * (h - 15) / 24.0)
            t = day_mean[d] + diurnal + float(rng.normal(0.0, 0.3))
            times.append(f"{day.isoformat()}T{h:02d}:00")
            temps.append(round(t, 1))
            rh = 64.0 - 3.2 * (t - day_mean[d]) + float(rng.normal(0.0, 1.5))
            hum.append(float(round(min(95.0, max(25.0, rh)))))
    return {
        "kind": "synthetic-weather-scenario",
        "provenance": "synthetic",
        "synthetic": True,
        "note": ("SYNTHETIC weather scenario, generated by src/forecast/weather.py with a fixed seed. "
                 "It is NOT a measurement and must not be presented as real weather. It is used only "
                 "when neither the Open-Meteo snapshot nor a live fetch is available."),
        "seed": seed,
        "latitude": LAT, "longitude": LON, "timezone": TIMEZONE,
        "start_date": WINDOW_START, "end_date": WINDOW_END,
        "hourly": {"time": times, "temperature_2m": temps, "relative_humidity_2m": hum},
    }


def write_scenario_file(path: Path | None = None) -> Path:
    path = Path(path or SCENARIO_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(build_scenario_doc(), indent=1) + "\n", encoding="utf-8", newline="\n")
    return path


# ---------------------------------------------------------------------------- loading
def _weather_from_doc(doc: dict, source: str, provenance: str, detail: str) -> Weather:
    hourly = check_hourly(doc["hourly"])
    return Weather(source=source, provenance=provenance, times=hourly["time"],
                   temperature_c=hourly["temperature_2m"], humidity_pct=hourly["relative_humidity_2m"],
                   start_date=doc["start_date"], end_date=doc["end_date"], detail=detail)


def _from_snapshot(path: Path) -> Weather:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("provenance") != "real" or "open-meteo" not in str(doc.get("url", "")):
        raise ValueError("snapshot file is not marked as a real Open-Meteo snapshot")
    detail = (f"real hourly temperature from the Open-Meteo archive API (committed snapshot fetched "
              f"{doc.get('fetched_at', 'unknown time')}, window {doc['start_date']} to {doc['end_date']}, "
              f"{TIMEZONE})")
    return _weather_from_doc(doc, "open-meteo-snapshot", "real", detail)


def _from_scenario(path: Path) -> Weather:
    if not path.exists():
        write_scenario_file(path)
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("provenance") != "synthetic":
        raise ValueError("scenario file must be marked synthetic")
    detail = (f"SYNTHETIC weather from the committed scenario file (window {doc['start_date']} to "
              f"{doc['end_date']}); real Open-Meteo data was not available")
    return _weather_from_doc(doc, "synthetic-scenario-file", "synthetic", detail)


def load_weather(refresh: bool = False, snapshot_path: Path | None = None,
                 scenario_path: Path | None = None) -> Weather:
    snap = Path(snapshot_path or SNAPSHOT_PATH)
    scen = Path(scenario_path or SCENARIO_PATH)
    if not refresh and snap.exists():
        try:
            return _from_snapshot(snap)
        except Exception:      # unreadable snapshot: fall through to a live fetch
            pass
    try:
        doc = fetch_live_with_fallback()
        save_snapshot(doc, snap)
        detail = (f"real hourly temperature fetched live from the Open-Meteo archive API at "
                  f"{doc['fetched_at']} (window {doc['start_date']} to {doc['end_date']}, {TIMEZONE}); "
                  f"saved as a snapshot")
        return _weather_from_doc(doc, "open-meteo-live", "real", detail)
    except Exception:
        pass
    if refresh and snap.exists():     # refresh requested but the live fetch failed: keep the old real data
        try:
            return _from_snapshot(snap)
        except Exception:
            pass
    return _from_scenario(scen)


if __name__ == "__main__":
    import sys
    if "--make-scenario" in sys.argv:
        print("wrote", write_scenario_file())
    else:
        w = load_weather(refresh="--refresh" in sys.argv)
        print(w.source, w.provenance, w.start_date, w.end_date, len(w.times))
