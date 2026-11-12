"""Core helpers for the MOCK fixture generator (cost model per docs/CONTRACT.md). Not real results."""
import itertools
import json
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "fixtures"
SEED = 7
NOW = "2026-11-12T12:00:00Z"
SRC = "ui/tests/make_fixtures.py (MOCK FIXTURE, not real results)"
TERMS = ("hardship", "fairness", "consecutive")

ZONES = [("Lyari", 24.871, 66.997), ("Saddar", 24.856, 67.023), ("Civil Lines", 24.846, 67.033),
         ("Korangi", 24.830, 67.132), ("Gulshan-e-Iqbal", 24.918, 67.097),
         ("North Nazimabad", 24.942, 67.045), ("Dhabeji Pumping", 24.905, 67.140),
         ("Orangi Town", 24.951, 66.985), ("Malir", 24.893, 67.196), ("Landhi", 24.848, 67.200)]
KIND_MULT = {"residential": 1.0, "commercial": 0.7, "industrial": 0.5,
             "hospital": 3.0, "water_pump": 2.5, "telecom": 2.0}


def meta(extra_src=None):
    return {"schema_version": "1.0", "generated_at": NOW, "seed": SEED,
            "source": extra_src or SRC, "data_provenance": "synthetic"}


def heat(h):
    return 0.5 * (1 + math.cos(2 * math.pi * ((h % 24) - 15) / 24))


def make_instance(name, n, T, quotas, protected, start=18, weights=None, rules=None, seed=SEED):
    rng = random.Random(seed)
    feeders = []
    for f in range(n):
        zone, lat, lon = ZONES[f]
        if f in protected:
            kind, pop = protected[f], rng.randint(2, 5) * 5000
        else:
            kind = rng.choices(["residential", "commercial", "industrial"], [6, 2.5, 1.5])[0]
            lo, hi = {"residential": (4, 12), "commercial": (1, 4), "industrial": (1, 2)}[kind]
            pop = rng.randint(lo, hi) * 5000
        feeders.append({"id": f, "name": f"F{f} {zone}", "zone": zone, "kind": kind,
                        "protected": f in protected, "population": pop,
                        "heat_index": rng.choice([0.7, 0.85, 1.0]), "lat": lat, "lon": lon})
    fm = 5.0
    ledger = [0.0 if f in protected else float(rng.randint(0, 3)) for f in range(n)]
    hard = []
    for t in range(T):
        row = []
        for fd in feeders:
            b = KIND_MULT[fd["kind"]] * (0.5 + fd["population"] / 40000) * fd["heat_index"] * (1 + heat(start + t))
            row.append(max(0.5, round(b * 2) / 2))
        hard.append(row)
    inst = {"name": name, "n_feeders": n, "n_hours": T, "start_hour": start % 24, "feeder_mw": fm,
            "shortfall_mw": [round((m - 0.4) * fm, 1) for m in quotas], "quotas": list(quotas),
            "feeders": feeders, "hardship": hard, "ledger_hours": ledger, "prev_off": [0] * n,
            "weights": dict(weights or {"hardship": 1.0, "fairness": 1.0, "consecutive": 2.0}),
            "rules": dict(rules or {"max_consecutive": 2, "max_daily_hours": 5})}
    free = free_ids(inst)
    inst["fairness_target"] = (sum(ledger[f] for f in free) + sum(quotas)) / len(free)
    inst["qubo"] = {"n_vars": n * T, "var_order": "q = t*n_feeders + f ; bits[q] is variable q",
                    "terms": qubo_terms(inst)}
    return inst


def free_ids(inst):
    return [f["id"] for f in inst["feeders"] if not f["protected"]]


def breakdown(inst, M):
    T, free, mu = inst["n_hours"], free_ids(inst), inst["fairness_target"]
    h = sum(inst["hardship"][t][f] * M[t][f] for t in range(T) for f in free)
    tot = [inst["ledger_hours"][f] + sum(M[t][f] for t in range(T)) for f in free]
    fair = sum((v - mu) ** 2 for v in tot)
    cons = sum(M[t][f] * M[t + 1][f] for t in range(T - 1) for f in free)
    cons += sum(inst["prev_off"][f] * M[0][f] for f in free)
    return {"hardship": float(h), "fairness": float(fair), "consecutive": float(cons)}


def cost(inst, M, w=None):
    b, w = breakdown(inst, M), w or inst["weights"]
    return sum(w[k] * b[k] for k in TERMS)


def qubo_terms(inst):
    n, T, mu = inst["n_feeders"], inst["n_hours"], inst["fairness_target"]
    q = lambda t, f: t * n + f
    out = {k: {"offset": 0.0, "linear": [0.0] * (n * T), "quadratic": []} for k in TERMS}
    for f in free_ids(inst):
        d = inst["ledger_hours"][f] - mu
        out["fairness"]["offset"] += d * d
        for t in range(T):
            out["hardship"]["linear"][q(t, f)] = float(inst["hardship"][t][f])
            out["fairness"]["linear"][q(t, f)] = 2 * d + 1
            for t2 in range(t + 1, T):
                out["fairness"]["quadratic"].append([q(t, f), q(t2, f), 2.0])
        for t in range(T - 1):
            out["consecutive"]["quadratic"].append([q(t, f), q(t + 1, f), 1.0])
        out["consecutive"]["linear"][q(0, f)] = float(inst["prev_off"][f])
    return out


def to_bits(M):
    return "".join(str(v) for row in M for v in row)


def to_matrix(bits, n):
    return [[int(c) for c in bits[i:i + n]] for i in range(0, len(bits), n)]


