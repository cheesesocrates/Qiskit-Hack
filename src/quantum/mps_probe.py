"""MPS probe (Area 1): find out what breaks the MPS scaling stage, one factor at a time.

Every configuration runs in a FRESH Python process with a time limit, so a crash inside Aer
costs one row and is recorded with its exit code. Nothing is invented: a row that did not run
has no numbers.

  python -m src.quantum.mps_probe --phase crash      # crash hypotheses (H2, H3)
  python -m src.quantum.mps_probe --phase layouts    # layout x bond dimension: ratio, validity, fidelity
  python -m src.quantum.mps_probe --phase required   # bond dimension each layout actually needs
  python -m src.quantum.mps_probe --phase options    # mps_lapack x truncation threshold x compile path on crash cases
  python -m src.quantum.mps_probe --report           # docs/MPS_DIAGNOSTICS.md from results/tmp/mps_probe.json
  python -m src.quantum.mps_probe --one '<json>'     # internal: one configuration, one JSON line out

Measurements per configuration
------------------------------
* exit code, error, wall time (sampling and state runs separately);
* gates after transpile: 3-qubit gates left, longest 2-qubit gate (in MPS sites);
* approximation ratio and share of valid samples (src.quantum.scaling.score_counts);
* final bond dimensions and MPS memory, from Aer's save_matrix_product_state;
* fidelity |<exact|mps>|^2 of the final state: against Aer's statevector of the SAME transpiled
  circuit (up to SV_MAX qubits), above that against an untruncated MPS of the same circuit.
"""
from __future__ import annotations

import argparse
import json
import pickle
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

from src.quantum.io import ROOT
from src.quantum.scaling import (MPS_MAX_MEMORY_MB, Case, _peak_bond_dim, compile_circuit, mps_bonds,
                                 mps_memory_mb, mps_overlap, score_counts, train_angles)

TMP = ROOT / "results" / "tmp"
OUT = TMP / "mps_probe.json"
THETA_CACHE = TMP / "mps_probe_theta.json"
DOC = ROOT / "docs" / "MPS_DIAGNOSTICS.md"
SV_MAX = 22
SHOTS = 512
SEED = 7
TIMEOUT = 150.0
SCALE = ("scale_6x2", "scale_8x2", "scale_10x2", "scale_12x2", "scale_16x2", "scale_20x2")
BASE = {"layout": "default", "prep": "aer", "chi": 16, "swap": "right", "lapack": False, "log": True,
        "threads": None, "state": True, "threshold": 1e-16}


# ---------------------------------------------------------------------------------------------
# circuits and simulators
# ---------------------------------------------------------------------------------------------
def prepared(case: Case, theta, layout: str, prep: str, measure: bool, seed: int = SEED) -> QuantumCircuit:
    """The scaling stage's compile_circuit (prep: line | basis2q | aer, see src/quantum/scaling.py)."""
    return compile_circuit(case, theta, layout, measure, seed, prep)


def mps_sim(cfg: dict) -> AerSimulator:
    opts = dict(method="matrix_product_state", matrix_product_state_truncation_threshold=float(cfg.get("threshold", 1e-16)),
                mps_swap_direction=f"mps_swap_{cfg['swap']}", mps_log_data=bool(cfg["log"]),
                mps_lapack=bool(cfg["lapack"]), max_memory_mb=MPS_MAX_MEMORY_MB)
    if cfg["chi"] is not None:
        opts["matrix_product_state_max_bond_dimension"] = int(cfg["chi"])
    if cfg.get("threads"):
        opts.update(max_parallel_threads=int(cfg["threads"]), mps_omp_threads=int(cfg["threads"]))
    return AerSimulator(**opts)


