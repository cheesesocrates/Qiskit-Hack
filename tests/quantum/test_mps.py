"""MPS scaling checks (Area 1): layouts, routing, exactness at untruncated bond dimension, and a
per-run bond-dimension readout. Uses the committed scale_6x2 plans file and fixed angles."""
from __future__ import annotations

import pytest

from src.quantum import scaling
from src.quantum.scaling import ORDERINGS, Case, compile_circuit, evaluate_point, qubit_positions

THETA = [0.6, 0.35, 0.3, 0.2]       # fixed p=2 angles: gamma_0, gamma_1, beta_0, beta_1
SHOTS = 256


@pytest.fixture(scope="module")
def case():
    return Case("scale_6x2")


@pytest.mark.check(id="Q13", name="MPS qubit layouts are permutations; the paired layout puts each feeder's hours side by side; line routing leaves only nearest-neighbour gates")
def test_layouts_and_routing(case, check_detail):
    qp = case.qp
    for ordering in ORDERINGS:
        pos = qubit_positions(qp, ordering)
        assert sorted(pos) == list(range(qp.n)), ordering
    paired = qubit_positions(qp, "paired")
    for k in range(qp.n_free):
        assert abs(paired[k] - paired[qp.n_free + k]) == 1      # feeder k: hour 0 and hour 1 adjacent
    default = qubit_positions(qp, "default")
    assert all(abs(default[k] - default[qp.n_free + k]) == qp.n_free for k in range(qp.n_free))
    spans = {}
    for ordering in ORDERINGS:
        qc = compile_circuit(case, THETA, ordering, measure=True, seed=7, prep="line")
        for ins in qc.data:
            if ins.operation.name in ("measure", "barrier"):
                continue
            assert ins.operation.num_qubits <= 2
            if ins.operation.num_qubits == 2:
                a, b = (qc.find_bit(q).index for q in ins.qubits)
                assert abs(a - b) == 1, (ordering, ins.operation.name, a, b)
        spans[ordering] = qc.count_ops().get("swap", 0)
    check_detail(f"{len(ORDERINGS)} layouts on {qp.n} qubits are permutations; paired puts each feeder's hours on "
                 f"adjacent sites; after routing every 2-qubit gate is nearest-neighbour (SWAPs inserted: {spans})")


@pytest.mark.check(id="Q14", name="Untruncated MPS equals the statevector for every layout and compile path, and every sample decodes to a valid plan")
def test_untruncated_mps_is_exact(case, check_detail):
    details = []
    for ordering, prep in [(o, "aer") for o in ORDERINGS] + [("default", "line")]:
        ref = evaluate_point(case, THETA, None, SHOTS, 7, ordering, prep)
        res = evaluate_point(case, THETA, 64, SHOTS, 7, ordering, prep)
        assert res["max_bond_dim_used"] < 64                  # below the cap: no truncation
        assert res["fidelity"] > 1 - 1e-9
        # the bit order survives the layout permutation and the routing: every sample is a valid plan
        assert res["feasibility_pct"] == 100.0 and ref["feasibility_pct"] == 100.0
        se = max(res["ratio_se"] if "ratio_se" in res else 0.0, 0.02)
        assert abs(res["approx_ratio"] - ref["approx_ratio"]) < 5 * se
        details.append(f"{ordering}/{prep}: fidelity {res['fidelity']:.12f}, bond {res['max_bond_dim_used']}")
    check_detail("; ".join(details))


@pytest.mark.check(id="Q15", name="Bond dimension and fidelity are measured per run (no leak between runs in one process)")
def test_bond_readout_is_per_run(case, check_detail):
    big = evaluate_point(case, THETA, 64, SHOTS, 7, "default")
    small = evaluate_point(case, THETA, 2, SHOTS, 7, "default")      # same process, after a larger run
    assert small["max_bond_dim_used"] <= 2 < big["max_bond_dim_used"]
    assert small["fidelity"] < big["fidelity"]
    assert "reached the cap 2" in small["notes"]
    check_detail(f"chi=64 then chi=2 in one process: final bond {big['max_bond_dim_used']} then "
                 f"{small['max_bond_dim_used']}; fidelity {big['fidelity']:.4f} then {small['fidelity']:.4f}")


class _FakeWorker:
    """Stands in for the worker process: the first compile path 'crashes', the fallback runs."""

    def __init__(self, fail_preps):
        self.fail, self.calls = set(fail_preps), []

    def call(self, task, timeout):
        self.calls.append(task["prep"])
        if task["prep"] in self.fail:
            return "failed", "worker process crashed (exit code 3221225477)"
        return "ok", {"notes": "ran", "prep": task["prep"]}


@pytest.mark.check(id="Q16", name="A point whose simulator run crashes is retried once with the line-routed circuit, and the crash is recorded")
def test_crash_fallback(check_detail):
    w = _FakeWorker({scaling.PREP})
    status, res, first = scaling._attempt(w, {"id": 0}, timeout=5)
    assert status == "ok" and w.calls == [scaling.PREP, scaling.FALLBACK_PREP] and res["prep"] == scaling.FALLBACK_PREP
    assert "crashed" in first
    w2 = _FakeWorker({scaling.PREP, scaling.FALLBACK_PREP})
    status2, res2, _ = scaling._attempt(w2, {"id": 0}, timeout=5)
    assert status2 == "failed" and "crashed" in res2 and len(w2.calls) == 2      # never more than one retry
    w3 = _FakeWorker(set())
    assert scaling._attempt(w3, {"id": 0}, timeout=5)[2] is None and w3.calls == [scaling.PREP]
    check_detail(f"crash on '{scaling.PREP}' -> retried on '{scaling.FALLBACK_PREP}' and recorded; both crash -> "
                 "point failed with both reasons; no crash -> one attempt")
