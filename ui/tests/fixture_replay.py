"""MOCK replay and forecast fixtures. Invented numbers, not real results."""
import copy
import math
import random
from datetime import datetime, timedelta

from fixture_core import (KIND_MULT, meta, breakdown, cost, heat, to_bits, valid_plans, free_ids)

MOCK = "MOCK FIXTURE - invented numbers, not real results."
PROFILE = [8.2, 10.5, 13.4, 17.9, 18.6, 17.2, 15.3, 14.1, 12.6, 9.8, 7.9, 6.4]


def window_inst(base, hour, quotas, ledger, prev_off):
    inst = copy.deepcopy(base)
    T = len(quotas)
    inst.update({"n_hours": T, "quotas": quotas, "start_hour": hour % 24, "ledger_hours": list(ledger),
                 "prev_off": list(prev_off), "shortfall_mw": [q * base["feeder_mw"] for q in quotas]})
    inst["hardship"] = [[max(0.5, round(KIND_MULT[fd["kind"]] * (0.5 + fd["population"] / 40000) * fd["heat_index"]
                                        * (1 + heat(hour + t)) * 2) / 2) for fd in base["feeders"]] for t in range(T)]
    free = free_ids(inst)
    inst["fairness_target"] = (sum(ledger[f] for f in free) + sum(quotas)) / len(free)
    return inst


def quota_of(mw, fm):
    return max(0, math.ceil(mw / fm - 1e-9))


def make_replay(base):
    rng = random.Random(21)
    fm, n = base["feeder_mw"], base["n_feeders"]
    start, H = 12, 3
    actual = PROFILE
    fc = [round(a + rng.gauss(0, 1.6), 1) for a in actual]
    ledger, prev, frames, prior = list(base["ledger_hours"]), [0] * n, [], None
    prev_plan, hard_total = None, 0.0
    for s in range(len(actual)):
        Tw = min(H, len(actual) - s)
        quotas = [quota_of(actual[s], fm)] + [quota_of(fc[s + k], fm) for k in range(1, Tw)]
        wi = window_inst(base, start + s, quotas, ledger, prev)
        plans = list(valid_plans(wi))
        order = sorted(plans, key=lambda M: cost(wi, M))
        mism = s == 4
        fallback = s == 7
        W = order[1] if mism else order[0]
        row = W[0]
        changed = [] if prev_plan is None else [f for f in range(n) if row[f] != prev_plan[f]]
        revised = [] if prior is None else [f for f in range(n) if prior[1][f] != row[f]] if len(prior) > 1 else []
        for f in range(n):
            ledger[f] += row[f]
        hard_total += sum(wi["hardship"][0][f] * row[f] for f in range(n))
        frames.append({"step": s, "hour": (start + s) % 24, "shortfall_mw": actual[s], "forecast_mw": fc[s],
                       "quota": quotas[0], "plan": row, "changed_from_previous": changed,
                       "revised_vs_prior_plan": revised, "window_quotas": quotas, "window_bits": to_bits(W),
                       "cost": cost(wi, W), "exact_cost": cost(wi, order[0]), "matches_exact": not mism,
                       "solver_used": "exact_fallback" if fallback else "grover_mixer_qaoa",
                       "warm_started": s > 0 and not fallback, "ledger_after": list(ledger),
                       "runtime_s": 0.01 if fallback else 2.4 + 0.1 * s, "audit_passed": True})
        prior, prev_plan, prev = W, row, list(row)
    free = free_ids(base)
    fl = [ledger[f] for f in free]
    return {**meta(), "scenario": base["name"], "horizon_hours": H, "n_feeders": n, "feeders": base["feeders"],
            "solver_requested": "grover_mixer_qaoa", "frames": frames,
            "summary": {"n_frames": len(frames), "n_changed": sum(len(f["changed_from_previous"]) for f in frames),
                        "matches_exact_count": sum(1 for f in frames if f["matches_exact"]),
                        "total_hardship": hard_total, "fairness_spread_hours": max(fl) - min(fl),
                        "final_ledger": ledger},
            "notes": MOCK}


def ridge(X, y, alpha):
    import numpy as np
    A = X.T @ X + alpha * np.eye(X.shape[1])
    return np.linalg.solve(A, X.T @ y)


def make_forecast(base):
    import numpy as np
    rng = random.Random(5)
    fm, t0, days = base["feeder_mw"], datetime(2026, 10, 5), 14
    rows, X, y = [], [], []
    for d in range(days):
        dayshift = rng.gauss(0, 2.0)
        for h in range(24):
            tm = t0 + timedelta(days=d, hours=h)
            temp = 31 + 4.5 * heat(h) + dayshift + rng.gauss(0, 0.5)
            wk = 1.0 if tm.weekday() >= 5 else 0.0
            act = 6 + 9 * heat(h) + 0.8 * (temp - 31) - 1.2 * wk + rng.gauss(0, 0.9)
            X.append([1, math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24), temp, wk])
            y.append(act)
            rows.append([tm, h, temp, act])
    n_train = 10 * 24
    Xa, ya = np.array(X), np.array(y)
    w = ridge(Xa[:n_train], ya[:n_train], 1.0)
    pred = Xa @ w
    res = (ya - pred)[n_train:]
    r2 = 1 - float((res ** 2).sum() / ((ya[n_train:] - ya[n_train:].mean()) ** 2).sum())
    lo, hi = float(res.min()) - 1e-9, float(res.max()) + 1e-9
    nb = 9
    edges = [lo + (hi - lo) * i / nb for i in range(nb + 1)]
    bins = []
    for i in range(nb):
        cnt = int(((res >= edges[i]) & (res < edges[i + 1])).sum())
        bins.append({"lo": edges[i], "hi": edges[i + 1], "mid": (edges[i] + edges[i + 1]) / 2, "prob": cnt / len(res)})
    series = [{"time": r[0].strftime("%Y-%m-%dT%H:%M"), "hour": r[1], "temperature_c": float(r[2]),
               "shortfall_actual_mw": float(r[3]), "shortfall_pred_mw": float(pred[i]),
               "split": "train" if i < n_train else "test"} for i, r in enumerate(rows)]
    day = []
    for h in range(24):
        tm = t0 + timedelta(days=days, hours=h)
        temp = 31 + 4.5 * heat(h)
        x = np.array([1, math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24), temp, 1.0 if tm.weekday() >= 5 else 0.0])
        p = float(x @ w)
        day.append({"hour": h, "shortfall_pred_mw": p, "quota": quota_of(p, fm)})
    return {**meta(), "label": "classical",
            "model": {"type": "ridge_regression", "alpha": 1.0,
                      "features": ["hour_sin", "hour_cos", "temperature_c", "is_weekend"],
                      "n_train": n_train, "n_test": len(rows) - n_train},
            "weather_source": "synthetic-scenario-file", "weather_provenance": "synthetic",
            "demand_provenance": "synthetic", "location": "Karachi (illustrative)",
            "metrics": {"mae_mw": float(np.abs(res).mean()), "rmse_mw": float(math.sqrt((res ** 2).mean())), "r2": r2},
            "series": series, "residuals": {"n": len(res), "std_mw": float(res.std()), "bins": bins},
            "day_ahead": day, "notes": MOCK}
