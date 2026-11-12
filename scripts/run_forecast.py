"""Classical ridge forecast of a SYNTHETIC shortfall series -> results/forecast.json (Area 2).

Usage:  python scripts/run_forecast.py [--seed 7] [--refresh]
  --refresh   force a live Open-Meteo fetch (and rewrite the committed snapshot on success)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.export.writer import write_result  # noqa: E402
from src.forecast.pipeline import build_forecast  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--refresh", action="store_true", help="force a live Open-Meteo fetch")
    args = ap.parse_args()

    payload = build_forecast(seed=args.seed, refresh=args.refresh)
    path = write_result("forecast.json", payload, args.seed, "scripts/run_forecast.py")

    m = payload["metrics"]
    print(f"[classical ridge] weather: {payload['weather_source']} ({payload['weather_provenance']}); "
          f"demand/shortfall: synthetic")
    print(f"test set ({payload['model']['n_test']} h): MAE {m['mae_mw']:.3f} MW, "
          f"RMSE {m['rmse_mw']:.3f} MW, R2 {m['r2']:.3f}")
    res = payload["residuals"]
    print(f"residuals: n={res['n']}, std {res['std_mw']:.3f} MW, bin probs "
          f"{[round(b['prob'], 3) for b in res['bins']]}")
    print("day-ahead quotas:", [row["quota"] for row in payload["day_ahead"]])
    print("wrote", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
