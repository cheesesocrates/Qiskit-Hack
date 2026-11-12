"""MPS scaling curve (Area 1): approximation ratio vs bond dimension vs number of feeders.

Method
------
Dicke + XY-mixer QAOA with p = 2 layers (src.quantum.circuits.build_qaoa). The Grover mixer is
left out on purpose: its all-qubit multi-controlled phase is not MPS-friendly. The angles are
optimised ONCE on the smallest instances with the statevector QAOARunner and then transferred
unchanged to every larger instance (the cost layer is divided by an energy scale, so angles
carry over between sizes). Every point is a fresh Aer run: bind the angles, add measurements,
transpile for the simulator, sample, score each sample against the exact classical answer.

Simulator options (checked against the installed qiskit-aer 0.18.2)
-------------------------------------------------------------------
method="matrix_product_state", matrix_product_state_max_bond_dimension=<chi>,
matrix_product_state_truncation_threshold (left at its default 1e-16),
mps_swap_direction="mps_swap_right", mps_log_data=True (peak bond dimension, for the notes).
mps_swap_direction is set because Aer's default ("mps_swap_left") kills the Python process with
an access violation on this Windows install for 16 or more qubits.

Isolation
---------
Points run in a persistent worker process (`python -m src.quantum.scaling --worker`). A crash
inside Aer or a point that exceeds the time budget then costs one point (status "failed" or
"skipped"), not the whole run. Nothing is invented: a point that did not run has no numbers.
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
from qiskit_aer import AerSimulator

from src.quantum.circuits import build_qaoa
from src.quantum.io import ROOT, load_scenario, write_result
from src.quantum.problem import QProblem
from src.quantum.qaoa import QAOARunner, exact_state_metrics

LAYERS = 2
DEFAULT_SCENARIOS = ("scale_6x2", "scale_8x2", "scale_10x2", "scale_12x2", "scale_16x2", "scale_20x2")
DEFAULT_BOND_DIMS = (2, 4, 8, 16, 32, 64)
STATEVECTOR_MAX_QUBITS = 20     # dense reference only up to here (2^20 amplitudes)
TRAIN_MAX_QUBITS = 12           # angles are optimised on instances up to this size
MPS_TRUNCATION = 1e-16          # Aer default, set explicitly so it is documented
MPS_SWAP = "mps_swap_right"
GROWTH = 2.5                    # assumed run-time growth per doubling of chi when pre-checking the budget
COST_TOL = 1e-6
ORDERINGS = ("default", "interleaved")


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


def qubit_positions(qp: QProblem, ordering: str = "default") -> list:
    """positions[c] = physical qubit that carries compact qubit c.

    default      the compact order c = t*n_free + k.
    interleaved  the same feeder in every hour sits on neighbouring sites, and each block's XY ring
                 is folded (0, n-1, 1, n-2, ...) so ring edges are at most two sites apart.
    """
    if ordering == "default":
        return list(range(qp.n))
    if ordering != "interleaved":
        raise ValueError(f"ordering must be one of {ORDERINGS}")
    k, T = qp.n_free, qp.T
    fold, lo, hi = [], 0, k - 1
    while lo <= hi:
        fold.append(lo)
        lo += 1
        if lo <= hi:
            fold.append(hi)
            hi -= 1
    slot = {j: i for i, j in enumerate(fold)}
    return [slot[c % k] * T + c // k for c in range(qp.n)]


def measured_circuit(case: Case, theta, positions: list) -> QuantumCircuit:
    """Angles bound, compact qubit c placed on physical qubit positions[c] and measured into
    classical bit c, so count keys keep the compact little-endian order whatever the layout."""
    bound = case.built["circuit"].assign_parameters(dict(zip(case.params, [float(v) for v in theta])))
    n = case.qp.n
    phys = QuantumCircuit(n, n)
    phys.compose(bound, qubits=positions, inplace=True)
    for c in range(n):
        phys.measure(positions[c], c)
    return phys


def mps_simulator(bond_dim: int) -> AerSimulator:
    return AerSimulator(method="matrix_product_state",
                        matrix_product_state_max_bond_dimension=int(bond_dim),
                        matrix_product_state_truncation_threshold=MPS_TRUNCATION,
                        mps_swap_direction=MPS_SWAP, mps_log_data=True)


def _peak_bond_dim(result) -> int | None:
    """Largest bond dimension that appeared at any step (parsed from Aer's MPS log)."""
    try:
        log = result.results[0].metadata["MPS_log_data"]
        vals = [max(int(x) for x in m.split()) for m in re.findall(r"BD=\[([\d ]+)\]", str(log))]
        return max(vals) if vals else None
    except Exception:
        return None


def score_counts(case: Case, counts: dict) -> dict:
    """Per-sample validity and cost from the bits (no dense tables), aggregated over all shots."""
    qp, ex = case.qp, case.exact
    shots = sum(counts.values())
    span = ex["cost_max"] - ex["cost_min"]
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


def evaluate_point(case: Case, theta, bond_dim, shots: int, seed: int, ordering: str = "default") -> dict:
    """One curve point. bond_dim None = untruncated Aer statevector reference."""
    t0 = time.perf_counter()
    circ = measured_circuit(case, theta, qubit_positions(case.qp, ordering))
    sim = AerSimulator(method="statevector") if bond_dim is None else mps_simulator(bond_dim)
    tc = transpile(circ, sim, optimization_level=1, seed_transpiler=int(seed))
    result = sim.run(tc, shots=int(shots), seed_simulator=int(seed)).result()
    runtime = time.perf_counter() - t0
    if not result.success:
        raise RuntimeError(f"Aer returned status {result.status}")
    stats = score_counts(case, dict(result.get_counts()))
    note = (f"{stats['n_valid']} of {stats['shots']} samples valid; "
            f"shot standard error of the ratio {stats['ratio_se']:.3f}")
    if bond_dim is None:
        note += "; untruncated statevector reference, same angles and shots"
    else:
        peak = _peak_bond_dim(result)
        if peak is None:
            note += "; peak bond dimension not available"
        elif peak < bond_dim:
            note += f"; peak bond dimension {peak} is below the cap {bond_dim}, so nothing was truncated beyond 1e-16"
        else:
            note += f"; peak bond dimension {peak} reached the cap, so the state was truncated"
    stats["runtime_s"] = float(runtime)
    stats["notes"] = note
    return stats


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
              f"were then fixed and transferred unchanged to every instance and bond dimension; there is no "
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
                                 task["seed"], task.get("ordering", "default"))
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