def gate_stats(qc: QuantumCircuit) -> dict:
    n3, span, n2 = 0, 0, 0
    for ins in qc.data:
        op = ins.operation
        if op.name in ("measure", "barrier") or op.num_qubits < 2:
            continue
        idx = [qc.find_bit(q).index for q in ins.qubits]
        if op.num_qubits >= 3:
            n3 += 1
        else:
            n2 += 1
        span = max(span, max(idx) - min(idx))
    return {"n_2q": n2, "n_3q_plus": n3, "max_span": span, "depth": int(qc.depth())}


def ref_path(cfg: dict) -> Path:
    return TMP / f"mps_ref_{cfg['scenario']}_{cfg['layout']}_{cfg['prep']}.pkl"


# ---------------------------------------------------------------------------------------------
# one configuration (runs inside the child process)
# ---------------------------------------------------------------------------------------------
def run_one(cfg: dict) -> dict:
    theta = cfg["theta"]
    seq = cfg.get("sequence")
    if seq:            # several sampling runs in ONE process (tests leaking state between runs)
        rows, cases = [], {}
        for step in seq:
            c = dict(cfg, **step)
            case = cases.setdefault(c["scenario"], Case(c["scenario"]))
            circ = prepared(case, theta, c["layout"], c["prep"], True)
            t0 = time.perf_counter()
            res = mps_sim(c).run(circ, shots=SHOTS, seed_simulator=SEED).result()
            stats = score_counts(case, dict(res.get_counts()))
            rows.append({"scenario": c["scenario"], "chi": c["chi"], "log_peak": _peak_bond_dim(res),
                         "ratio": stats["approx_ratio"], "feasibility_pct": stats["feasibility_pct"],
                         "sample_s": time.perf_counter() - t0})
        return {"sequence": rows}

    case = Case(cfg["scenario"])
    n = case.qp.n
    out = {"n_qubits": n}
    t0 = time.perf_counter()
    meas = prepared(case, theta, cfg["layout"], cfg["prep"], True)
    out["transpile_s"] = time.perf_counter() - t0
    out.update(gate_stats(meas))
    sim = mps_sim(cfg)
    t0 = time.perf_counter()
    res = sim.run(meas, shots=SHOTS, seed_simulator=SEED).result()
    out["sample_s"] = time.perf_counter() - t0
    if not res.success:
        raise RuntimeError(f"Aer status {res.status}")
    stats = score_counts(case, dict(res.get_counts()))
    out.update(ratio=stats["approx_ratio"], ratio_se=stats["ratio_se"], feasibility_pct=stats["feasibility_pct"],
               best_sampled_cost=stats["best_sampled_cost"])
    if cfg["log"]:
        out["log_peak"] = _peak_bond_dim(res)
    if not cfg.get("state", True):
        return out
    st = prepared(case, theta, cfg["layout"], cfg["prep"], False)
    st_mps = st.copy()
    st_mps.save_matrix_product_state(label="mps")
    t0 = time.perf_counter()
    r2 = sim.run(st_mps, shots=1, seed_simulator=SEED).result()
    out["state_s"] = time.perf_counter() - t0
    mps = r2.data()["mps"]
    bonds = mps_bonds(mps)
    out["max_bond"] = max(bonds) if bonds else 1
    out["mps_mb"] = mps_memory_mb(mps)
    if cfg.get("write_ref"):
        ref_path(cfg).write_bytes(pickle.dumps(mps))
    if n <= SV_MAX:
        st_sv = st.copy()
        st_sv.save_statevector(label="sv")
        exact = np.asarray(AerSimulator(method="statevector").run(st_sv, shots=1).result().data()["sv"])
        st_m = st.copy()
        st_m.save_statevector(label="sv")
        approx = np.asarray(sim.run(st_m, shots=1, seed_simulator=SEED).result().data()["sv"])
        out["fidelity"] = float(abs(np.vdot(exact, approx)) ** 2)
        out["fidelity_ref"] = "statevector"
    elif ref_path(cfg).exists() and not cfg.get("write_ref"):
        ref = pickle.loads(ref_path(cfg).read_bytes())
        out["fidelity"] = float(abs(mps_overlap(ref, mps)) ** 2)
        out["fidelity_ref"] = f"mps chi<= {max(mps_bonds(ref))} (untruncated run)"
    return out


