"""Write results/instance.json and results/plans/<scenario>.json (Area 2, classical side).

Usage:  python scripts/run_classical.py [--seed 7] [--samples 2000] [--only base,heatwave_cap]

Deterministic for a given --seed. Exact reference: brute force when small, MILP otherwise.
Everything is synthetic.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.classical.plans import N_SAMPLES, build_plans          # noqa: E402
from src.data.generator import base_instance                    # noqa: E402
from src.data.scenarios import SCENARIOS                        # noqa: E402
from src.export.writer import write_result                      # noqa: E402

SOURCE = "scripts/run_classical.py"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=7, help="seed for the random-valid draws (default 7)")
    ap.add_argument("--samples", type=int, default=N_SAMPLES, help="random-valid Monte-Carlo samples")
    ap.add_argument("--only", default="", help="comma-separated scenario names (default: all)")
    args = ap.parse_args()
    names = [n for n in args.only.split(",") if n] or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        ap.error(f"unknown scenario(s): {unknown}; choose from {list(SCENARIOS)}")

    t0 = time.perf_counter()
    write_result("instance.json", base_instance().to_dict(), args.seed, SOURCE)

    rows = []
    for name in names:
        t = time.perf_counter()
        payload = build_plans(name, seed=args.seed, n_samples=args.samples)
        write_result(f"plans/{name}.json", payload, args.seed, SOURCE)
        by = {p["method"]: p for p in payload["plans"]}
        ex, st, inst = payload["exact"], payload["random_valid_stats"], payload["instance"]
        rows.append((name, f"{inst['n_feeders']}x{inst['n_hours']}", ex["method"], ex["n_valid"],
                     ex["cost_min"], by["round_robin"]["cost"], by["round_robin"]["approx_ratio"],
                     by["round_robin"]["n_violations"], st["mean_approx_ratio"],
                     st["cap_violation_pct"], time.perf_counter() - t))

    hdr = (f"{'scenario':<14}{'NxT':>5} {'exact':<12}{'n_valid':>11}{'c_min':>9}{'rr cost':>9}"
           f"{'rr ratio':>9}{'rr viol':>8}{'rnd ratio':>10}{'rnd cap%':>9}{'sec':>6}")
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(f"{r[0]:<14}{r[1]:>5} {r[2]:<12}{r[3]:>11}{r[4]:>9.2f}{r[5]:>9.2f}{r[6]:>9.3f}"
              f"{r[7]:>8}{r[8]:>10.3f}{r[9]:>9.1f}{r[10]:>6.2f}")
    print(f"wrote results/instance.json and {len(rows)} file(s) in results/plans/ "
          f"in {time.perf_counter() - t0:.2f}s (seed {args.seed}, synthetic data)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
