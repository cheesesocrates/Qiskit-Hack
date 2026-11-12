"""Receding-horizon replay engine (Area 2).

One day on the 8 base feeders, one frame per hour. At each step a T-hour window (default 3 h)
is built, solved by a pluggable solver, and ONLY its first hour is committed; the ledger and
the previous-hour state are updated and the window moves on by one hour.

Solvers
  "exact"    brute force over every valid plan (src.classical.exact), first optimum in sorted order
  "quantum"  the external command of docs/CONTRACT.md section 6 (files in, files out, never an
             import). Anything wrong with it (missing, non-zero exit, timeout, unreadable output,
             invalid plan) falls back to "exact" for that frame, and `solver_used` says so.
The exact optimum of every window is always computed too, so each frame reports whether the
solver matched it. Costs and validity are always re-evaluated here; a solver's own numbers are
never trusted.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from src.audit.rules import audit
from src.classical.exact import brute_force
from src.cost.model import Instance, quota_from_shortfall
from src.data.generator import base_instance, hardship_value
from src.export.writer import RESULTS, ROOT

WINDOW_HOURS = 3
START_HOUR = 12
N_FRAMES = 12
MAX_QUOTA = 4
TOL = 1e-9
DEFAULT_TIMEOUT_S = 300.0
QUANTUM_SCRIPT = "scripts/run_quantum.py"


class ForecastMissing(FileNotFoundError):
    """results/forecast.json is not there (run scripts/run_forecast.py first)."""


class SolverFailure(Exception):
    """The external solver could not deliver a valid plan; the message is a short reason."""


def default_quantum_command() -> list:
    return [sys.executable, QUANTUM_SCRIPT, "solve-window"]


def quantum_script_exists() -> bool:
    return (ROOT / QUANTUM_SCRIPT).exists()


# ---------------------------------------------------------------------------- inputs
def load_forecast(path: Path | None = None) -> dict:
    path = Path(path or (RESULTS / "forecast.json"))
    if not path.exists():
        raise ForecastMissing(f"{path} not found - run `python scripts/run_forecast.py` first, "
                              f"then run the replay again.")
    return json.loads(path.read_text(encoding="utf-8"))


def day_from_forecast(forecast: dict) -> dict:
    """Actual and predicted shortfall (MW) by hour for the last test day of forecast.json."""
    rows = forecast["series"][-24:]
    if len(rows) != 24 or [r["hour"] for r in rows] != list(range(24)):
        raise ValueError("the last 24 forecast series rows must be hours 0..23 of one day")
    pred = {int(r["hour"]): float(r["shortfall_pred_mw"]) for r in forecast["day_ahead"]}
    if sorted(pred) != list(range(24)):
        raise ValueError("forecast day_ahead must hold hours 0..23")
    return {"date": rows[0]["time"][:10],
            "actual": [float(r["shortfall_actual_mw"]) for r in rows],
            "pred": [pred[h] for h in range(24)]}


# ---------------------------------------------------------------------------- window
def clip_quota(shortfall_mw: float, feeder_mw: float, n_free: int) -> int:
    return int(min(MAX_QUOTA, n_free, max(0, quota_from_shortfall(shortfall_mw, feeder_mw))))


def build_window(base: Instance, day: dict, hour: int, ledger: list, prev_off: list,
                 window: int = WINDOW_HOURS) -> Instance:
    """Window instance for hours hour .. hour+window-1.

    Hour 0 of the window uses the ACTUAL shortfall (known when the hour starts); later hours use
    the FORECAST. Hours past midnight wrap onto the same forecast day (there is no next-day forecast).
    """
    cap_mw = min(MAX_QUOTA, len(base.free)) * base.feeder_mw
    shortfall, quotas, hardship = [], [], []
    for k in range(window):
        h = (hour + k) % 24
        raw = day["actual"][h] if k == 0 else day["pred"][h]
        s = round(min(max(0.0, float(raw)), cap_mw), 3)
        shortfall.append(s)
        quotas.append(clip_quota(s, base.feeder_mw, len(base.free)))
        hardship.append([hardship_value(fd["kind"], fd["population"], fd["heat_index"], hour + k)
                         for fd in base.feeders])
    return Instance(
        name=f"replay_window_{hour:02d}h", n_feeders=base.n_feeders, n_hours=window,
        start_hour=hour % 24, feeder_mw=base.feeder_mw, shortfall_mw=shortfall, quotas=quotas,
        feeders=[dict(fd) for fd in base.feeders], hardship=hardship,
        ledger_hours=[float(v) for v in ledger], prev_off=[int(v) for v in prev_off],
        weights=dict(base.weights), rules=dict(base.rules))


def shift_bits(bits: str, n_feeders: int) -> str:
    """Previous window's plan moved one hour earlier; the new last hour is all zeros."""
    return bits[n_feeders:] + "0" * n_feeders


