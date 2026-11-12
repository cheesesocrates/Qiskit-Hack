"""Receding-horizon replay of one day -> results/replay.json (Area 2).

Usage:  python scripts/run_replay.py [--solver exact|quantum] [--seed 7] [--timeout 300]

Needs results/forecast.json (run scripts/run_forecast.py first). The default solver is
"quantum" when scripts/run_quantum.py exists, otherwise "exact". A quantum frame that fails
falls back to the exact solver and says so in `solver_used`.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.export.writer import write_result  # noqa: E402
from src.replan.engine import (DEFAULT_TIMEOUT_S, ForecastMissing, load_forecast,  # noqa: E402
                               quantum_script_exists, run_replay)


def _print_frame(f: dict) -> None:
    off = [i for i, v in enumerate(f["plan"]) if v]
    fc = "n/a" if f["forecast_mw"] is None else f"{f['forecast_mw']:5.1f}"
    print(f"step {f['step']:2d} {f['hour']:02d}:00  actual {f['shortfall_mw']:5.1f} MW  forecast {fc} MW  "
          f"quota {f['quota']}  off {off}  changed {f['changed_from_previous']}  "
          f"cost {f['cost']:.2f} (exact {f['exact_cost']:.2f}, {'match' if f['matches_exact'] else 'DIFF'})  "
          f"{f['solver_used']}  {f['runtime_s']:.2f}s", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--solver", choices=["exact", "quantum"], default=None,
                    help="default: quantum if scripts/run_quantum.py exists, else exact")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S, help="seconds per quantum call")
    args = ap.parse_args()
    solver = args.solver or ("quantum" if quantum_script_exists() else "exact")

    try:
        forecast = load_forecast()
    except ForecastMissing as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"replay: solver requested = {solver}, seed {args.seed}")
    payload = run_replay(forecast, solver=solver, seed=args.seed, timeout=args.timeout, on_frame=_print_frame)
    path = write_result("replay.json", payload, args.seed, "scripts/run_replay.py")

    s = payload["summary"]
    print(f"{s['n_frames']} frames, {s['matches_exact_count']} matched the exact optimum, "
          f"{s['n_changed']} feeder state changes, total hardship {s['total_hardship']:.1f}, "
          f"fairness spread {s['fairness_spread_hours']:.1f} h, final ledger {s['final_ledger']}")
    print("wrote", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
