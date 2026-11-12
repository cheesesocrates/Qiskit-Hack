"""Tests for the receding-horizon replay (Area 2).

The quantum path is tested with tiny fake solver scripts written to a tmp dir; scripts/run_quantum.py
(owned by another team) is never needed. Nothing here touches the network.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import textwrap

import pytest
from jsonschema import Draft202012Validator

from src.cost.model import quota_from_shortfall
from src.data.generator import base_instance
from src.export.writer import ROOT, schema_for, strip_volatile, with_meta
from src.forecast import weather as W
from src.forecast.pipeline import build_forecast
from src.replan import engine

PROTECTED = [2, 6]

FAKE_HEAD = """
import json, os, sys, time
sys.path.insert(0, {root!r})
args = sys.argv[1:]
assert args[0] == "solve-window", args
src = args[args.index("--in") + 1]
dst = args[args.index("--out") + 1]
req = json.load(open(src))
inst = req["instance"]
N, T = inst["n_feeders"], inst["n_hours"]
free = [f["id"] for f in inst["feeders"] if not f["protected"]]
prot = [f["id"] for f in inst["feeders"] if f["protected"]]
log = dst + ".calls.jsonl"
with open(log, "a") as fh:
    fh.write(json.dumps({{"warm_start": req["warm_start"], "seed": req["seed"]}}) + "\\n")
n_calls = sum(1 for _ in open(log))
def pack(rows):
    return "".join("".join("1" if f in ids else "0" for f in range(N)) for ids in rows)
def write(bits, method="fake"):
    json.dump({{"bits": bits, "cost": 0.0, "feasible": True, "method": method, "p_optimal": None,
               "runtime_s": 0.0, "warm_start": {{"calls": n_calls}}}}, open(dst, "w"))
