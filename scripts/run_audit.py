"""Write results/audit_example.json: audits of four example schedules on heatwave_cap (Area 2).

Usage:  python scripts/run_audit.py [--seed 7]

Examples: (a) the exact optimum, (b) round-robin, (c) the seeded random-valid plan, and
(d) a hand-made schedule that deliberately trips all four rules. Everything is synthetic.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.audit.rules import RULE_NAMES, audit                    # noqa: E402
from src.classical.baselines import random_valid, round_robin    # noqa: E402
from src.classical.milp import exact_reference                   # noqa: E402
from src.data.scenarios import SCENARIOS                         # noqa: E402
from src.export.writer import write_result                       # noqa: E402

SOURCE = "scripts/run_audit.py"
SCENARIO = "heatwave_cap"


def broken_schedule(inst) -> np.ndarray:
    """Hand-made schedule that trips quota, protected, max_consecutive and daily_hours.

    Hour 0 cuts one feeder too many and a protected feeder; the highest-ledger feeder is then
    cut in every hour (cap and daily limit), and a second feeder is cut in the last two hours.
    """
    T, N = inst.n_hours, inst.n_feeders
    free = sorted(inst.free, key=lambda f: (-inst.ledger_hours[f], f))
    heavy, second, others = free[0], free[1], free[2:]
    x = np.zeros((T, N), dtype=int)
    x[:, heavy] = 1
    x[0, second] = 1
    x[0, inst.protected[0]] = 1                       # quota (one too many) and protected
    for t in range(1, T):
        need = inst.quotas[t] - 1                     # heavy already counts
        for f in others[:need]:
            x[t, f] = 1
        if t == T - 1 and need >= 1:
            x[t - 1, others[0]] = 1                   # same feeder in the last two hours (cap)
    return x


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    inst, _ = SCENARIOS[SCENARIO]()
    exact = exact_reference(inst)
    examples = [
        ("Exact optimum", "exact", exact["optimal_bits"][0]),
        ("Round-robin", "round_robin", round_robin(inst)),
        ("Random valid (one seeded draw)", "random_valid",
         random_valid(inst, np.random.default_rng(args.seed))),
        ("Deliberately broken example", "hand_made", inst.to_bits(broken_schedule(inst))),
    ]
    out = []
    for label, method, bits in examples:
        a = audit(inst, bits)
        out.append({"label": label, "method": method, "bits": bits,
                    "matrix": inst.to_matrix(bits).tolist(), **a})
    broken = out[-1]
    untripped = [r for r in RULE_NAMES if broken["per_rule"][r]["passed"]]
    if untripped:
        raise SystemExit(f"broken example does not trip rule(s): {untripped}")
    if not out[0]["passed"]:
        raise SystemExit("exact optimum unexpectedly fails the audit")

    write_result("audit_example.json", {"scenario": SCENARIO, "instance": inst.to_dict(),
                                        "rules": dict(inst.rules), "examples": out},
                 args.seed, SOURCE)
    print(f"{'example':<34}{'passed':>7}{'score':>8}{'violations':>11}   per rule (quota/protected/cap/daily)")
    for e in out:
        pr = e["per_rule"]
        print(f"{e['label']:<34}{str(e['passed']):>7}{e['score']:>8.1f}{len(e['violations']):>11}   "
              + "/".join(str(pr[r]["count"]) for r in RULE_NAMES))
    print("wrote results/audit_example.json (scenario heatwave_cap, synthetic data)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
