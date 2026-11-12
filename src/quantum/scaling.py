"""MPS scaling curve (Area 1): approximation ratio vs bond dimension vs instance size.

Method
------
Dicke + XY-mixer QAOA with p = 2 layers (src.quantum.circuits.build_qaoa). The Grover mixer is
left out on purpose: its all-qubit multi-controlled phase is not MPS-friendly. The angles are
optimised ONCE on the smallest instances with the statevector QAOARunner and then transferred
unchanged to every larger instance (the cost layer is divided by an energy scale, so angles
carry over between sizes). Every point is ONE Aer run: bind the angles, place the qubits on the
MPS chain (`qubit_positions`), compile, save the final MPS just before the measurements, sample.
The samples are scored against the exact classical answer; the saved MPS gives the bond
dimensions and memory of THIS run, and (up to STATEVECTOR_MAX_QUBITS) the fidelity
|<exact|mps>|^2 against the statevector of the same compiled circuit.

What was wrong before (evidence: docs/MPS_DIAGNOSTICS.md, from src/quantum/mps_probe.py)
------------------------------------------------------------------------------------------
* The notes' "peak bond dimension" came from mps_log_data, a log Aer keeps for the whole
  process, so later points reported earlier points' bond dimensions (e.g. "peak 64" at chi=2).
  Now: save_matrix_product_state of the run itself.
* Aer 0.18.2 on Windows crashes (access violation, heap corruption, fast-fail) or hangs on some
  circuits at very small bond dimensions (2 and 4). It is circuit-specific: in every case the
  probe found, the other compile path ran. So each point is first compiled for the Aer MPS target
  (PREP, Aer moves distant qubits itself); if the worker crashes, errors or times out, the point
  is retried once with the circuit routed to a line (FALLBACK_PREP: only nearest-neighbour gates
  reach Aer), and the note says so. A larger truncation threshold and mps_lapack=True did not
  remove the crashes (mps_lapack even fails at chi=64), so neither is used.
* Qubit layout: an MPS pays for entanglement across each cut of its chain, and every cost
  coupling links feeder k in hour t with feeder k in hour t+1. Putting the same feeder's hours
  side by side ("paired", "interleaved") makes those couplings nearest-neighbour, but the probe
  measured no meaningful gain over the original "default" layout (fidelity within a few percent
  at chi=64), so the stage keeps the default layout. The others stay available (--ordering).

Simulator options (checked against the installed qiskit-aer 0.18.2)
-------------------------------------------------------------------
method="matrix_product_state", matrix_product_state_max_bond_dimension=<chi>,
matrix_product_state_truncation_threshold=1e-16 (Aer default), mps_swap_direction="mps_swap_right".
max_memory_mb is raised because Aer's MPS memory estimate is far too high (see MPS_MAX_MEMORY_MB).

Isolation
---------
Points run in a persistent worker process (`python -m src.quantum.scaling --worker`). A crash
inside Aer or a point that exceeds the time budget then costs one attempt, not the whole run.
Nothing is invented: a point that did not run has no numbers.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.transpiler import CouplingMap
from qiskit_aer import AerSimulator

from src.quantum.circuits import build_qaoa
from src.quantum.io import ROOT, load_scenario, write_result
from src.quantum.problem import QProblem
from src.quantum.qaoa import QAOARunner, exact_state_metrics

LAYERS = 2
DEFAULT_SCENARIOS = ("scale_6x2", "scale_8x2", "scale_10x2", "scale_12x2", "scale_16x2", "scale_20x2",
                     "scale_20x3", "scale_20x4")
DEFAULT_BOND_DIMS = (2, 4, 8, 16, 32, 64)
STATEVECTOR_MAX_QUBITS = 20     # dense reference only up to here (2^20 amplitudes)
TRAIN_MAX_QUBITS = 12           # angles are optimised on instances up to this size
MPS_TRUNCATION = 1e-16          # Aer default, set explicitly so it is documented
MPS_SWAP = "mps_swap_right"     # irrelevant after line routing (Aer never swaps), kept explicit
GROWTH = 2.5                    # assumed run-time growth per doubling of chi when pre-checking the budget
COST_TOL = 1e-6
ORDERINGS = ("default", "paired", "interleaved")
LAYOUT = "default"              # qubit layout of the curve (see the docstring: no layout beat it)
PREPS = ("aer", "line", "basis2q")
PREP = "aer"                    # first attempt: compile for the Aer MPS target
FALLBACK_PREP = "line"          # retry after a crash, error or time-out: route to a line first
BASIS_2Q = ("u", "cx", "rzz", "rxx", "ryy")
LAYOUT_LABELS = {"default": "hour blocks one after the other",
                 "paired": "each feeder's hours side by side",
                 "interleaved": "each feeder's hours side by side, ring folded"}
# The Aer MPS gate set (from the installed simulator's target, minus non-gate instructions). Used
# as basis_gates instead of the target itself, because the target caps circuits at 63 qubits.
_NON_GATES = {"measure", "reset", "delay", "barrier", "break_loop", "continue_loop", "for_loop", "if_else",
              "while_loop", "switch_case", "initialize", "kraus", "qerror_loc", "quantum_channel", "roerror",
              "store", "superop", "unitary", "diagonal", "pauli"}   # last three: not standard gate names
AER_MPS_GATES = tuple(sorted(g for g in AerSimulator(method="matrix_product_state").target.operation_names
                             if g not in _NON_GATES and not g.startswith(("save_", "set_"))))
PREP_LABELS = {"aer": "compiled for the Aer MPS target", "line": "routed to a line (nearest-neighbour gates only)",
               "basis2q": "decomposed to 1- and 2-qubit gates"}
# Aer's pre-run memory check for the MPS method assumes far more memory than the run uses
# (28 qubits: "required 57345M" on a 32 GB machine, yet the run completes in about 1 s at chi=32).
# The real footprint is bounded by n * chi^2 amplitudes (and is measured per point, mps_memory_mb),
# so the check is raised; each point still runs in an isolated worker with a time limit.
MPS_MAX_MEMORY_MB = 1 << 22
TMP = ROOT / "results" / "tmp"


# ---------------------------------------------------------------------------------------------
# one instance
# ---------------------------------------------------------------------------------------------
class Case:
    """A scenario file loaded for the quantum side, with its parametrised QAOA circuit."""

    def __init__(self, name: str):
        sc = load_scenario(name)
        self.name = name
        self.qp = QProblem(sc["instance"])
        self.exact = {"cost_min": float(sc["exact"]["cost_min"]), "cost_max": float(sc["exact"]["cost_max"]),
                      "method": sc["exact"].get("method")}
        self.built = build_qaoa(self.qp, "xy", LAYERS)
        self.params = list(self.built["gammas"]) + list(self.built["betas"])
        self._compiled: dict = {}
        self._sv: dict = {}


def qubit_positions(qp: QProblem, ordering: str = "default") -> list:
    """positions[c] = physical qubit (MPS site) that carries compact qubit c = t*n_free + k.

    default      the compact order: hour blocks one after the other. Every cost coupling
                 (feeder k in hour t with feeder k in hour t+1) is n_free sites long and crosses
                 the middle of the chain.
    paired       feeder-major, hour-minor: site k*T + t. The same feeder's hours are neighbours, so
                 every cost coupling is nearest-neighbour; the Dicke preparation stays local
                 (block neighbours are T sites apart); the XY ring wrap edge spans the chain.
    interleaved  paired, with each block's ring folded (0, n-1, 1, n-2, ...) so ring edges are at
                 most 2T sites apart; the Dicke preparation becomes less local.
    """
    if ordering == "default":
        return list(range(qp.n))
    k, T = qp.n_free, qp.T
    if ordering == "paired":
        return [(c % k) * T + c // k for c in range(qp.n)]
    if ordering != "interleaved":
        raise ValueError(f"ordering must be one of {ORDERINGS}")
    fold, lo, hi = [], 0, k - 1
    while lo <= hi:
        fold.append(lo)
        lo += 1
        if lo <= hi:
            fold.append(hi)
            hi -= 1
    slot = {j: i for i, j in enumerate(fold)}
    return [slot[c % k] * T + c // k for c in range(qp.n)]


def placed_circuit(case: Case, theta, ordering: str, measure: bool) -> QuantumCircuit:
    """Angles bound, compact qubit c placed on site positions[c]. With `measure`, qubit c is
    measured into classical bit c, so count keys keep the compact little-endian order whatever
    the layout (and whatever the routing does later: measurements follow the qubits)."""
    bound = case.built["circuit"].assign_parameters(dict(zip(case.params, [float(v) for v in theta])))
    n = case.qp.n
    pos = qubit_positions(case.qp, ordering)
    qc = QuantumCircuit(n, n if measure else 0)
    qc.compose(bound, qubits=pos, inplace=True)
    if measure:
        for c in range(n):
            qc.measure(pos[c], c)
    return qc


def compile_circuit(case: Case, theta, ordering: str, measure: bool, seed: int, prep: str = PREP) -> QuantumCircuit:
    """line     1- and 2-qubit gates, routed to a line: Aer only sees nearest-neighbour gates.
    basis2q  1- and 2-qubit gates; Aer moves distant qubits itself.
    aer      transpiled to the Aer MPS gate set (as in session 2, without the target's 63-qubit cap)."""
    qc = placed_circuit(case, theta, ordering, measure)
    n = case.qp.n
    if prep == "line":
        return transpile(qc, basis_gates=list(BASIS_2Q), coupling_map=CouplingMap.from_line(n),
                         initial_layout=list(range(n)), optimization_level=1, seed_transpiler=int(seed))
    if prep == "basis2q":
        return transpile(qc, basis_gates=list(BASIS_2Q), optimization_level=1, seed_transpiler=int(seed))
    if prep == "aer":
        return transpile(qc, basis_gates=list(AER_MPS_GATES), optimization_level=1, seed_transpiler=int(seed))
    raise ValueError(f"prep must be one of {PREPS}")


def _compiled(case: Case, theta, ordering: str, seed: int, prep: str) -> QuantumCircuit:
    """Measured circuit, compiled once per (angles, layout, seed, prep) in this worker."""
    key = (tuple(float(v) for v in theta), ordering, int(seed), prep)
    if key not in case._compiled:
        case._compiled[key] = compile_circuit(case, theta, ordering, True, seed, prep)
    return case._compiled[key]


def _split_at_measure(meas: QuantumCircuit) -> tuple:
    """(instructions before the first measurement, the rest) of a compiled measured circuit."""
    first = next(i for i, ins in enumerate(meas.data) if ins.operation.name == "measure")
    return meas.data[:first], meas.data[first:]


def with_mps_save(meas: QuantumCircuit) -> QuantumCircuit:
    """The compiled circuit with save_matrix_product_state just before the measurements, so one
    Aer run gives both the samples (Aer still samples all shots from one final state) and the MPS."""
    gates, measures = _split_at_measure(meas)
    out = meas.copy_empty_like()
    for ins in gates:
        out.append(ins)
    out.save_matrix_product_state(label="mps")
    for ins in measures:
        out.append(ins)
    return out


def mps_simulator(bond_dim: int, **extra) -> AerSimulator:
    opts = dict(method="matrix_product_state", matrix_product_state_max_bond_dimension=int(bond_dim),
                matrix_product_state_truncation_threshold=MPS_TRUNCATION, mps_swap_direction=MPS_SWAP,
                max_memory_mb=MPS_MAX_MEMORY_MB)
    opts.update(extra)
    return AerSimulator(**opts)


def _peak_bond_dim(result) -> int | None:
    """Largest bond dimension in Aer's MPS log (mps_log_data=True). Diagnostic only: Aer keeps
    this log process-wide, so in a process that already ran other circuits it includes their
    bond dimensions too (see mps_probe, test H2). The stage uses save_matrix_product_state."""
    try:
        log = result.results[0].metadata["MPS_log_data"]
        vals = [max(int(x) for x in m.split()) for m in re.findall(r"BD=\[([\d ]+)\]", str(log))]
        return max(vals) if vals else None
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------
# MPS helpers. Aer's saved format (checked against its statevector): data["mps"] =
# (gammas, lambdas), gammas[i] = (G_i^0, G_i^1), psi(s) = G_0^{s0} L_0 G_1^{s1} L_1 ... (little-endian)
# ---------------------------------------------------------------------------------------------
def mps_bonds(mps) -> list:
    return [len(l) for l in mps[1]]


def mps_memory_mb(mps) -> float:
    """Memory of the saved MPS tensors (complex128) and Schmidt values (float64), in MB."""
    amps = sum(np.asarray(g[s]).size for g in mps[0] for s in (0, 1))
    return (amps * 16 + sum(mps_bonds(mps)) * 8) / 2 ** 20


def mps_overlap(m1, m2) -> complex:
    """<m1|m2> for two MPS on the same qubits in the same order, O(n chi^3)."""
    g1, l1 = m1
    g2, l2 = m2
    env = np.ones((1, 1), dtype=complex)
    for i in range(len(g1)):
        a = [np.asarray(g1[i][s]) for s in (0, 1)]
        b = [np.asarray(g2[i][s]) for s in (0, 1)]
        if i < len(g1) - 1:
            a = [x * np.asarray(l1[i])[None, :] for x in a]
            b = [x * np.asarray(l2[i])[None, :] for x in b]
        env = a[0].conj().T @ env @ b[0] + a[1].conj().T @ env @ b[1]
    return complex(env[0, 0])


def score_counts(case: Case, counts: dict) -> dict:
    """Per-sample validity and cost from the bits (no dense tables), aggregated over all shots."""
    qp, ex = case.qp, case.exact
    shots = sum(counts.values())
    n_valid, best, total, total_sq = 0, None, 0.0, 0.0
    for key, cnt in counts.items():
        bits = qp.key_to_bits(key)
        ok = qp.is_valid_bits(bits)
        cost = qp.cost_of_bits(bits)
        if ok:
            if cost < ex["cost_min"] - COST_TOL * max(1.0, abs(ex["cost_min"])) or \
                    cost > ex["cost_max"] + COST_TOL * max(1.0, abs(ex["cost_max"])):
                raise RuntimeError(f"valid sample cost {cost:.6f} outside the exact range "
                                   f"[{ex['cost_min']:.6f}, {ex['cost_max']:.6f}]")
            n_valid += cnt
            best = cost if best is None else min(best, cost)
        r = qp.approx_ratio(cost, ex["cost_min"], ex["cost_max"], ok)
        total += cnt * r
        total_sq += cnt * r * r
    mean = total / shots
    var = max(total_sq / shots - mean * mean, 0.0)
    return {"approx_ratio": float(mean), "ratio_se": float(np.sqrt(var / shots)),
            "feasibility_pct": 100.0 * n_valid / shots, "n_valid": int(n_valid), "shots": int(shots),
            "best_sampled_cost": None if best is None else float(best)}


def _exact_statevector(case: Case, theta, ordering: str, seed: int, prep: str) -> np.ndarray:
    """Statevector of the same compiled circuit (before its measurements), cached per worker."""
    key = (tuple(float(v) for v in theta), ordering, int(seed), prep)
    if key not in case._sv:
        meas = _compiled(case, theta, ordering, seed, prep)
        gates, _rest = _split_at_measure(meas)
        st = meas.copy_empty_like()
        for ins in gates:
            st.append(ins)
        st.save_statevector(label="sv")
        case._sv[key] = np.asarray(AerSimulator(method="statevector").run(st, shots=1).result().data()["sv"])
    return case._sv[key]


def evaluate_point(case: Case, theta, bond_dim, shots: int, seed: int, ordering: str = LAYOUT,
                   prep: str = PREP) -> dict:
    """One curve point in one Aer run. bond_dim None = untruncated Aer statevector reference."""
    t0 = time.perf_counter()
    n = case.qp.n
    meas = _compiled(case, theta, ordering, seed, prep)
    if bond_dim is None:
        result = AerSimulator(method="statevector").run(meas, shots=int(shots), seed_simulator=int(seed)).result()
    else:
        result = mps_simulator(bond_dim).run(with_mps_save(meas), shots=int(shots), seed_simulator=int(seed)).result()
    if not result.success:
        raise RuntimeError(f"Aer returned status {result.status}")
    stats = score_counts(case, dict(result.get_counts()))
    note = (f"{stats['n_valid']} of {stats['shots']} samples valid; "
            f"shot standard error of the ratio {stats['ratio_se']:.3f}")
    if bond_dim is None:
        stats.update(fidelity=1.0, max_bond_dim_used=None, mps_memory_mb=None)
        note += (f"; untruncated statevector reference ({(2 ** n) * 16 / 2 ** 20:.1f} MB of amplitudes), "
                 "same angles and shots")
    else:
        mps = result.data()["mps"]
        bonds = mps_bonds(mps)
        peak = max(bonds) if bonds else 1
        stats["max_bond_dim_used"] = int(peak)
        stats["mps_memory_mb"] = float(mps_memory_mb(mps))
        fid = None
        if n <= STATEVECTOR_MAX_QUBITS:
            exact = _exact_statevector(case, theta, ordering, seed, prep)
            fid = min(max(float(abs(np.vdot(exact, _mps_to_statevector(mps))) ** 2), 0.0), 1.0)
            note += f"; fidelity against the statevector of the same circuit {fid:.4f}"
        else:
            note += "; fidelity not measured (no exact state at this size)"
        stats["fidelity"] = fid
        if peak < bond_dim:
            note += (f"; final bond dimension {peak} is below the cap {bond_dim} (earlier steps may still have "
                     f"been truncated; the fidelity shows the total effect where it is measured)")
        else:
            note += f"; final bond dimension reached the cap {bond_dim}, so the state was truncated"
        note += f"; MPS memory {stats['mps_memory_mb']:.3f} MB"
    stats["runtime_s"] = float(time.perf_counter() - t0)
    stats["notes"] = note
    return stats


def _mps_to_statevector(mps) -> np.ndarray:
    """Dense little-endian statevector from Aer's saved MPS (small n only)."""
    gammas, lams = mps
    vec = None
    for i in range(len(gammas)):
        g = np.stack([np.asarray(gammas[i][0]), np.asarray(gammas[i][1])])
        if i < len(gammas) - 1:
            g = g * np.asarray(lams[i])[None, None, :]
        vec = g[:, 0, :] if vec is None else np.einsum("al,slr->sar", vec, g).reshape(-1, g.shape[2])
    return vec[:, 0]


# ---------------------------------------------------------------------------------------------
# angles: optimise once on the smallest instances, transfer everywhere
# ---------------------------------------------------------------------------------------------
def train_angles(cases: list, seed: int) -> tuple:
    """Return (theta, parameter_source). `cases` sorted by qubit count (smallest first)."""
    if cases[0].qp.n > STATEVECTOR_MAX_QUBITS:
        raise ValueError("the smallest scenario is too big for the statevector optimiser")
    train = cases[:2] if len(cases) > 1 and cases[1].qp.n <= TRAIN_MAX_QUBITS else cases[:1]
    runners, found = {}, {}
    for case in train:
        ref = case.qp.reference()
        if abs(ref["cost_min"] - case.exact["cost_min"]) > 1e-6 or abs(ref["cost_max"] - case.exact["cost_max"]) > 1e-6:
            raise ValueError(f"{case.name}: quantum-side enumeration disagrees with the exact reference in the file")
        runners[case.name] = QAOARunner(case.qp, "xy", LAYERS, seed=seed)
        found[case.name] = runners[case.name].optimize()["theta"]
    scores = {}
    for src, theta in found.items():
        vals = [exact_state_metrics(c.qp, runners[c.name].probabilities(theta), c.exact)["approx_ratio"] for c in train]
        scores[src] = float(np.mean(vals))
    best = max(scores, key=lambda s: (scores[s], -list(found).index(s)))
    theta = [float(v) for v in found[best]]
    names = " and ".join(f"{c.name} ({c.qp.n} qubits)" for c in train)
    cand = "; ".join(f"candidate optimised on {s}: mean exact approximation ratio {scores[s]:.3f}" for s in found)
    source = (f"COBYLA from a small grid of linear-ramp starts (src.quantum.qaoa.QAOARunner.optimize) on the Aer "
              f"statevector simulator, run on {names}. {cand}. Kept the candidate from {best}. "
              f"The p={LAYERS} angles gamma={[round(v, 4) for v in theta[:LAYERS]]}, beta={[round(v, 4) for v in theta[LAYERS:]]} "
              f"were then fixed and transferred unchanged to every instance, layout and bond dimension; there is no "
              f"re-optimisation at larger sizes, so ratios on larger instances include transfer loss. "
              f"The training instances are in-sample for the angles.")
    return theta, source


# ---------------------------------------------------------------------------------------------
# worker process
# ---------------------------------------------------------------------------------------------
def _worker_loop() -> None:
    out = sys.stdout
    sys.stdout = sys.stderr          # stray prints must not corrupt the JSON-lines channel
    cases: dict = {}

    def send(msg: dict) -> None:
        out.write(json.dumps(msg) + "\n")
        out.flush()

    send({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        task = json.loads(line)
        try:
            if task["scenario"] not in cases:
                cases[task["scenario"]] = Case(task["scenario"])
            res = evaluate_point(cases[task["scenario"]], task["theta"], task["bond_dim"], task["shots"],
                                 task["seed"], task.get("ordering", LAYOUT), task.get("prep", PREP))
            send({"id": task["id"], "ok": True, "result": res})
        except Exception as exc:     # a Python-level failure is reported, a crash is caught by the parent
            send({"id": task["id"], "ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]})


class _Worker:
    """Persistent child process with a JSON-lines protocol, hard time-outs and crash detection."""

    def __init__(self):
        self.proc = None
        self.lines: queue.Queue = queue.Queue()
        self.err: deque = deque(maxlen=12)

    def _start(self, timeout: float = 180.0) -> None:
        env = dict(os.environ, PYTHONPATH=str(ROOT), PYTHONIOENCODING="utf-8")
        self.lines = queue.Queue()
        self.err = deque(maxlen=12)
        self.proc = subprocess.Popen([sys.executable, "-X", "faulthandler", "-m", "src.quantum.scaling", "--worker"],
                                     cwd=str(ROOT), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        threading.Thread(target=self._pump, args=(self.proc.stdout, self.lines), daemon=True).start()
        threading.Thread(target=self._drain, args=(self.proc.stderr, self.err), daemon=True).start()
        first = self.lines.get(timeout=timeout)
        if first is None or not json.loads(first).get("ready"):
            raise RuntimeError("worker did not start: " + " | ".join(self.err))

    @staticmethod
    def _pump(stream, q) -> None:
        for line in stream:
            q.put(line)
        q.put(None)

    @staticmethod
    def _drain(stream, sink) -> None:
        for line in stream:
            if line.strip():
                sink.append(line.strip()[:200])

    def call(self, task: dict, timeout: float) -> tuple:
        """('ok', result) | ('failed', text) | ('timeout', text)."""
        try:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            self.proc.stdin.write(json.dumps(task) + "\n")
            self.proc.stdin.flush()
            line = self.lines.get(timeout=max(timeout, 0.1))
        except queue.Empty:
            self.kill()
            return "timeout", f"no answer within {timeout:.0f} s; worker stopped"
        except Exception as exc:
            self.kill()
            return "failed", f"worker error: {type(exc).__name__}: {exc}"[:400]
        if line is None:
            code = self.proc.wait(timeout=10)
            tail = " | ".join(list(self.err)[:3])
            self.proc = None
            return "failed", f"worker process crashed (exit code {code}): {tail}"[:500]
        msg = json.loads(line)
        if msg.get("ok"):
            return "ok", msg["result"]
        return "failed", msg.get("error", "unknown error")

    def kill(self) -> None:
        if self.proc is not None:
            try:
                self.proc.kill()
                self.proc.wait(timeout=10)
            except Exception:
                pass
        self.proc = None

    def close(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=10)
            except Exception:
                self.kill()
        self.proc = None


# ---------------------------------------------------------------------------------------------
# the stage
# ---------------------------------------------------------------------------------------------
POINT_KEYS = ("approx_ratio", "feasibility_pct", "best_sampled_cost", "runtime_s", "fidelity",
              "max_bond_dim_used", "mps_memory_mb")


def _empty_point(case: Case, bond_dim, status: str, note: str) -> dict:
    return {"n_feeders": case.qp.N, "n_hours": case.qp.T, "n_qubits": case.qp.n, "bond_dim": bond_dim,
            "simulator": "statevector" if bond_dim is None else "matrix_product_state",
            "approx_ratio": None, "feasibility_pct": None, "exact_cost_min": case.exact["cost_min"],
            "exact_cost_max": case.exact["cost_max"], "exact_method": case.exact["method"],
            "best_sampled_cost": None, "runtime_s": None, "status": status, "notes": note,
            "fidelity": None, "max_bond_dim_used": None, "mps_memory_mb": None}


def _attempt(worker: _Worker, task: dict, timeout: float) -> tuple:
    """Run a point with PREP; on a crash, error or time-out retry once with FALLBACK_PREP.
    Returns (status, result_or_reason, first_failure_or_None)."""
    status, res = worker.call(dict(task, prep=PREP), timeout=timeout)
    if status == "ok":
        return status, res, None
    first = f"{status} with the circuit {PREP_LABELS[PREP]} ({str(res)[:200]})"
    status2, res2 = worker.call(dict(task, prep=FALLBACK_PREP), timeout=timeout)
    if status2 == "ok":
        return status2, res2, first
    return status2, f"{first}; then {status2} with the circuit {PREP_LABELS[FALLBACK_PREP]} ({str(res2)[:200]})", first


def _curve(worker: _Worker, cases: list, theta: list, ordering: str, bond_dims: tuple, shots: int, seed: int,
           point_timeout: float, budget: float) -> list:
    """Every (instance, bond dimension) point for one layout."""
    t_start, points = time.perf_counter(), []
    for case in cases:
        last_runtime = None
        dims = ([None] if case.qp.n <= STATEVECTOR_MAX_QUBITS else []) + list(bond_dims)
        for chi in dims:
            remaining = budget - (time.perf_counter() - t_start)
            limit = min(point_timeout, remaining)
            if limit < 5:
                points.append(_empty_point(case, chi, "skipped", f"skipped: the {budget:.0f} s budget is used up"))
                continue
            if chi is not None and last_runtime is not None and last_runtime * GROWTH > limit:
                points.append(_empty_point(case, chi, "skipped",
                                           f"skipped: the previous bond dimension took {last_runtime:.1f} s, so this "
                                           f"one is predicted to exceed the {limit:.0f} s limit"))
                continue
            task = {"id": len(points), "scenario": case.name, "theta": theta, "bond_dim": chi,
                    "shots": shots, "seed": seed, "ordering": ordering}
            status, res, first = _attempt(worker, task, limit)
            if status == "ok":
                note = res["notes"]
                if first:
                    note += f"; first attempt: {first}; this point used the circuit {PREP_LABELS[FALLBACK_PREP]}"
                pt = _empty_point(case, chi, "ok", note)
                for k in POINT_KEYS:
                    pt[k] = res.get(k)
                pt["approx_ratio"] = min(max(pt["approx_ratio"], 0.0), 1.0)
                points.append(pt)
                if chi is not None:
                    last_runtime = res["runtime_s"]
            else:
                points.append(_empty_point(case, chi, "failed" if status == "failed" else "skipped", f"{status}: {res}"))
                last_runtime = None      # a failed point says nothing about the next chi: try it
            p = points[-1]
            tag = " (fallback)" if first and p["status"] == "ok" else ""
            print(f"  scaling {case.name} ({case.qp.n} q) chi={chi}: {p['status']}{tag} "
                  f"ratio={p['approx_ratio']} valid={p['feasibility_pct']} fid={p['fidelity']} "
                  f"bond={p['max_bond_dim_used']} mem={p['mps_memory_mb']} t={p['runtime_s']}", flush=True)
    return points


def _method(ordering: str) -> str:
    return (f"Dicke + XY-mixer QAOA, p={LAYERS}, Aer matrix_product_state simulator ({ordering} qubit layout: "
            f"{LAYOUT_LABELS[ordering]})")


def run_scaling(seed: int = 7, scenarios: tuple = DEFAULT_SCENARIOS, bond_dims: tuple = DEFAULT_BOND_DIMS,
                shots: int = 512, point_timeout: float = 120.0, total_budget: float = 1200.0,
                ordering: str = LAYOUT) -> Path:
    """Write results/scaling.json. Every point is either measured ('ok') or says why it has no numbers."""
    if ordering not in ORDERINGS:
        raise ValueError(f"ordering must be one of {ORDERINGS}")
    cases = sorted((Case(name) for name in scenarios), key=lambda c: c.qp.n)
    theta, source = train_angles(cases, seed)
    worker = _Worker()
    try:
        points = _curve(worker, cases, theta, ordering, bond_dims, shots, seed, point_timeout, total_budget)
    finally:
        worker.close()
    if not any(p["status"] == "ok" for p in points):
        raise RuntimeError("no scaling point ran successfully")
    n_fallback = sum(1 for p in points if p["status"] == "ok" and "first attempt" in p["notes"])
    notes = (f"approx_ratio is the mean over {shots} shots with invalid samples scored 0, against the exact "
             "classical optimum in each plans file (brute force up to 20 qubits, MILP above). bond_dim null is "
             "the untruncated statevector reference (only up to 20 qubits). fidelity is |<exact|mps>|^2 of the "
             "final state against the statevector of the same compiled circuit (up to 20 qubits; null above). "
             "max_bond_dim_used and mps_memory_mb are read from the final MPS of each run "
             "(save_matrix_product_state). Aer 0.18.2 on Windows crashes or hangs on some circuits at bond "
             f"dimension 2 or 4; such a point is retried once with the circuit {PREP_LABELS[FALLBACK_PREP]} "
             f"({n_fallback} point(s) in this file needed it; see their notes). Per-point limit "
             f"{point_timeout:.0f} s, total budget {total_budget:.0f} s; points that did not run carry no numbers. "
             "Simulator only: this curve shows how far a truncated classical simulation of the circuit can go, "
             "not a quantum advantage.")
    payload = {"method": _method(ordering), "layers": LAYERS, "shots": shots, "parameter_source": source,
               "points": points, "notes": notes, "layout": ordering}
    return write_result("scaling.json", payload, seed, "src/quantum/scaling.py")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="MPS scaling stage (Area 1)")
    ap.add_argument("--worker", action="store_true", help="internal: run as the point-evaluation worker")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--ordering", default=LAYOUT, choices=ORDERINGS, help="qubit layout on the MPS chain")
    ap.add_argument("--scenarios", default=",".join(DEFAULT_SCENARIOS))
    ap.add_argument("--bond-dims", default=",".join(map(str, DEFAULT_BOND_DIMS)))
    ap.add_argument("--budget", type=float, default=1200.0, help="total seconds for the curve")
    args = ap.parse_args()
    if args.worker:
        _worker_loop()
    else:
        print(run_scaling(args.seed, tuple(args.scenarios.split(",")),
                          tuple(int(c) for c in args.bond_dims.split(",")), total_budget=args.budget,
                          ordering=args.ordering))