def valid_plans(inst):
    n, free = inst["n_feeders"], free_ids(inst)
    per_hour = []
    for m in inst["quotas"]:
        opts = []
        for combo in itertools.combinations(free, m):
            row = [0] * n
            for f in combo:
                row[f] = 1
            opts.append(row)
        per_hour.append(opts)
    for rows in itertools.product(*per_hour):
        yield [list(r) for r in rows]


def audit(inst, M):
    n, T, rules = inst["n_feeders"], inst["n_hours"], inst["rules"]
    viol = []
    for t in range(T):
        if sum(M[t]) != inst["quotas"][t]:
            viol.append({"rule": "quota", "hour": t, "feeder": None,
                         "detail": f"hour {t}: {sum(M[t])} feeders off, quota is {inst['quotas'][t]}"})
    for f in range(n):
        if inst["feeders"][f]["protected"]:
            for t in range(T):
                if M[t][f]:
                    viol.append({"rule": "protected", "hour": t, "feeder": f,
                                 "detail": f"{inst['feeders'][f]['name']} is protected but off"})
    for f in range(n):
        run = inst["prev_off"][f]
        for t in range(T):
            run = run + 1 if M[t][f] else 0
            if run > rules["max_consecutive"]:
                viol.append({"rule": "max_consecutive", "hour": t, "feeder": f,
                             "detail": f"{inst['feeders'][f]['name']} off {run} hours in a row (max {rules['max_consecutive']})"})
        tot = sum(M[t][f] for t in range(T))
        if tot > rules["max_daily_hours"]:
            viol.append({"rule": "daily_hours", "hour": None, "feeder": f,
                         "detail": f"{inst['feeders'][f]['name']} off {tot} h (max {rules['max_daily_hours']})"})
    per = {r: {"passed": not any(v["rule"] == r for v in viol),
               "count": sum(1 for v in viol if v["rule"] == r)}
           for r in ("quota", "protected", "max_consecutive", "daily_hours")}
    return viol, per


def entropy(inst, M):
    free, T = free_ids(inst), inst["n_hours"]
    H = [inst["ledger_hours"][f] + sum(M[t][f] for t in range(T)) for f in free]
    s = sum(H)
    if s <= 0 or len(free) < 2:
        return 1.0
    return -sum((h / s) * math.log(h / s) for h in H if h > 0) / math.log(len(free))


def std_hours(inst, M):
    free, T = free_ids(inst), inst["n_hours"]
    H = [inst["ledger_hours"][f] + sum(M[t][f] for t in range(T)) for f in free]
    mean = sum(H) / len(H)
    return math.sqrt(sum((h - mean) ** 2 for h in H) / len(H))


def plan_row(inst, ref, method, label, kind, M, notes):
    viol, _ = audit(inst, M)
    feas = not any(v["rule"] in ("quota", "protected") for v in viol)
    c = cost(inst, M)
    span = (ref["cost_max"] - ref["cost_min"]) or 1.0
    return {"method": method, "label": label, "kind": kind, "bits": to_bits(M), "matrix": M,
            "cost": c, "breakdown": breakdown(inst, M), "feasible": feas,
            "approx_ratio": max(0.0, min(1.0, (ref["cost_max"] - c) / span)) if feas else 0.0,
            "fairness_entropy": entropy(inst, M), "audit_passed": not viol,
            "n_violations": len(viol), "notes": notes}


def round_robin(inst):
    free, n, ptr, M = free_ids(inst), inst["n_feeders"], 0, []
    for m in inst["quotas"]:
        row = [0] * n
        for _ in range(m):
            row[free[ptr % len(free)]] = 1
            ptr += 1
        M.append(row)
    return M


def make_plans(inst, desc, seed, cap_aware=True):
    plans = list(valid_plans(inst))
    costs = [cost(inst, M) for M in plans]
    ref = {"cost_min": min(costs), "cost_max": max(costs)}
    ok = [(c, M) for c, M in zip(costs, plans) if not audit(inst, M)[0]] if cap_aware else list(zip(costs, plans))
    best = min(ok, key=lambda p: p[0])
    n_opt = sum(1 for c in costs if c <= ref["cost_min"] + 1e-9)
    rnd = random.Random(seed)
    rv = rnd.choice(plans)
    rows = [plan_row(inst, ref, "exact", "Exact classical (brute force)", "classical", best[1],
                     "Optimal among plans that also pass the audit rules."),
            plan_row(inst, ref, "round_robin", "Round-robin", "classical", round_robin(inst),
                     "Rotates through eligible feeders; ignores hardship and caps."),
            plan_row(inst, ref, "random_valid", "Random valid plan", "classical", rv,
                     "One seeded draw from the valid plans.")]
    sample = [rnd.choice(plans) for _ in range(300)]
    viol_pct = 100.0 * sum(1 for M in sample if audit(inst, M)[0]) / len(sample)
    mean_c = sum(cost(inst, M) for M in sample) / len(sample)
    stats = {"n_samples": len(sample), "mean_cost": mean_c,
             "mean_approx_ratio": sum((ref["cost_max"] - cost(inst, M)) / (ref["cost_max"] - ref["cost_min"]) for M in sample) / len(sample),
             "cap_violation_pct": viol_pct,
             "p_optimal": sum(1 for M in sample if cost(inst, M) <= ref["cost_min"] + 1e-9) / len(sample)}
    exact = {"method": "brute_force", "cost_min": ref["cost_min"], "cost_max": ref["cost_max"],
             "n_valid": len(plans), "n_optimal": n_opt,
             "optimal_bits": [to_bits(M) for c, M in zip(costs, plans) if c <= ref["cost_min"] + 1e-9][:8]}
    return {**meta(), "scenario": inst["name"], "description": desc, "instance": inst, "exact": exact,
            "plans": rows, "random_valid_stats": stats}, plans, costs, ref


def write(name, obj):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