"""

FAKE_BODIES = {
    # first non-protected feeders: valid but usually not optimal
    "greedy": "write(pack([free[:q] for q in inst['quotas']]), 'fake-greedy')",
    # the true optimum, computed with the repo's own brute force
    "optimal": textwrap.dedent("""
        from src.classical.exact import brute_force
        from src.cost.model import Instance
        ref = brute_force(Instance.from_dict(inst))
        write(sorted(ref["optimal_bits"])[0], "fake-optimal")
    """),
    "wrong_quota": "write('1' * (N * T))",
    "protected_on": "write(pack([(prot[:1] + free)[:q] for q in inst['quotas']]))",
    "crash": "sys.exit(3)",
    "garbage": "open(dst, 'w').write('this is not json')",
    "silent": "pass",
    "sleeper": "time.sleep(20)",
}


def make_fake(tmp_path, kind: str) -> list:
    script = tmp_path / f"fake_{kind}.py"
    script.write_text(FAKE_HEAD.format(root=str(ROOT)) + FAKE_BODIES[kind] + "\n", encoding="utf-8")
    return [sys.executable, str(script), "solve-window"]


def calls_log(tmp_dir) -> list:
    path = tmp_dir / "window_out.json.calls.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise W.WeatherFetchError("network", "network disabled in tests")
    monkeypatch.setattr(W, "fetch_live", refuse)


@pytest.fixture(scope="module")
def forecast():
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(W, "fetch_live", lambda *a, **k: (_ for _ in ()).throw(W.WeatherFetchError("network", "off")))
        return build_forecast(seed=7)


@pytest.fixture(scope="module")
def exact_run(forecast):
    return engine.run_replay(forecast, solver="exact", seed=7)


# ---------------------------------------------------------------------------- helpers
def test_shift_bits_moves_the_plan_one_hour_earlier():
    assert engine.shift_bits("111000" "000111" "101010", 6) == "000111" "101010" "000000"


def test_window_uses_actual_first_then_forecast_and_wraps(forecast):
    base, day = base_instance(), engine.day_from_forecast(forecast)
    inst = engine.build_window(base, day, 23, [0.0] * 8, [0] * 8)
    assert inst.start_hour == 23 and inst.n_hours == 3
    assert inst.shortfall_mw[0] == pytest.approx(day["actual"][23], abs=1e-3)
    assert inst.shortfall_mw[1] == pytest.approx(day["pred"][0], abs=1e-3)       # wraps onto the forecast day
    assert inst.shortfall_mw[2] == pytest.approx(day["pred"][1], abs=1e-3)
    assert all(0 <= q <= 4 for q in inst.quotas)
    assert inst.quotas == [min(4, quota_from_shortfall(s, 5.0)) for s in inst.shortfall_mw]


def test_missing_forecast_gives_a_clear_message(tmp_path, monkeypatch, capsys):
    with pytest.raises(engine.ForecastMissing, match=r"scripts/run_forecast\.py"):
        engine.load_forecast(tmp_path / "forecast.json")
    spec = importlib.util.spec_from_file_location("run_replay_script", ROOT / "scripts" / "run_replay.py")
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    monkeypatch.setattr(engine, "RESULTS", tmp_path)
    monkeypatch.setattr(sys, "argv", ["run_replay.py", "--solver", "exact"])
    assert script.main() == 1
    assert "run_forecast.py" in capsys.readouterr().err


def test_zero_quota_hours_commit_an_empty_plan(forecast):
    fc = copy.deepcopy(forecast)
    for row in fc["series"][-24:]:
        row["shortfall_actual_mw"] = 0.0
    for row in fc["day_ahead"]:
        row["shortfall_pred_mw"] = 0.0
    out = engine.run_replay(fc, solver="exact", n_frames=2)
    assert all(f["quota"] == 0 and sum(f["plan"]) == 0 and f["changed_from_previous"] == [] for f in out["frames"])
    assert all(f["matches_exact"] for f in out["frames"])


# ---------------------------------------------------------------------------- C12
@pytest.mark.check(id="C12", name="Replay commits a valid, quota-exact, protected-safe plan every hour")
def test_replay_commits_valid_quota_exact_protected_safe_plans(exact_run, forecast, check_detail):
    frames, n = exact_run["frames"], exact_run["n_feeders"]
    day = engine.day_from_forecast(forecast)
    assert [f["hour"] for f in frames] == list(range(12, 24)) and exact_run["horizon_hours"] == 3
    running = [0.0] * n
    prev_plan, prev_window = [0] * n, None
    for f in frames:
        hour = f["hour"]
        expected_quota = min(4, quota_from_shortfall(day["actual"][hour], 5.0))
        assert f["quota"] == expected_quota == f["window_quotas"][0] == sum(f["plan"])
        assert f["shortfall_mw"] == day["actual"][hour] and f["forecast_mw"] == day["pred"][hour]
        assert all(f["plan"][p] == 0 for p in PROTECTED)
        assert len(f["window_bits"]) == 3 * n and [int(c) for c in f["window_bits"][:n]] == f["plan"]
        assert all(f["window_bits"][t * n + p] == "0" for t in range(3) for p in PROTECTED)
        assert [sum(int(c) for c in f["window_bits"][t * n:(t + 1) * n]) for t in range(3)] == f["window_quotas"]
        running = [running[i] + f["plan"][i] for i in range(n)]
        assert f["ledger_after"] == running
        assert f["changed_from_previous"] == [i for i in range(n) if f["plan"][i] != prev_plan[i]]
        want_revised = [] if prev_window is None else \
            [i for i in range(n) if f["plan"][i] != int(prev_window[n + i])]
        assert f["revised_vs_prior_plan"] == want_revised
        assert f["solver_used"] == "exact" and f["matches_exact"] and f["cost"] == pytest.approx(f["exact_cost"])
        assert f["audit_passed"] is True or f["audit_passed"] is False
        prev_plan, prev_window = f["plan"], f["window_bits"]
    assert frames[0]["changed_from_previous"] == [i for i, v in enumerate(frames[0]["plan"]) if v]
    assert frames[0]["revised_vs_prior_plan"] == []
    s = exact_run["summary"]
    free_ledger = [s["final_ledger"][i] for i in range(n) if i not in PROTECTED]
    assert s["final_ledger"] == running and all(running[p] == 0 for p in PROTECTED)
    assert s["fairness_spread_hours"] == max(free_ledger) - min(free_ledger)
    assert s["n_frames"] == 12 and s["matches_exact_count"] == 12
    assert s["n_changed"] == sum(len(f["changed_from_previous"]) for f in frames)
    assert sum(running) == sum(f["quota"] for f in frames)
    errs = list(Draft202012Validator(schema_for("replay.json")).iter_errors(with_meta(exact_run, 7, "test")))
    assert not errs, errs[:2]
    check_detail(f"{len(frames)} of {len(frames)} frames valid; quotas {[f['quota'] for f in frames]}; "
                 f"protected feeders 2 and 6 never off; ledger_after equals the running sum; "
                 f"{s['matches_exact_count']}/{s['n_frames']} match the exact optimum")


# ---------------------------------------------------------------------------- C13
BAD_CASES = [("wrong_quota", "invalid plan"), ("protected_on", "invalid plan"), ("crash", "exit code 3"),
             ("garbage", "unreadable output"), ("silent", "no output file")]


@pytest.mark.check(id="C13", name="Replay falls back to exact when the quantum solver is unavailable or wrong")
def test_replay_falls_back_to_exact_and_accepts_a_correct_solver(forecast, exact_run, tmp_path, check_detail):
    reasons = []

    def run(command, n_frames=2, timeout=60.0, tmp_name="tmp"):
        return engine.run_replay(forecast, solver="quantum", seed=7, quantum_command=command, timeout=timeout,
                                 tmp_dir=tmp_path / tmp_name, n_frames=n_frames)

    def assert_fell_back(out, reason):
        for f, ref in zip(out["frames"], exact_run["frames"]):
            assert f["solver_used"].startswith("exact (fallback: ") and reason in f["solver_used"], f["solver_used"]
            assert f["plan"] == ref["plan"] and f["window_bits"] == ref["window_bits"] and f["matches_exact"]
            assert f["warm_started"] is False
        assert out["solver_requested"] == "quantum" and "fallback" in out["notes"]
        reasons.append(out["frames"][0]["solver_used"])

    # command or script missing
    assert_fell_back(run([sys.executable, str(tmp_path / "no_such_script.py"), "solve-window"]), "not found")
    assert_fell_back(run(["definitely-not-a-real-binary-xyz", "solve-window"]), "command not found")
    # the default command when scripts/run_quantum.py does not exist yet is the same path
    if not engine.quantum_script_exists():
        assert_fell_back(engine.run_replay(forecast, solver="quantum", n_frames=2, tmp_dir=tmp_path / "d"),
                         "run_quantum.py not found")
    # non-zero exit, unreadable output, no output, invalid plans
    for kind, reason in BAD_CASES:
        assert_fell_back(run(make_fake(tmp_path, kind), tmp_name=f"t_{kind}"), reason)
    # timeout
    assert_fell_back(run(make_fake(tmp_path, "sleeper"), n_frames=1, timeout=1.0, tmp_name="t_sleep"), "timeout")

    # a correct (optimal) fake solver is used, matches exact, and receives the warm start
    good = run(make_fake(tmp_path, "optimal"), n_frames=3, tmp_name="t_opt")
    assert all(f["solver_used"] == "quantum (fake-optimal)" and f["matches_exact"] for f in good["frames"])
    assert good["summary"]["matches_exact_count"] == 3
    log = calls_log(tmp_path / "t_opt")
    assert len(log) == 3 and log[0]["warm_start"] is None and all(c["seed"] == 7 for c in log)
    assert [f["warm_started"] for f in good["frames"]] == [False, True, True]
    for i in (1, 2):
        ws = log[i]["warm_start"]
        assert ws["calls"] == i                                                      # opaque object passed through
        assert ws["prev_window_bits_shifted"] == engine.shift_bits(good["frames"][i - 1]["window_bits"], 8)
    assert [f["plan"] for f in good["frames"]] == [f["plan"] for f in exact_run["frames"][:3]]

    # a valid but non-optimal fake solver is accepted; its own cost claim (0.0) is never trusted
    greedy = run(make_fake(tmp_path, "greedy"), n_frames=3, tmp_name="t_greedy")
    assert all(f["solver_used"] == "quantum (fake-greedy)" for f in greedy["frames"])
    assert all(f["cost"] > 0 and f["matches_exact"] == (abs(f["cost"] - f["exact_cost"]) <= 1e-9)
               for f in greedy["frames"])
    assert all(f["cost"] >= f["exact_cost"] - 1e-9 for f in greedy["frames"])
    assert all(sum(f["plan"]) == f["quota"] and all(f["plan"][p] == 0 for p in PROTECTED) for f in greedy["frames"])
    check_detail(f"{len(reasons)} failure modes fell back to exact ({'; '.join(r.split('fallback: ')[1][:-1] for r in reasons)}); "
                 f"correct fake solver accepted on {len(good['frames'])} of {len(good['frames'])} frames with warm start passed")


# ---------------------------------------------------------------------------- C14
@pytest.mark.check(id="C14", name="Replay with a fixed seed reproduces identical frames")
def test_replay_with_fixed_seed_reproduces_identical_frames(forecast, exact_run, tmp_path, check_detail):
    again = engine.run_replay(forecast, solver="exact", seed=7)
    assert strip_volatile(again["frames"]) == strip_volatile(exact_run["frames"])
    assert strip_volatile(with_meta(again, 7, "t")) == strip_volatile(with_meta(exact_run, 7, "t"))
    rebuilt = build_forecast(seed=7)                         # a rebuilt forecast gives the same replay input
    assert strip_volatile(engine.run_replay(rebuilt, solver="exact", seed=7, n_frames=4)["frames"]) \
        == strip_volatile(exact_run["frames"][:4])
    cmd = make_fake(tmp_path, "optimal")
    q1 = engine.run_replay(forecast, solver="quantum", seed=7, quantum_command=cmd, tmp_dir=tmp_path / "a", n_frames=3)
    q2 = engine.run_replay(forecast, solver="quantum", seed=7, quantum_command=cmd, tmp_dir=tmp_path / "b", n_frames=3)
    assert strip_volatile(q1["frames"]) == strip_volatile(q2["frames"])
    check_detail(f"{len(again['frames'])} exact frames identical across two seed-7 runs; "
                 f"{len(q1['frames'])} fake-solver frames identical across two runs")
