#!/usr/bin/env python3
"""Generate schema-valid MOCK fixtures for the dashboard into ui/tests/fixtures/.

THESE ARE NOT REAL RESULTS. Every number from the quantum side (ablation, lottery, pareto,
risk, counting, scaling, checks) is invented here so the UI can be developed and tested before
the real results/*.json exist. The classical side follows docs/CONTRACT.md (same cost model).
The dashboard loads these only with  ?results=tests/fixtures/  and then shows a red badge.

Usage:  .venv/Scripts/python.exe ui/tests/make_fixtures.py
"""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixture_core import *  # noqa: F401,F403
from fixture_more import make_ablation, make_lottery, make_pareto, make_misc  # noqa: E402
from fixture_replay import make_replay, make_forecast  # noqa: E402


def main():
    base = make_instance("base_8x3", 8, 3, [3, 2, 4], {2: "hospital", 6: "water_pump"}, start=18)
    heat_inst = make_instance("heatwave_cap_8x3", 8, 3, [3, 3, 3], {2: "hospital", 6: "water_pump"},
                              start=14, weights={"hardship": 1.0, "fairness": 1.0, "consecutive": 3.0},
                              rules={"max_consecutive": 1, "max_daily_hours": 2}, seed=11)
    block = make_instance("block_4x2", 4, 2, [2, 1], {1: "hospital"}, start=18, seed=5)

    inst_file = {**meta(), **base}
    write("instance.json", inst_file)
    base_plans, plans, costs, ref = make_plans(base, "Base case: 8 feeders, 3 hours, quotas 3, 2, 4.", 1, cap_aware=False)
    write("plans/base.json", base_plans)
    heat_plans, *_ = make_plans(heat_inst, "Heatwave with a consecutive-outage cap: round-robin and random fail.", 3)
    write("plans/heatwave_cap.json", heat_plans)
    block_plans, *_ = make_plans(block, "Small 4x2 block used for counting and the Grover comparator.", 2, cap_aware=False)
    write("plans/block_4x2.json", block_plans)

    # audit examples on the heatwave scenario
    ex = []
    ex_plans = [("Exact plan", "exact", heat_plans["plans"][0]["matrix"]),
                ("Round-robin plan", "round_robin", heat_plans["plans"][1]["matrix"]),
                ("Hand-made plan", "manual", [[1, 1, 0, 1, 0, 0, 0, 0], [1, 0, 1, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 1, 0, 1]])]
    for label, method, M in ex_plans:
        viol, per = audit(heat_inst, M)
        score = round(100.0 * sum(1 for r in per.values() if r["passed"]) / 4, 1)
        ex.append({"label": label, "method": method, "bits": to_bits(M), "matrix": M,
                   "passed": not viol, "score": score, "violations": viol, "per_rule": per})
    write("audit_example.json", {**meta(), "scenario": heat_inst["name"], "instance": heat_inst,
                                 "rules": heat_inst["rules"], "examples": ex})

    pareto_pts = make_pareto(base, plans)
    write("pareto.json", {**meta(), "instance_name": base["name"], "method": "grover_mixer_qaoa",
                          "fairness_metric_name": "std of total outage hours (h)", "default_index": 2,
                          "points": pareto_pts, "notes": "MOCK FIXTURE."})
    write("ablation.json", make_ablation(base, ref))
    write("lottery.json", make_lottery(base, plans, costs))
    make_misc(OUT, base, block)
    write("replay.json", make_replay(base))
    write("forecast.json", make_forecast(base))
    validate()
    print("wrote fixtures to", OUT)


def validate():
    try:
        import jsonschema
    except ImportError:
        print("jsonschema not installed; skipping schema validation")
        return
    idx = json.loads((ROOT / "schemas" / "index.json").read_text())["files"]
    bad = 0
    for pattern, schema_name in idx.items():
        schema = json.loads((ROOT / "schemas" / f"{schema_name}.schema.json").read_text())
        for f in sorted(OUT.glob(pattern)):
            errs = list(jsonschema.Draft202012Validator(schema).iter_errors(json.loads(f.read_text())))
            if errs:
                bad += 1
                print("INVALID", f.name, errs[0].message[:200])
    print("schema validation:", "FAILED" if bad else "all fixtures valid")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
