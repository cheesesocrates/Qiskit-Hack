"""C07 and metrics: the audit rules and derived metrics (Area 2)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from src.audit.rules import audit
from src.cost.metrics import approx_ratio, fairness_entropy, fairness_std, plan_hours
from src.data.generator import generate


def audit_instance(**kw):
    """5 feeders x 3 hours, feeder 1 protected, free = 0, 2, 3, 4, quotas 1, 2, 1, cap 1, daily limit 2."""
    base = dict(n_feeders=5, n_hours=3, quotas=[1, 2, 1], seed=2, protected={1: "hospital"},
                rules={"max_consecutive": 1, "max_daily_hours": 2}, ledger=[0, 0, 1, 0, 0])
    base.update(kw)
    return generate(**base)


def plan(*hours):
    x = np.zeros((3, 5), dtype=int)
    for t, feeders in enumerate(hours):
        x[t, list(feeders)] = 1
    return x


CLEAN = plan([0], [2, 3], [4])


def counts(a: dict) -> tuple:
    return tuple(a["per_rule"][k]["count"] for k in ("quota", "protected", "max_consecutive", "daily_hours"))


@pytest.mark.check(id="C07", name="Audit flags each of the four rules and passes a clean plan")
def test_audit_flags_each_rule(check_detail):
    inst = audit_instance()
    clean = audit(inst, CLEAN)
    assert clean["passed"] and clean["score"] == 100.0 and clean["violations"] == [] and counts(clean) == (0, 0, 0, 0)

    quota = audit(inst, plan([0, 4], [2, 3], [4]))                 # hour 0 has 2 off, quota 1
    assert counts(quota) == (1, 0, 0, 0) and not quota["passed"]
    assert quota["violations"][0]["rule"] == "quota" and quota["violations"][0]["hour"] == 0
    assert "expected 1" in quota["violations"][0]["detail"] and "found 2" in quota["violations"][0]["detail"]

    prot = audit(inst, plan([1], [2, 3], [4]))                     # protected feeder 1 off in hour 0
    assert counts(prot) == (0, 1, 0, 0)
    assert (prot["violations"][0]["hour"], prot["violations"][0]["feeder"]) == (0, 1)

    cap = audit(inst, plan([0], [2, 3], [3]))                      # feeder 3 off in hours 1 and 2
    assert counts(cap) == (0, 0, 1, 0)
    assert (cap["violations"][0]["hour"], cap["violations"][0]["feeder"]) == (2, 3)

    daily = audit(inst, plan([2], [0, 3], [2]))                    # feeder 2: ledger 1 + 2 = 3 > 2, not adjacent
    assert counts(daily) == (0, 0, 0, 1)
    assert daily["violations"][0]["feeder"] == 2 and daily["violations"][0]["hour"] is None

    # score = 100 * passed / total ; total = 3 + 3 + 4 + 4 = 14
    assert quota["score"] == pytest.approx(100.0 * 13 / 14)
    worst = audit(inst, np.ones((3, 5), dtype=int))                # any schedule, valid or not
    assert counts(worst) == (3, 3, 4, 4) and worst["score"] == 0.0 and len(worst["violations"]) == 14
    check_detail("clean plan scores 100; each rule flagged alone (quota 1, protected 1, cap 1, daily 1); "
                 f"all-ones schedule trips {len(worst['violations'])} of 14 checks, score {worst['score']:.0f}")


def test_prev_off_counts_before_hour_zero():
    inst = audit_instance(prev_off=[1, 0, 0, 0, 0])
    a = audit(inst, CLEAN)                                          # feeder 0 off at hour 0 after being off at -1
    assert counts(a) == (0, 0, 1, 0) and (a["violations"][0]["hour"], a["violations"][0]["feeder"]) == (0, 0)
    assert audit(inst, plan([2], [0, 3], [4]))["per_rule"]["max_consecutive"]["passed"]   # prev_off, not cut at hour 0
    long = audit_instance(prev_off=[1, 0, 0, 0, 0], rules={"max_consecutive": 2, "max_daily_hours": 9})
    assert audit(long, CLEAN)["passed"]                              # run of 2 is within a cap of 2
    assert audit(long, plan([0], [0, 3], [4]))["per_rule"]["max_consecutive"]["count"] == 1   # run of 3


def test_rules_override_and_input_forms():
    inst = audit_instance()
    p = plan([0], [2, 3], [3])
    assert not audit(inst, p)["passed"]
    assert audit(inst, p, rules={"max_consecutive": 2})["per_rule"]["max_consecutive"]["passed"]
    assert audit(inst, p, rules={"max_daily_hours": 0})["per_rule"]["daily_hours"]["count"] == 3
    bits = inst.to_bits(p)
    assert audit(inst, bits) == audit(inst, p) == audit(inst, p.reshape(-1).tolist()) == audit(inst, p.tolist())


def test_metrics():
    assert approx_ratio(5.0, 5.0, 15.0) == 1.0 and approx_ratio(15.0, 5.0, 15.0) == 0.0
    assert approx_ratio(10.0, 5.0, 15.0) == pytest.approx(0.5)
    assert approx_ratio(5.0, 5.0, 15.0, feasible=False) == 0.0
    assert approx_ratio(7.0, 7.0, 7.0) == 1.0 and approx_ratio(99.0, 5.0, 15.0) == 0.0 and approx_ratio(0.0, 5.0, 15.0) == 1.0

    inst = audit_instance(ledger=[0, 0, 0, 0, 0])
    assert fairness_entropy(inst, [1, 0, 1, 1, 1]) == pytest.approx(1.0)               # perfectly even over 4 free feeders
    uneven = fairness_entropy(inst, [4, 0, 0, 0, 0])
    assert uneven == 0.0
    assert 0.0 < fairness_entropy(inst, [3, 0, 1, 0, 0]) < 1.0
    assert fairness_entropy(inst, [0, 0, 0, 0, 0]) == 1.0                              # all-zero burden
    p = np.array([2, 1, 1, 0]) / 4.0
    assert fairness_entropy(inst, [2, 0, 1, 1, 0]) == pytest.approx(-sum(v * math.log(v) for v in p if v) / math.log(4))
    assert plan_hours(inst, CLEAN) == [1.0, 0.0, 1.0, 1.0, 1.0]
    assert fairness_std(inst, CLEAN) == 0.0
    inst2 = audit_instance(ledger=[2, 0, 0, 0, 0])
    assert fairness_std(inst2, CLEAN) == pytest.approx(float(np.std([3, 1, 1, 1])))   # protected feeder excluded