# ---------------------------------------------------------------------------- solvers
def solve_exact(inst: Instance) -> dict:
    t0 = time.perf_counter()
    ref = brute_force(inst)
    bits = sorted(ref["optimal_bits"])[0]
    return {"bits": bits, "cost": float(ref["cost_min"]), "n_optimal": ref["n_optimal"],
            "runtime_s": time.perf_counter() - t0}


def solve_quantum(inst: Instance, warm_start, seed: int, command: list | None = None,
                  timeout: float = DEFAULT_TIMEOUT_S, tmp_dir: Path | None = None) -> dict:
    """Call the external window solver. Returns {bits, cost, method, warm_start, reported}.

    Raises SolverFailure(reason) on anything other than a valid plan.
    """
    command = list(command) if command else default_quantum_command()
    if len(command) > 1 and str(command[1]).endswith(".py"):
        script = Path(command[1])
        if not (script if script.is_absolute() else ROOT / script).exists():
            raise SolverFailure(f"{script.name} not found")
    tmp = Path(tmp_dir or (RESULTS / "tmp"))
    tmp.mkdir(parents=True, exist_ok=True)
    in_path, out_path = tmp / "window_in.json", tmp / "window_out.json"
    in_path.write_text(json.dumps({"instance": inst.to_dict(), "warm_start": warm_start, "seed": int(seed)}),
                       encoding="utf-8")
    if out_path.exists():
        out_path.unlink()                      # a stale answer must never be read as this call's
    argv = command + ["--in", str(in_path), "--out", str(out_path)]
    try:
        proc = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True,
                              errors="replace", timeout=timeout)
    except FileNotFoundError:
        raise SolverFailure("command not found")
    except subprocess.TimeoutExpired:
        raise SolverFailure(f"timeout after {timeout:g}s")
    except OSError as exc:
        raise SolverFailure(f"cannot run command ({type(exc).__name__})")
    if proc.returncode != 0:
        raise SolverFailure(f"exit code {proc.returncode}")
    try:
        out = json.loads(out_path.read_text(encoding="utf-8"))
        bits = out["bits"]
    except FileNotFoundError:
        raise SolverFailure("no output file written")
    except (ValueError, KeyError, TypeError):
        raise SolverFailure("unreadable output file")
    if not isinstance(bits, str) or len(bits) != inst.n_vars or set(bits) - {"0", "1"}:
        raise SolverFailure("malformed plan in output")
    if not inst.is_valid(bits):
        raise SolverFailure("invalid plan returned (quota or protected rule broken)")
    return {"bits": bits, "cost": inst.evaluate(bits), "method": str(out.get("method", "unknown")),
            "warm_start": out.get("warm_start"),
            "reported": {k: out.get(k) for k in ("cost", "feasible", "p_optimal", "runtime_s")}}


# ---------------------------------------------------------------------------- replay
def _off_ids(plan) -> list:
    return [f for f, v in enumerate(plan) if v]