# ---------------------------------------------------------------------------------------------
# parent: fresh process per configuration
# ---------------------------------------------------------------------------------------------
def theta() -> list:
    if THETA_CACHE.exists():
        return json.loads(THETA_CACHE.read_text())["theta"]
    TMP.mkdir(parents=True, exist_ok=True)
    cases = sorted((Case(s) for s in ("scale_6x2", "scale_8x2")), key=lambda c: c.qp.n)
    th, _src = train_angles(cases, SEED)
    THETA_CACHE.write_text(json.dumps({"theta": th}))
    return th


def launch(cfg: dict, timeout: float = TIMEOUT) -> dict:
    cfg = dict(BASE, **cfg)
    row = {"config": {k: v for k, v in cfg.items() if k != "theta"}}
    t0 = time.perf_counter()
    try:
        p = subprocess.run([sys.executable, "-X", "faulthandler", "-m", "src.quantum.mps_probe", "--one",
                            json.dumps(cfg)], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout,
                           env=dict(__import__("os").environ, PYTHONPATH=str(ROOT), PYTHONIOENCODING="utf-8"))
    except subprocess.TimeoutExpired:
        row.update(status="timeout", wall_s=time.perf_counter() - t0, error=f"no result within {timeout:.0f} s")
        return row
    row["wall_s"] = time.perf_counter() - t0
    row["exit_code"] = p.returncode
    lines = [l for l in p.stdout.splitlines() if l.startswith("{")]
    if p.returncode == 0 and lines:
        msg = json.loads(lines[-1])
        if msg.get("ok"):
            row.update(status="ok", result=msg["result"])
        else:
            row.update(status="error", error=msg.get("error"))
    else:
        code = p.returncode & 0xFFFFFFFF if p.returncode is not None else None
        tail = " | ".join(l.strip() for l in p.stderr.splitlines() if l.strip())[-400:]
        row.update(status="crash", exit_hex=None if code is None else f"0x{code:08X}", error=tail)
    return row


def _show(tag: str, row: dict) -> None:
    c, r = row["config"], row.get("result") or {}
    if "sequence" in r:
        print(f"[{tag}] sequence: " + "; ".join(f"{s['scenario']} chi={s['chi']} log_peak={s['log_peak']}"
                                                for s in r["sequence"]), flush=True)
        return
    print(f"[{tag}] {c.get('scenario')} {c['layout']}/{c['prep']} chi={c['chi']} swap={c['swap']} "
          f"lapack={c['lapack']} log={c['log']}: {row['status']} {row.get('exit_hex', '')} "
          f"ratio={r.get('ratio')} valid={r.get('feasibility_pct')} fid={r.get('fidelity')} "
          f"bond={r.get('max_bond')} t={r.get('sample_s')} {row.get('error', '')[:160] if row.get('error') else ''}",
          flush=True)


def _store(phase: str, rows: list) -> None:
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    data[phase] = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": rows}
    OUT.write_text(json.dumps(data, indent=1))


