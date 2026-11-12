"""Audit mode (Area 2): score ANY schedule against four rules and list every violation.

The audit does not require the plan to be valid. It is the independent referee used by the
dashboard, the replay and the baselines.

Rules
  quota            each hour's off-count equals quotas[t]            (one violation per bad hour)
  protected        a protected feeder is off                         (one per (hour, feeder))
  max_consecutive  a non-protected feeder is off for more than
                   `max_consecutive` adjacent hours; prev_off[f]==1
                   counts as one off-hour just before hour 0         (one per feeder)
  daily_hours      ledger_hours[f] + plan hours of f > max_daily_hours (one per feeder)

score = 100 * passed checks / total checks, with
  total = T (quota) + T*|protected| + |free| (consecutive) + |free| (daily).
"""
from __future__ import annotations

from typing import Any

from src.cost.model import Instance

RULE_NAMES = ("quota", "protected", "max_consecutive", "daily_hours")


def _clock(inst: Instance, t: int) -> str:
    return f"{(inst.start_hour + t) % 24:02d}:00"


def _fmt(v: float) -> str:
    return f"{v:g}"


def audit(inst: Instance, plan: Any, rules: dict | None = None) -> dict:
    x = inst.to_matrix(plan)
    r = dict(inst.rules)
    r.update(rules or {})
    cap = int(r["max_consecutive"])
    max_daily = float(r["max_daily_hours"])
    free, protected = inst.free, inst.protected
    name = {f["id"]: f["name"] for f in inst.feeders}
    T = inst.n_hours

    violations: list = []
    counts = {k: 0 for k in RULE_NAMES}

    def add(rule: str, hour, feeder, detail: str) -> None:
        violations.append({"rule": rule, "hour": hour, "feeder": feeder, "detail": detail})
        counts[rule] += 1

    # 1. quota: one check per hour
    for t in range(T):
        got, want = int(x[t].sum()), int(inst.quotas[t])
        if got != want:
            add("quota", t, None, f"hour {t} ({_clock(inst, t)}): expected {want} feeders off, found {got}")

    # 2. protected: one check per (hour, protected feeder)
    for t in range(T):
        for f in protected:
            if x[t, f]:
                add("protected", t, f,
                    f"hour {t} ({_clock(inst, t)}): protected feeder {f} ({name[f]}) is off")

    # 3. max_consecutive: one check per non-protected feeder
    for f in free:
        run = 1 if inst.prev_off[f] else 0      # the hour before the window counts
        first_bad = None
        for t in range(T):
            if x[t, f]:
                run += 1
                if run > cap and first_bad is None:
                    first_bad = t
            else:
                run = 0
        if first_bad is not None:
            # full length of the run that first broke the cap, for the message
            start = first_bad
            while start > 0 and x[start - 1, f]:
                start -= 1
            end = first_bad
            while end + 1 < T and x[end + 1, f]:
                end += 1
            length = end - start + 1 + (1 if (start == 0 and inst.prev_off[f]) else 0)
            note = " (counting the hour before the window)" if (start == 0 and inst.prev_off[f]) else ""
            add("max_consecutive", first_bad, f,
                f"feeder {f} ({name[f]}) is off {length} adjacent hours{note}, cap is {cap}; "
                f"cap first exceeded at hour {first_bad} ({_clock(inst, first_bad)})")

    # 4. daily_hours: one check per non-protected feeder
    for f in free:
        hours = int(x[:, f].sum())
        total = float(inst.ledger_hours[f]) + hours
        if total > max_daily + 1e-9:
            add("daily_hours", None, f,
                f"feeder {f} ({name[f]}): ledger {_fmt(inst.ledger_hours[f])} + plan {hours} = "
                f"{_fmt(total)} hours, daily limit is {_fmt(max_daily)}")

    totals = {"quota": T, "protected": T * len(protected),
              "max_consecutive": len(free), "daily_hours": len(free)}
    n_checks = sum(totals.values())
    n_failed = sum(counts.values())
    score = 100.0 * (n_checks - n_failed) / n_checks if n_checks else 100.0
    return {
        "passed": n_failed == 0,
        "score": float(score),
        "violations": violations,
        "per_rule": {k: {"passed": counts[k] == 0, "count": counts[k]} for k in RULE_NAMES},
    }