def run_replay(forecast: dict, solver: str = "exact", seed: int = 7, timeout: float = DEFAULT_TIMEOUT_S,
               quantum_command: list | None = None, tmp_dir: Path | None = None,
               start_hour: int = START_HOUR, n_frames: int = N_FRAMES, window: int = WINDOW_HOURS,
               on_frame: Callable[[dict], None] | None = None) -> dict:
    """Run the replay and return the payload of results/replay.json (without meta fields)."""
    if solver not in ("exact", "quantum"):
        raise ValueError("solver must be 'exact' or 'quantum'")
    base = base_instance()
    day = day_from_forecast(forecast)
    n = base.n_feeders
    ledger = [0.0] * n
    prev_plan = [0] * n
    prev_window_matrix = None          # previous window's plan, T x N
    prev_window_bits = None
    last_ws = None                     # warm_start object returned by the previous solver call
    frames = []
    total_hardship = 0.0

    for step in range(n_frames):
        hour = start_hour + step
        inst = build_window(base, day, hour, ledger, prev_plan, window)

        exact = solve_exact(inst)
        exact_cost = exact["cost"]

        chosen_bits, solver_used, warm_started, ws_next = exact["bits"], "exact", False, None
        runtime = exact["runtime_s"]
        if solver == "quantum":
            ws_in = None
            if prev_window_bits is not None:
                ws_in = dict(last_ws) if isinstance(last_ws, dict) else ({"opaque": last_ws} if last_ws is not None else {})
                ws_in["prev_window_bits_shifted"] = shift_bits(prev_window_bits, n)
            q0 = time.perf_counter()
            try:
                res = solve_quantum(inst, ws_in, seed, quantum_command, timeout, tmp_dir)
                chosen_bits, solver_used = res["bits"], f"quantum ({res['method']})"
                warm_started, ws_next = ws_in is not None, res["warm_start"]
                runtime = time.perf_counter() - q0
            except SolverFailure as exc:
                solver_used = f"exact (fallback: {exc})"
                runtime = (time.perf_counter() - q0) + exact["runtime_s"]
        cost = inst.evaluate(chosen_bits)
        assert inst.is_valid(chosen_bits), "a committed window plan must be valid"

        matrix = inst.to_matrix(chosen_bits)
        plan = [int(v) for v in matrix[0]]
        changed = [f for f in range(n) if plan[f] != prev_plan[f]]
        revised = [] if prev_window_matrix is None else \
            [f for f in range(n) if plan[f] != int(prev_window_matrix[1][f])]
        ledger = [ledger[f] + plan[f] for f in range(n)]
        total_hardship += float(sum(inst.hardship[0][f] for f in _off_ids(plan)))

        frame = {
            "step": step, "hour": hour % 24,
            "shortfall_mw": float(day["actual"][hour % 24]), "forecast_mw": float(day["pred"][hour % 24]),
            "quota": int(inst.quotas[0]), "plan": plan,
            "changed_from_previous": changed, "revised_vs_prior_plan": revised,
            "window_quotas": [int(q) for q in inst.quotas], "window_bits": chosen_bits,
            "cost": float(cost), "exact_cost": float(exact_cost),
            "matches_exact": bool(abs(cost - exact_cost) <= TOL),
            "solver_used": solver_used, "warm_started": bool(warm_started),
            "ledger_after": list(ledger), "runtime_s": float(runtime),
            "audit_passed": bool(audit(inst, chosen_bits)["passed"]),
        }
        frames.append(frame)
        if on_frame:
            on_frame(frame)
        prev_plan, prev_window_matrix, prev_window_bits, last_ws = plan, matrix, chosen_bits, ws_next

    free = base.free
    spread = max(ledger[f] for f in free) - min(ledger[f] for f in free)
    summary = {"n_frames": len(frames), "n_changed": sum(len(f["changed_from_previous"]) for f in frames),
               "matches_exact_count": sum(1 for f in frames if f["matches_exact"]),
               "total_hardship": float(total_hardship), "fairness_spread_hours": float(spread),
               "final_ledger": [float(v) for v in ledger]}
    return {
        "scenario": f"replay_{day['date']}_{start_hour:02d}h-{(start_hour + n_frames - 1) % 24:02d}h",
        "horizon_hours": window, "n_feeders": n,
        "feeders": [dict(fd) for fd in base.feeders],
        "solver_requested": solver, "frames": frames, "summary": summary,
        "notes": _notes(solver, frames, day, start_hour, window, forecast),
    }


def _notes(solver: str, frames: list, day: dict, start_hour: int, window: int, forecast: dict) -> str:
    n_quantum = sum(1 for f in frames if f["solver_used"].startswith("quantum"))
    n_fallback = sum(1 for f in frames if "fallback" in f["solver_used"])
    n_exact_direct = len(frames) - n_quantum - n_fallback
    reasons = sorted({f["solver_used"].split("fallback: ")[1].rstrip(")") for f in frames if "fallback" in f["solver_used"]})
    why = f" (reasons: {'; '.join(reasons)})" if reasons else ""
    w = forecast.get("weather_source", "unknown")
    return (
        f"Synthetic feeders (8 illustrative Karachi zones; feeder 2 hospital and feeder 6 water pump protected). "
        f"Receding horizon: {len(frames)} hourly frames from {start_hour:02d}:00 on {day['date']} (the last "
        f"test day of the classical ridge forecast; weather source {w}, demand and shortfall series synthetic). "
        f"Each step solves a {window}-hour window and commits only its first hour. The first window hour uses "
        f"the actual shortfall (known when the hour starts); the later hours use the forecast. Hours past 23:00 "
        f"wrap onto the same forecast day because no next-day forecast exists. Quotas are ceil(MW / 5) clipped "
        f"to 0..4. The ledger starts at zero at {start_hour:02d}:00 (earlier cuts that day are not modelled). "
        f"Solver requested: {solver}. Frames solved by the quantum command: {n_quantum}; by exact as a "
        f"fallback after a quantum failure: {n_fallback}{why}; by exact directly: {n_exact_direct}. Every plan was re-evaluated "
        f"here and checked for validity; exact_cost is the brute-force optimum of the same window. "
        f"warm_started is true only when the solver that produced the plan was given the previous window's "
        f"plan shifted by one hour (the exact solver never is). audit_passed is the audit of the window plan, "
        f"including the daily-hours rule applied to the replay ledger."
    )