def phase_crash(th: list) -> list:
    rows = []
    jobs = [
        # H2: does the MPS log leak between runs in one process?
        ("H2 log leak", {"scenario": "scale_8x2", "sequence": [{"chi": 64}, {"chi": 2}], "state": False}),
        # stage order that crashed in session 2: 6x2 points, then 8x2 chi=2, in one process
        ("H3 stage order", {"sequence": [{"scenario": "scale_6x2", "chi": c} for c in (2, 4, 8, 16, 32, 64)]
                            + [{"scenario": "scale_8x2", "chi": 2}], "state": False}),
        ("H3 8x2 chi2 fresh", {"scenario": "scale_8x2", "chi": 2}),
        ("H3 swap left 16q", {"scenario": "scale_10x2", "swap": "left"}),
    ]
    for layout in ("interleaved", "paired"):
        for prep in ("aer", "basis2q", "line"):
            jobs.append((f"H3 {layout}/{prep}", {"scenario": "scale_10x2", "layout": layout, "prep": prep}))
        jobs.append((f"H3 {layout}/aer lapack", {"scenario": "scale_10x2", "layout": layout, "lapack": True}))
        jobs.append((f"H3 {layout}/aer nolog", {"scenario": "scale_10x2", "layout": layout, "log": False}))
        jobs.append((f"H3 {layout}/aer threads1", {"scenario": "scale_10x2", "layout": layout, "threads": 1}))
    for tag, cfg in jobs:
        row = launch(dict(cfg, theta=th))
        row["tag"] = tag
        _show(tag, row)
        rows.append(row)
    return rows


def phase_layouts(th: list, prep: str, scenarios=SCALE, chis=(2, 4, 8, 16, 32, 64),
                  layouts=("default", "paired", "interleaved"), budget: float = 1500.0) -> list:
    rows, t_start = [], time.perf_counter()
    for scen in scenarios:
        for layout in layouts:
            n = Case(scen).qp.n
            if n > SV_MAX:      # untruncated reference first, for the fidelity of the others
                row = launch({"scenario": scen, "layout": layout, "prep": prep, "chi": 256, "log": False,
                              "write_ref": True, "theta": th})
                row["tag"] = "reference"
                _show(f"{scen} ref", row)
                rows.append(row)
            for chi in chis:
                if time.perf_counter() - t_start > budget:
                    rows.append({"tag": "budget", "config": {"scenario": scen, "layout": layout, "chi": chi},
                                 "status": "skipped", "error": "probe budget used up"})
                    continue
                row = launch({"scenario": scen, "layout": layout, "prep": prep, "chi": chi, "log": False,
                              "theta": th})
                row["tag"] = "point"
                _show(scen, row)
                rows.append(row)
    return rows


OPTION_CASES = (("scale_8x2", "default", 2), ("scale_10x2", "default", 2), ("scale_10x2", "default", 4),
                ("scale_16x2", "paired", 4), ("scale_20x2", "default", 2), ("scale_12x2", "default", 64))


def phase_options(th: list) -> list:
    """Does a simulator option remove the small-chi crashes? Each case x compile path x
    mps_lapack x truncation threshold, sampling run only, fresh process each."""
    rows = []
    for scen, layout, chi in OPTION_CASES:
        for prep in ("aer", "line"):
            for lapack in (False, True):
                for thr in (1e-16, 1e-10):
                    cfg = {"scenario": scen, "layout": layout, "chi": chi, "prep": prep, "lapack": lapack,
                           "threshold": thr, "log": False, "state": False, "theta": th}
                    row = launch(cfg, timeout=90.0)
                    row["tag"] = f"lapack={lapack} threshold={thr:g}"
                    _show(row["tag"], row)
                    rows.append(row)
    return rows


def phase_required(th: list, prep: str, scenarios=SCALE, layouts=("default", "paired", "interleaved"),
                   cap: int = 1024) -> list:
    rows = []
    for scen in scenarios:
        for layout in layouts:
            row = launch({"scenario": scen, "layout": layout, "prep": prep, "chi": cap, "log": False,
                          "theta": th}, timeout=240.0)
            row["tag"] = f"required cap {cap}"
            _show(f"{scen} required", row)
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------------------------
# generated markdown
# ---------------------------------------------------------------------------------------------
def _f(v, d=3):
    return "-" if v is None else (f"{v:.{d}f}" if isinstance(v, float) else str(v))


