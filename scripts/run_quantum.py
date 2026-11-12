"""Area 1 entry point. Simulator only.

  python scripts/run_quantum.py all            # every stage below, in order
  python scripts/run_quantum.py ablation       # results/ablation.json  (three QAOA variants + GAS)
  python scripts/run_quantum.py lottery        # results/lottery.json   (Grover-mixer samples, tie proof)
  python scripts/run_quantum.py pareto         # results/pareto.json    (fairness-weight sweep)
  python scripts/run_quantum.py counting       # results/counting.json  (valid-plan count by IAE)
  python scripts/run_quantum.py risk           # results/risk.json      (VaR / CVaR by amplitude estimation)
  python scripts/run_quantum.py scaling        # results/scaling.json   (MPS bond-dimension curve)
  python scripts/run_quantum.py solve-window --in IN.json --out OUT.json   # called by the replay

A failing stage never leaves a stale or fake file behind: its output is removed, the
error is printed, and the other stages still run. Exit code is 1 if any stage failed.
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

STAGES = ("ablation", "lottery", "pareto", "counting", "risk", "scaling")


def _run_stage(name: str, seed: int) -> Path:
    if name == "ablation":
        from src.quantum.stages import run_ablation
        return run_ablation(seed)
    if name == "lottery":
        from src.quantum.stages import run_lottery
        return run_lottery(seed)
    if name == "pareto":
        from src.quantum.stages import run_pareto
        return run_pareto(seed)
    if name == "counting":
        from src.quantum.counting import run_counting
        return run_counting(seed)
    if name == "risk":
        from src.quantum.risk import run_risk
        return run_risk(seed)
    if name == "scaling":
        from src.quantum.scaling import run_scaling
        return run_scaling(seed)
    raise ValueError(name)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=STAGES + ("all", "solve-window"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--out", dest="out")
    args = ap.parse_args()

    if args.stage == "solve-window":
        from src.quantum.stages import solve_window
        out = solve_window(args.inp, args.out)
        print(f"window solved: feasible={out['feasible']} cost={out['cost']} in {out['runtime_s']}s")
        return 0

    failed = []
    for name in (STAGES if args.stage == "all" else (args.stage,)):
        t0 = time.perf_counter()
        print(f"[quantum] {name} ...", flush=True)
        try:
            path = _run_stage(name, args.seed)
            print(f"[quantum] {name} ok in {time.perf_counter() - t0:.1f}s -> {path.relative_to(ROOT)}", flush=True)
        except Exception:
            failed.append(name)
            traceback.print_exc()
            stale = ROOT / "results" / f"{name}.json"
            if stale.exists():
                stale.unlink()
            print(f"[quantum] {name} FAILED - results/{name}.json removed (dashboard shows 'not available')",
                  flush=True)
    if failed:
        print("[quantum] failed stages:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