def write_report() -> Path:
    data = json.loads(OUT.read_text())
    L = ["# MPS diagnostics (generated)", "",
         "Generated by `python -m src.quantum.mps_probe --report` from `results/tmp/mps_probe.json`. "
         "Do not edit by hand; re-run the probe instead. Every row ran in a fresh Python process with "
         "Aer's matrix_product_state method; a crash is recorded with its exit code and no numbers. "
         "Compile paths: aer = transpiled to the Aer MPS gate set (Aer moves distant qubits itself), "
         "line = routed to a line first (only nearest-neighbour gates reach Aer), basis2q = 1- and "
         "2-qubit gates without routing.", "",
         "## Summary", "",
         "- Bond-dimension notes: the session 2 stage read Aer's `mps_log_data`, which Aer keeps for the "
         "whole process, so a later point reported an earlier point's bond dimension. The stage now reads "
         "each run's own final MPS (`save_matrix_product_state`; test Q15).",
         "- Crashes: in every table below they happen only at bond dimension 2 or 4, are repeatable for a "
         "given circuit and compile path, and are not removed by `mps_lapack` or a larger truncation "
         "threshold. In each case found, the other compile path ran, so the stage retries a crashed point "
         "once with the line-routed circuit (test Q16).",
         "- Qubit layout: putting each feeder's hours side by side (paired, interleaved) does not beat the "
         "original layout by more than a few percent fidelity at bond dimension 64, so the stage keeps the "
         "original layout. The session 2 note that the interleaved layout crashes at 16 qubits did not "
         "reproduce in a fresh process.",
         "- Fidelity above 20 qubits: an untruncated reference run (bond dimension 256) did not finish in "
         "150 s at 28 and 36 qubits for any layout, so fidelity is reported only up to 20 qubits.", ""]
    if "crash" in data:
        L += ["## Crash and readout hypotheses", "", f"Run at {data['crash']['generated_at']}.", "",
              "| Test | Layout / prep | chi | Status | Exit code | Detail |", "|---|---|---|---|---|---|"]
        for row in data["crash"]["rows"]:
            c, r = row["config"], row.get("result") or {}
            if "sequence" in r:
                det = "; ".join(f"{s['scenario']} chi={s['chi']}: log peak {s['log_peak']}" for s in r["sequence"])
            elif row["status"] == "ok":
                det = (f"ratio {_f(r.get('ratio'))}, {_f(r.get('feasibility_pct'), 1)}% valid, fidelity "
                       f"{_f(r.get('fidelity'), 4)}, 3-qubit gates {r.get('n_3q_plus')}, longest gate {r.get('max_span')} sites")
            else:
                det = (row.get("error") or "")[:200].replace("|", "/")
            chi = ", ".join(str(x.get("chi", c["chi"])) for x in c["sequence"]) + " (one process)" if c.get("sequence") else c["chi"]
            L.append(f"| {row['tag']} | {c['layout']} / {c['prep']} | {chi} | {row['status']} | "
                     f"{row.get('exit_hex', '-') or '-'} | {det} |")
        L.append("")
    if "options" in data:
        L += ["## Simulator options on the cases that crashed", "", f"Run at {data['options']['generated_at']}. "
              "Sampling run only. aer = compiled for the Aer MPS target (Aer moves distant qubits itself); "
              "line = routed to a line first (only nearest-neighbour gates reach Aer).", "",
              "| Instance | Layout | chi | Compile | mps_lapack | Truncation threshold | Status | Exit code / error |",
              "|---|---|---|---|---|---|---|---|"]
        for row in data["options"]["rows"]:
            c = row["config"]
            det = (row.get("error") or "")[:90].replace("|", "/") if row["status"] != "ok" else ""
            L.append(f"| {c['scenario']} | {c['layout']} | {c['chi']} | {c['prep']} | {c['lapack']} | {c['threshold']:g} | "
                     f"{row['status']} | {row.get('exit_hex', '') or ''} {det} |")
        L.append("")
    for key in sorted(k for k in data if k.startswith("layouts")):
        rows = [r for r in data[key]["rows"] if r.get("tag") == "point"]
        L += [f"## Layout comparison ({key})", "", f"Run at {data[key]['generated_at']}. Each cell: approximation "
              "ratio / share of valid samples / fidelity of the final state (1.000 = exact).", ""]
        chis = sorted({r["config"]["chi"] for r in rows})
        L += ["| Instance | Layout | " + " | ".join(f"chi {c}" for c in chis) + " |",
              "|---|---|" + "---|" * len(chis)]
        seen = []
        for r in rows:
            k = (r["config"]["scenario"], r["config"]["layout"])
            if k not in seen:
                seen.append(k)
        for scen, layout in seen:
            cells = []
            for chi in chis:
                r = next((x for x in rows if x["config"]["scenario"] == scen and x["config"]["layout"] == layout
                          and x["config"]["chi"] == chi), None)
                if r is None:
                    cells.append("-")
                elif r["status"] != "ok":
                    cells.append(f"{r['status']} {r.get('exit_hex', '') or ''}".strip())
                else:
                    x = r["result"]
                    cells.append(f"{_f(x['ratio'], 2)} / {_f(x['feasibility_pct'], 0)}% / {_f(x.get('fidelity'), 3)}")
            L.append(f"| {scen} | {layout} | " + " | ".join(cells) + " |")
        L.append("")
    for key in sorted(k for k in data if k.startswith("required")):
        L += [f"## Bond dimension each layout needs ({key})", "",
              f"Run at {data[key]['generated_at']}. Cap 1024, truncation threshold 1e-16: the largest bond "
              "dimension of the final state, its memory, and the run time. Below the cap means the "
              "simulation was exact.", "",
              "| Instance | Qubits | Layout | Max bond dimension | MPS memory (MB) | Full statevector (MB) | Time (s) | Status |",
              "|---|---|---|---|---|---|---|---|"]
        for r in data[key]["rows"]:
            c, x = r["config"], r.get("result") or {}
            n = x.get("n_qubits")
            sv = None if n is None else (2 ** n) * 16 / 2 ** 20
            L.append(f"| {c['scenario']} | {_f(n)} | {c['layout']} | {_f(x.get('max_bond'))} | {_f(x.get('mps_mb'), 2)} | "
                     f"{_f(sv, 0)} | {_f(x.get('sample_s'), 1)} | {r['status']} {r.get('exit_hex', '') or ''} |")
        L.append("")
    DOC.write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")
    return DOC


def _child(cfg_json: str) -> None:
    out = sys.stdout
    sys.stdout = sys.stderr
    try:
        res = run_one(json.loads(cfg_json))
        out.write(json.dumps({"ok": True, "result": res}) + "\n")
    except Exception as exc:
        out.write(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"[:600]}) + "\n")
    out.flush()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="MPS probe (Area 1)")
    ap.add_argument("--one")
    ap.add_argument("--phase", choices=("crash", "layouts", "required", "options"))
    ap.add_argument("--prep", default="aer")
    ap.add_argument("--scenarios", default=",".join(SCALE))
    ap.add_argument("--chis", default="2,4,8,16,32,64")
    ap.add_argument("--layouts", default="default,paired,interleaved")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    if a.one:
        _child(a.one)
        sys.exit(0)
    TMP.mkdir(parents=True, exist_ok=True)
    if a.phase:
        th = theta()
        scen = tuple(a.scenarios.split(","))
        lays = tuple(a.layouts.split(","))
        if a.phase == "crash":
            _store("crash", phase_crash(th))
        elif a.phase == "options":
            _store("options", phase_options(th))
        elif a.phase == "layouts":
            _store(f"layouts_{a.prep}", phase_layouts(th, a.prep, scen, tuple(int(c) for c in a.chis.split(",")), lays))
        else:
            _store(f"required_{a.prep}", phase_required(th, a.prep, scen, lays))
    if a.report:
        print(write_report())
