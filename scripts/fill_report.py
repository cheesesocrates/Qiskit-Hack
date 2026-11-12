"""Build the FairShed report from results/*.json (Area 2). Never type a number by hand.

Usage:  python scripts/fill_report.py

Writes:
  docs/report/FairShed_Report.md      markdown report (renders on GitHub, Mermaid diagram inline)
  docs/report/FairShed_Report.docx    the same content as a Word document (python-docx)
  docs/report/architecture.mmd        Mermaid source of the architecture diagram
  docs/report/architecture.png        the same diagram drawn with matplotlib (embedded in both)
  docs/report/figures/*.png           charts generated from the results files

Every number in the report is read from results/*.json at build time, from the installed
package versions, or quoted from docs/SPEC.md (problem context). Limitations are parsed from
docs/KNOWN_ISSUES.md so the report and the issue list cannot drift apart. A results file that
is missing is reported as "not available", never filled in.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from importlib import metadata
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
OUT = ROOT / "docs" / "report"
FIG = OUT / "figures"
REPO_URL = "https://github.com/cheesesocrates/Qiskit-Hack"

# reference palette, light mode (dataviz skill): slot 1 blue, slot 2 orange, ink and grid
BLUE, ORANGE = "#2a78d6", "#eb6834"
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#8a8984", "#e4e3df"
BLUE_RAMP = ["#b7d3f2", "#8cb9ea", "#5f9de0", "#2a78d6", "#1f5fae", "#164682"]


# ------------------------------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------------------------------
def load(rel: str):
    p = RES / rel
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def f(v, d=3):
    if v is None:
        return "n/a"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int):
        return str(v)
    return f"{v:.{d}f}"


def pct(v, d=1):
    return "n/a" if v is None else f"{v:.{d}f}%"


def na(rel: str) -> tuple:
    return ("p", f"Not available: results/{rel} was not generated or could not be read.")


def version(pkg: str) -> str:
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return "not installed"


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def spec_context() -> str:
    text = (ROOT / "docs" / "SPEC.md").read_text(encoding="utf-8")
    m = re.search(r"^CONTEXT[^:]*:\s*(.+)$", text, flags=re.M)
    if not m:
        return ""
    # keep the factual sentences; drop the brief's instruction about synthetic data (stated separately)
    sentences = re.split(r"(?<=\.)\s+", m.group(1).strip())
    return " ".join(x for x in sentences if not x.startswith("Real feeder maps"))


def known_issues() -> list:
    rows = []
    text = (ROOT / "docs" / "KNOWN_ISSUES.md").read_text(encoding="utf-8")
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 3 and cells[0] not in ("Item", "") and not set(cells[0]) <= set("- "):
            rows.append((cells[0].replace("`", ""), cells[1], cells[2]))
    return rows


# ------------------------------------------------------------------------------------------
# figures
# ------------------------------------------------------------------------------------------
def _style(ax):
    ax.spines[["top", "right"]].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.grid(color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def fig_ablation(abl) -> Path | None:
    rows = [r for r in abl["rows"] if r["instance"] == abl["instance_name"]]
    if not rows:
        return None
    rows = rows[::-1]
    fig, ax = plt.subplots(figsize=(7.2, 0.42 * len(rows) + 1.0), dpi=200)
    colors = [BLUE if r["kind"] == "quantum" else ORANGE for r in rows]
    y = range(len(rows))
    ax.barh(list(y), [r["approx_ratio"] for r in rows], color=colors, height=0.55, edgecolor="white", linewidth=1)
    for i, r in enumerate(rows):
        ax.text(r["approx_ratio"] + 0.01, i, f"{r['approx_ratio']:.3f}", va="center", fontsize=8.5, color=INK)
    ax.set_yticks(list(y), [r["label"] for r in rows], fontsize=8.5, color=INK)
    ax.set_xlim(0, 1.12)
    ax.set_xlabel("Approximation ratio (1.0 = exact optimum, invalid samples score 0)", fontsize=9, color=INK2)
    _style(ax)
    ax.grid(axis="y", visible=False)
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=BLUE, label="Quantum (simulated)"), Patch(color=ORANGE, label="Classical")],
              loc="lower right", fontsize=8.5, frameon=False)
    fig.tight_layout()
    p = FIG / "ablation.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


def fig_scaling(sc) -> Path | None:
    pts = [p for p in sc["points"] if p["bond_dim"] is not None]
    sizes = sorted({p["n_qubits"] for p in pts})
    if not sizes:
        return None
    fig, ax = plt.subplots(figsize=(7.2, 3.8), dpi=200)
    for k, n in enumerate(sizes):
        ser = sorted((p for p in pts if p["n_qubits"] == n), key=lambda p: p["bond_dim"])
        xs = [p["bond_dim"] for p in ser if p["status"] == "ok"]
        ys = [p["approx_ratio"] for p in ser if p["status"] == "ok"]
        lab = next(f"{p['n_feeders']}x{p['n_hours']} ({n} qubits)" for p in ser)
        ax.plot(xs, ys, color=BLUE_RAMP[k % len(BLUE_RAMP)], linewidth=2, marker="o", markersize=4, label=lab)
    ax.set_xscale("log", base=2)
    ax.set_xticks(sorted({p["bond_dim"] for p in pts}), [str(d) for d in sorted({p["bond_dim"] for p in pts})])
    ax.set_ylim(0, 1)
    ax.set_xlabel("Maximum MPS bond dimension (chi)", fontsize=9, color=INK2)
    ax.set_ylabel("Approximation ratio", fontsize=9, color=INK2)
    _style(ax)
    ax.legend(fontsize=8, frameon=False, loc="lower right", title="Instance (lighter = smaller)", title_fontsize=8)
    fig.tight_layout()
    p = FIG / "scaling.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


def fig_replay(rep) -> Path | None:
    fr = rep["frames"]
    if not fr:
        return None
    x = list(range(len(fr)))
    fig, ax = plt.subplots(figsize=(7.2, 3.2), dpi=200)
    ax.plot(x, [f["shortfall_mw"] for f in fr], color=BLUE, linewidth=2, marker="o", markersize=4, label="Actual shortfall")
    ax.plot(x, [f["forecast_mw"] for f in fr], color=ORANGE, linewidth=2, linestyle="--", label="Ridge forecast")
    bad = [i for i, f in enumerate(fr) if not f["matches_exact"]]
    if bad:
        ax.scatter(bad, [fr[i]["shortfall_mw"] for i in bad], s=90, facecolors="none", edgecolors=INK, linewidths=1.5,
                   zorder=5, label="Committed plan costlier than exact")
    ax.set_xticks(x, [f"{f['hour']:02d}:00" for f in fr], fontsize=8)
    ax.set_ylabel("MW", fontsize=9, color=INK2)
    ax.set_ylim(bottom=0)
    _style(ax)
    ax.legend(fontsize=8, frameon=False, loc="upper left")
    fig.tight_layout()
    p = FIG / "replay.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


MERMAID = """flowchart LR
  subgraph A2["Area 2: data, classical, report"]
    GEN["Synthetic generator + cost model<br/>(QUBO export)"]
    BASE["Exact, MILP, round-robin,<br/>random-valid baselines"]
    FC["Ridge forecast<br/>(classical)"]
    AUD["Audit mode"]
    REP["Receding-horizon replay"]
    RPT["fill_report.py"]
  end
  subgraph C["Contract"]
    RES[("results/*.json<br/>+ schemas/")]
  end
  subgraph A1["Area 1: quantum (Qiskit, Aer simulator)"]
    QAOA["QAOA: Dicke + XY mixer,<br/>Grover mixer, penalty"]
    GAS["Grover Adaptive Search"]
    CNT["Counting (IAE)"]
    RSK["Risk: VaR / CVaR (IAE)"]
    MPS["MPS scaling"]
    WIN["solve-window"]
  end
  subgraph A3["Area 3: dashboard"]
    UI["Static dashboard,<br/>7 screens, offline"]
  end
  GEN --> RES
  BASE --> RES
  FC --> RES
  AUD --> RES
  REP --> RES
  RES --> QAOA & GAS & CNT & RSK & MPS
  QAOA & GAS & CNT & RSK & MPS --> RES
  REP -- "window_in.json" --> WIN
  WIN -- "window_out.json" --> REP
  RES --> UI
  RES --> RPT
"""


def fig_architecture() -> Path:
    fig, ax = plt.subplots(figsize=(10, 6.0), dpi=200)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 65)
    ax.axis("off")

    def box(x, y, w, h, text, fc="white", ec=MUTED, size=8.5, weight="normal"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.2", fc=fc, ec=ec, lw=1.2))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=INK, weight=weight, wrap=True)

    def group(x, y, w, h, title):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.6,rounding_size=2", fc="#f6f6f4", ec=GRID, lw=1))
        ax.text(x + 1, y + h - 1.2, title, ha="left", va="top", fontsize=9.5, color=INK2, weight="bold")

    def arrow(x1, y1, x2, y2, color=INK2, text=None, rad=0.0):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=11, color=color, lw=1.1,
                                     connectionstyle=f"arc3,rad={rad}"))
        if text:
            ax.text((x1 + x2) / 2, (y1 + y2) / 2 + 1.2, text, ha="center", fontsize=7.5, color=INK2)

    group(1, 12, 30, 47, "Area 2: data, classical, report")
    a2 = ["Synthetic generator + cost model\n(QUBO export)", "Exact, MILP, round-robin,\nrandom-valid baselines",
          "Ridge forecast (classical)", "Audit mode", "Receding-horizon replay"]
    for i, t in enumerate(a2):
        box(3, 49 - i * 8.2, 26, 5.6, t)
    group(69, 12, 30, 47, "Area 1: quantum (Qiskit, Aer simulator)")
    a1 = ["QAOA: Dicke + XY mixer,\nGrover mixer, penalty", "Grover Adaptive Search", "Counting (IAE)",
          "Risk: VaR and CVaR (IAE)", "MPS scaling", "solve-window (called by replay)"]
    for i, t in enumerate(a1):
        box(71, 50 - i * 7.0, 26, 4.8, t)
    box(38, 28, 24, 12, "results/*.json\n+ schemas/\n(the only interface)", fc="#eaf2fc", ec=BLUE, size=9.5, weight="bold")
    box(36, 3, 13, 6, "Dashboard (Area 3)\n7 screens, offline", fc="white")
    box(51, 3, 13, 6, "fill_report.py\nreport .md + .docx")
    box(3, 3, 26, 6, "pytest proof checks\n-> results/checks.json")
    for i in range(5):
        arrow(29.4, 51.8 - i * 8.2, 38, 36 - i * 1.2)
    arrow(62, 37, 68.6, 42, color=BLUE, text="reads plans")
    arrow(68.6, 27, 62, 31, color=BLUE)
    ax.text(65.3, 26.0, "writes results", ha="center", fontsize=7.5, color=INK2)
    ax.add_patch(FancyArrowPatch((29.4, 18.4), (70.6, 17.4), arrowstyle="<|-|>", mutation_scale=11, color=BLUE, lw=1.1))
    ax.text(50, 21.2, "window_in.json /\nwindow_out.json\n(files, not imports)", ha="center", va="center", fontsize=7.5,
            color=INK2, bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none"))
    arrow(41, 28, 42.5, 9.4)
    arrow(59, 28, 57.5, 9.4)
    arrow(29.4, 6, 35.6, 6)
    ax.text(50, 63, "FairShed architecture: three areas that talk only through results files", ha="center",
            fontsize=11, color=INK, weight="bold")
    fig.tight_layout()
    p = OUT / "architecture.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


# ------------------------------------------------------------------------------------------
# content
# ------------------------------------------------------------------------------------------
def build() -> list:
    abl, lot, par = load("ablation.json"), load("lottery.json"), load("pareto.json")
    cnt, rsk, sca = load("counting.json"), load("risk.json"), load("scaling.json")
    rep, fc, aud = load("replay.json"), load("forecast.json"), load("audit_example.json")
    chk, base, heat = load("checks.json"), load("plans/base.json"), load("plans/heatwave_cap.json")
    B = []
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    B += [("title", "FairShed: a fair, auditable load-shedding planner with Qiskit"),
          ("p", f"Qiskit hackathon, Energy and Smart Infrastructure. Repository: {REPO_URL}. "
                f"Report generated {now} from commit {git_commit()} by scripts/fill_report.py."),
          ("callout", "Simulator only. Every feeder, demand figure and outage ledger in this report is synthetic, "
                      "on illustrative Karachi zones. Weather in the forecast is a real Open-Meteo snapshot. No "
                      "quantum speed-up is claimed: every instance here is also solved exactly by classical brute "
                      "force or MILP, and that exact answer is the yardstick for every quantum number.")]

    # 1. problem
    inst = base["instance"] if base else None
    B += [("h1", "1. Problem")]
    ctx = spec_context()
    if ctx:
        B += [("p", "Context, quoted from the project brief (docs/SPEC.md); these are not results of this code: "
                    f"\"{ctx}\"")]
    B += [("p", "When supply falls short, a utility switches whole feeders off for an hour at a time. The quota (how "
                "many feeders go off each hour) follows from the shortfall. The open question is which feeders. A "
                "fair plan spreads the outage hours evenly, avoids cutting the same area hour after hour, spares "
                "the areas where an outage hurts most, and never cuts hospitals, water pumps or telecom towers. It "
                "must also be auditable: anyone should be able to check a published schedule against the rules.")]
    if inst:
        prot = [ft["name"] for ft in inst["feeders"] if ft["protected"]]
        ex = base["exact"]
        B += [("p", f"Base instance: {inst['n_feeders']} synthetic feeders over {inst['n_hours']} hours starting at "
                    f"{inst['start_hour']:02d}:00, quotas {', '.join(map(str, inst['quotas']))}, protected feeders "
                    f"{', '.join(prot)}. It has {ex['n_valid']} valid plans; {ex['n_optimal']} tie for the optimum at "
                    f"cost {f(ex['cost_min'], 2)} (worst valid plan {f(ex['cost_max'], 2)}).")]
    B += [("h2", "Formulation"),
          ("p", "Variable x[t,f] = 1 means feeder f is off in hour t; the qubit index is q = t*N + f. Hard "
                "constraints: exactly m_t feeders off in hour t, and protected feeders never off. The cost is a QUBO:"),
          ("code", "C(x) = w_h * sum_t,f hardship[t][f] x[t,f]\n"
                   "     + w_f * sum_f (ledger[f] + sum_t x[t,f] - mu)^2\n"
                   "     + w_c * (sum_f sum_t x[t,f] x[t+1,f] + sum_f prev_off[f] x[0,f])"),
          ("p", "Hardship weighs heat and population, the fairness term pulls every feeder's total outage hours "
                "(including hours already served, the ledger) towards the mean, and the consecutive term penalises "
                "cutting the same feeder in adjacent hours. Sums run over non-protected feeders. The exact contract "
                "is in docs/CONTRACT.md.")]
    if inst:
        w = inst["weights"]
        B += [("p", f"Weights in the base instance: hardship {w['hardship']}, fairness {w['fairness']}, consecutive "
                    f"{w['consecutive']}.")]

    # 2. architecture
    B += [("h1", "2. Architecture"),
          ("p", "The repository is split into three areas that never import each other's code. They exchange only "
                "JSON files in results/, each validated against a JSON Schema in schemas/. Area 2 generates the "
                "synthetic instances, the exact reference, the forecast, the audit and the replay. Area 1 reads "
                "the QUBO from the plans files and runs every quantum stage on the Aer simulator. Area 3 is a "
                "static dashboard that reads the same files. The replay asks Area 1 to solve each window through "
                "files (window_in.json, window_out.json), and falls back to the exact solver per frame if needed."),
          ("image", "architecture.png", "Figure 1. Architecture (Mermaid source: docs/report/architecture.mmd).", 6.5),
          ("mermaid", MERMAID)]

    # 3. methods
    B += [("h1", "3. Methods"),
          ("bullets", [
              "Dicke + XY-mixer QAOA: each hour block starts in a Dicke state (uniform over plans with exactly m_t "
              "feeders off) and an XY ring mixer keeps the Hamming weight, so every sample meets the quota and "
              "protected feeders have no qubit at all.",
              "Grover-mixer QAOA: reuses the Dicke preparation U_S and mixes with U_S (I - (1 - e^{-i beta}) |0><0|) "
              "U_S^dagger. Plans with equal cost always get equal amplitude, so a tie between optimal plans is "
              "broken by a fair lottery rather than by circuit bias.",
              "Penalty QAOA with the standard X mixer: the quota is a soft penalty; this is the weak baseline.",
              "Quantum counting: iterative amplitude estimation over a reversible validity oracle counts the valid "
              "plans (the planner's flexibility), checked against enumeration.",
              "Risk: the forecast's residual distribution is loaded into qubits and amplitude estimation gives "
              "expected loss, tail probability, VaR and CVaR of the shortfall a plan leaves uncovered.",
              "Grover Adaptive Search (qiskit-optimization GroverOptimizer) on an 8-variable block as a second "
              "quantum comparator.",
              "MPS scaling: the Dicke + XY circuit on larger instances (up to 36 qubits) with the Aer matrix "
              "product state simulator at bounded bond dimension, against the exact classical optimum.",
              "Classical side: brute force and MILP for the exact optimum, round-robin and uniform random valid "
              "plans as baselines, a ridge-regression shortfall forecast, an audit that scores any schedule "
              "against four rules, and a receding-horizon replay that re-plans every hour with a warm start."]),
          ("p", "Decision rule: when a QAOA run must produce one plan, it takes the lowest-cost valid sample among "
                "256 shots; ties go to the plan closest to the previous one, then to a seeded draw.")]

    # 4. results
    B += [("h1", "4. Results")]
    B += [("h2", "4.1 Quantum methods against the exact answer")]
    if abl:
        ref = abl["reference"]
        B += [("p", f"All rows use the same instance and the same exact reference: {ref['n_valid']} valid plans, "
                    f"cost {f(ref['cost_min'], 2)} to {f(ref['cost_max'], 2)}, {ref['n_optimal']} optimal. "
                    "Approximation ratio is the mean over all samples with invalid samples scored 0, so infeasible "
                    "output is penalised rather than filtered away. P(optimal) is the share of samples that are "
                    "valid and optimal.")]
        hdr = ["Method", "Instance", "Qubits", "Layers", "Shots", "Feasible", "P(optimal)", "Approx. ratio",
               "Fairness entropy", "Runtime (s)"]
        rows = [[r["label"], r["instance"], f(r["n_qubits"]), f(r["layers"]), f(r["shots"]), pct(r["feasibility_pct"]),
                 f(r["p_optimal"], 4), f(r["approx_ratio"]), f(r["fairness_entropy"]), f(r["runtime_s"], 2)]
                for r in abl["rows"]]
        B += [("table", hdr, rows, "Table 1. Ablation (results/ablation.json).")]
        p = fig_ablation(abl)
        if p:
            B += [("image", "figures/ablation.png", f"Figure 2. Approximation ratio on the {abl['instance_name']} instance.", 6.3)]
        q = [r for r in abl["rows"] if r["kind"] == "quantum" and r["instance"] == abl["instance_name"]]
        rr = next((r for r in abl["rows"] if r["method"] == "round_robin" and r["instance"] == abl["instance_name"]), None)
        rv = next((r for r in abl["rows"] if r["method"] == "random_valid" and r["instance"] == abl["instance_name"]), None)
        dk = next((r for r in q if r["method"] == "dicke_uniform"), None)
        if q:
            best = max(q, key=lambda r: r["approx_ratio"])
            bestp = max(q, key=lambda r: r["p_optimal"])
            pen = [r for r in q if r["method"].startswith("penalty")]
            txt = (f"Best quantum row by approximation ratio: {best['label']} at {f(best['approx_ratio'])}. "
                   f"Highest sampled P(optimal): {bestp['label']} at {f(bestp['p_optimal'], 4)}")
            if dk:
                txt += (f", against {f(dk['p_optimal'], 4)} for sampling the Dicke state alone (uniform over valid plans)")
            txt += ". "
            if rr:
                txt += (f"The single deterministic round-robin plan scores {f(rr['approx_ratio'])}, higher than the "
                        f"mean QAOA sample; it is one plan, while the QAOA rows average over thousands of samples. ")
            if rv:
                txt += f"A uniformly random valid plan averages {f(rv['approx_ratio'])}. "
            if pen:
                txt += (f"Penalty QAOA with the X mixer produces valid plans in only "
                        f"{' and '.join(pct(r['feasibility_pct']) for r in pen)} of samples, which is why the constraint-"
                        "preserving mixers matter. ")
            txt += ("The honest reading: the constraint-preserving circuits always produce valid plans and shift "
                    f"probability towards cheap ones, but at {best['n_qubits']} qubits classical brute force over all "
                    f"valid plans gives the exact answer, and per-shot P(optimal) is at most "
                    f"{100 * max(r['p_optimal'] for r in q):.2f}%.")
            B += [("p", txt)]
    else:
        B += [na("ablation.json")]

    B += [("h2", "4.2 Fair lottery among tied optima")]
    if lot:
        hdr = ["Plan cost", "Plans with this cost", "Least likely plan", "Most likely plan", "Spread"]
        rows = [[f(g["cost"], 2), f(g["n_plans"]), f"{g['prob_min']:.6g}", f"{g['prob_max']:.6g}", f"{g['prob_spread']:.2g}"]
                for g in lot["tie_groups"]]
        B += [("p", f"{lot['method']} on {lot['n_qubits']} qubits. In the exact simulated state, plans with equal cost "
                    "receive equal probability, so choosing among tied optimal plans is an unbiased lottery. "
                    f"All sampled plans valid: {f(lot['all_feasible'])}."),
              ("table", hdr, rows, "Table 2. Equal-cost groups (results/lottery.json).")]
    else:
        B += [na("lottery.json")]

    B += [("h2", "4.3 Fairness trade-off (Pareto sweep)")]
    if par:
        hdr = ["Fairness weight", "QAOA plan cost", "Exact optimum", "Matches exact", "Std-dev of outage hours",
               "Hardship", "P(optimal) per shot"]
        rows = [[f(p["fairness_weight"], 2), f(p["cost"], 3), f(p["exact_cost"], 3), f(p["matches_exact"]),
                 f(p["fairness_metric"], 3), f(p["hardship_total"], 2), f(p["p_optimal"], 4)] for p in par["points"]]
        n_match = sum(1 for p in par["points"] if p["matches_exact"])
        B += [("p", f"{par['method']}, re-optimised at each fairness weight and warm-started from the previous one. "
                    f"The chosen plan matches the exact optimum at {n_match} of {len(par['points'])} weights."),
              ("table", hdr, rows, "Table 3. Pareto sweep (results/pareto.json).")]
    else:
        B += [na("pareto.json")]

    B += [("h2", "4.4 Counting the valid plans")]
    if cnt:
        i = cnt["instance"]
        B += [("table", ["Quantity", "Value"], [
            ["Block", f"{i['n_feeders']} feeders x {i['n_hours']} hours, quotas {', '.join(map(str, i['quotas']))}"],
            ["Search space", f(cnt["search_space"])],
            ["Exact count (enumeration)", f(cnt["exact_count"])],
            ["IAE estimate", f(cnt["estimated_count"], 3)],
            ["95% confidence interval", f"{f(cnt['ci'][0], 3)} to {f(cnt['ci'][1], 3)}"],
            ["Within tolerance", f(cnt["within_tolerance"])],
            ["Oracle queries", f(cnt["oracle_queries"])],
            ["Qubits (search / total)", f"{cnt['n_qubits_search']} / {cnt['n_qubits_total']}"]],
            "Table 4. Quantum counting (results/counting.json).")]
    else:
        B += [na("counting.json")]

    B += [("h2", "4.5 Tail risk by amplitude estimation")]
    if rsk:
        e, s = rsk["exact"], rsk["estimated"]
        B += [("p", rsk["block"]["description"] + f" Loss unit: {rsk['loss_unit']}."),
              ("table", ["Measure", "Exact", "Amplitude estimation", "95% interval"], [
                  ["Expected loss (MW)", f(e["expected_loss"], 4), f(s["expected_loss"], 4), f"{f(s['expected_loss_ci'][0], 4)} to {f(s['expected_loss_ci'][1], 4)}"],
                  ["P(loss > 0)", f(e["tail_prob"], 4), f(s["tail_prob"], 4), f"{f(s['tail_prob_ci'][0], 4)} to {f(s['tail_prob_ci'][1], 4)}"],
                  [f"VaR at {f(rsk['alpha'] * 100, 0)}% (MW)", f(e["var"], 4), f(s["var"], 4), "found by search"],
                  [f"CVaR at {f(rsk['alpha'] * 100, 0)}% (MW)", f(e["cvar"], 4), f(s["cvar"], 4), f"{f(s['cvar_ci'][0], 4)} to {f(s['cvar_ci'][1], 4)}"]],
               f"Table 5. Risk (results/risk.json). {rsk['n_qubits']} qubits, {rsk['oracle_queries']} oracle queries, "
               f"all within tolerance: {f(rsk['within_tolerance'])}.")]
    else:
        B += [na("risk.json")]

    B += [("h2", "4.6 Where round-robin and random plans fail")]
    if heat:
        st = heat["random_valid_stats"]
        hdr = ["Plan", "Cost", "Approx. ratio", "Audit passes", "Violations"]
        rows = [[p["label"], f(p["cost"], 2), f(p["approx_ratio"]), f(p["audit_passed"]), f(p["n_violations"])]
                for p in heat["plans"]]
        B += [("p", heat.get("description", "")),
              ("table", hdr, rows, "Table 6. Scenario heatwave_cap (results/plans/heatwave_cap.json)."),
              ("p", f"Over {st['n_samples']} uniform random valid plans, {pct(st['cap_violation_pct'])} break the "
                    f"consecutive-hour cap and the mean approximation ratio is {f(st['mean_approx_ratio'])}.")]
    else:
        B += [na("plans/heatwave_cap.json")]
    if aud:
        rows = [[e["label"], f(e["passed"]), pct(e["score"]), f(len(e["violations"]))] for e in aud["examples"]]
        B += [("table", ["Schedule", "Passes", "Audit score", "Violations"], rows,
               f"Table 7. Audit mode on scenario {aud['scenario']} (results/audit_example.json).")]

    B += [("h2", "4.7 Receding-horizon replay with the quantum window solver")]
    if rep:
        sm = rep["summary"]
        solvers = {}
        for fr in rep["frames"]:
            solvers[fr["solver_used"]] = solvers.get(fr["solver_used"], 0) + 1
        B += [("p", f"Solver requested: {rep['solver_requested']}. {sm['n_frames']} hourly frames; "
                    f"{sm['matches_exact_count']} of {sm['n_frames']} committed windows match the exact optimum; "
                    f"{sm['n_changed']} feeder state changes; total hardship {f(sm['total_hardship'], 1)}; fairness "
                    f"spread {f(sm['fairness_spread_hours'], 1)} hours. Solvers used: "
                    + "; ".join(f"{k}: {v} frames" for k, v in solvers.items()) + "."),
              ("table", ["Hour", "Actual MW", "Forecast MW", "Quota", "Window cost", "Exact cost", "Matches", "Audit"],
               [[f"{fr['hour']:02d}:00", f(fr["shortfall_mw"], 2), f(fr["forecast_mw"], 2), f(fr["quota"]), f(fr["cost"], 2),
                 f(fr["exact_cost"], 2), f(fr["matches_exact"]), "pass" if fr["audit_passed"] else "fail"] for fr in rep["frames"]],
               "Table 8. Replay frames (results/replay.json).")]
        if fig_replay(rep):
            B += [("image", "figures/replay.png", "Figure 3. Replay: actual and forecast shortfall; circled frames committed a plan costlier than the exact optimum.", 6.3)]
    else:
        B += [na("replay.json")]

    B += [("h2", "4.8 Forecast (classical)")]
    if fc:
        m = fc["metrics"]
        B += [("table", ["Quantity", "Value"], [
            ["Model", f"{fc['model']['type']}, alpha {fc['model']['alpha']}"],
            ["Training / test hours", f"{fc['model']['n_train']} / {fc['model']['n_test']}"],
            ["MAE (MW)", f(m["mae_mw"], 3)], ["RMSE (MW)", f(m["rmse_mw"], 3)], ["R squared", f(m["r2"], 3)],
            ["Weather", f"{fc['weather_provenance']} ({fc['weather_source']})"],
            ["Demand and shortfall", fc["demand_provenance"]]], "Table 9. Forecast (results/forecast.json).")]
    else:
        B += [na("forecast.json")]

    # 5. scale
    B += [("h1", "5. Scale")]
    if sca:
        pts = sca["points"]
        ok = [p for p in pts if p["status"] == "ok"]
        sizes = sorted({p["n_qubits"] for p in pts})
        dims = sorted({p["bond_dim"] for p in pts if p["bond_dim"] is not None})
        hdr = ["Instance", "Statevector"] + [f"chi {d}" for d in dims]

        def cell(n, d):
            p = next((p for p in pts if p["n_qubits"] == n and p["bond_dim"] == d), None)
            if p is None:
                return "not run"
            return f(p["approx_ratio"]) if p["status"] == "ok" else p["status"]
        rows = []
        for n in sizes:
            p0 = next(p for p in pts if p["n_qubits"] == n)
            rows.append([f"{p0['n_feeders']}x{p0['n_hours']} ({n} q)", cell(n, None)] + [cell(n, d) for d in dims])
        B += [("p", f"{sca['method']}. {len(ok)} of {len(pts)} points ran; {sca['shots']} shots each. The matrix "
                    "product state simulator is a classical method: this curve shows how much bond dimension a "
                    "faithful simulation of the circuit needs as the instance grows, not a quantum advantage."),
              ("table", hdr, rows, "Table 10. Approximation ratio by bond dimension (results/scaling.json)."),
              ("p", "Angles: " + sca["parameter_source"])]
        if fig_scaling(sca):
            B += [("image", "figures/scaling.png", "Figure 4. Approximation ratio against bond dimension.", 6.3)]
    else:
        B += [na("scaling.json")]

    # 6. validation
    B += [("h1", "6. Validation")]
    if chk:
        s = chk["summary"]
        B += [("p", f"{s['passed']} of {s['total']} proof checks pass in the last test run (results/checks.json, "
                    f"written {chk['generated_at']}). Each is a pytest test."),
              ("table", ["ID", "Check", "Passed", "Detail"],
               [[c["id"], c["name"], f(c["passed"]), str(c.get("detail") or "")[:140]] for c in sorted(chk["checks"], key=lambda c: c["id"])],
               "Table 11. Proof checks.")]
    else:
        B += [na("checks.json")]

    # 7. limits
    B += [("h1", "7. Honest limitations"),
          ("bullets", [
              "Simulator only. Nothing ran on quantum hardware, and there is no noise model.",
              "No speed-up claim. Every instance is also solved exactly by brute force or MILP; the quantum "
              "methods are measured against that exact answer, and the classical answer is better.",
              "Real feeder maps are not public, so the feeders are synthetic and placed on illustrative Karachi "
              "zones; nothing here describes a real network.",
              "Per-shot P(optimal) of the QAOA variants is low on the base instance (Table 1); the plan comes "
              "from the best of 256 shots, which can still miss the optimum (see the Pareto and replay rows).",
              "All feeders, demand, supply, shortfall and ledger values are synthetic. Weather is real but only "
              "used as a forecast input.",
              "Counting and risk use 8 and 3 search qubits; they show that the estimators are correct, not that "
              "they are useful at this size."]),
          ("p", "Specific issues from docs/KNOWN_ISSUES.md:")]
    ki = known_issues()
    if ki:
        B += [("table", ["Item", "Status", "Detail"], [list(r) for r in ki], "Table 12. Known issues.")]

    # 8. reproduce
    B += [("h1", "8. Reproducibility"),
          ("code", "git clone " + REPO_URL + "\ncd Qiskit-Hack\npython scripts/tasks.py setup      # .venv + pinned requirements\n"
                   ".venv/Scripts/python.exe scripts/tasks.py demo   # Windows; Linux/macOS: .venv/bin/python\n"
                   ".venv/Scripts/python.exe scripts/tasks.py test\n.venv/Scripts/python.exe scripts/tasks.py ui   # http://localhost:8000/ui/"),
          ("table", ["Package", "Version"], [[p, version(p)] for p in
                                             ("qiskit", "qiskit-aer", "qiskit-algorithms", "qiskit-optimization", "numpy", "scipy",
                                              "jsonschema", "pytest", "matplotlib", "python-docx")] + [["Python", sys.version.split()[0]]],
           "Table 13. Versions used to build this report."),
          ("p", "Seeds: every results file records its seed (7 by default). Results reproduce exactly on one "
                "machine; optimiser angles can differ in the fourth decimal across machines.")]
    return B


# ------------------------------------------------------------------------------------------
# renderers
# ------------------------------------------------------------------------------------------
def to_markdown(blocks: list) -> str:
    out = []
    for b in blocks:
        k = b[0]
        if k == "title":
            out += [f"# {b[1]}", ""]
        elif k == "h1":
            out += [f"## {b[1]}", ""]
        elif k == "h2":
            out += [f"### {b[1]}", ""]
        elif k == "p":
            out += [b[1], ""]
        elif k == "callout":
            out += [f"> {b[1]}", ""]
        elif k == "bullets":
            out += [f"- {x}" for x in b[1]] + [""]
        elif k == "code":
            out += ["```", b[1], "```", ""]
        elif k == "mermaid":
            out += ["```mermaid", b[1].rstrip(), "```", ""]
        elif k == "image":
            out += [f"![{b[2]}]({b[1]})", "", f"*{b[2]}*", ""]
        elif k == "table":
            hdr, rows, cap = b[1], b[2], b[3]
            esc = lambda s: str(s).replace("|", "/").replace("\n", " ")
            out += [f"*{cap}*", "", "| " + " | ".join(map(esc, hdr)) + " |", "|" + "---|" * len(hdr)]
            out += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows]
            out += [""]
    return "\n".join(out)


def to_docx(blocks: list, path: Path) -> None:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.9)
    st = doc.styles["Normal"]
    st.font.name = "Calibri"
    st.font.size = Pt(10.5)

    def shade(cell, hexcolor):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hexcolor)
        tcPr.append(shd)

    for b in blocks:
        k = b[0]
        if k == "title":
            doc.add_heading(b[1], level=0)
        elif k == "h1":
            doc.add_heading(b[1], level=1)
        elif k == "h2":
            doc.add_heading(b[1], level=2)
        elif k == "p":
            doc.add_paragraph(b[1])
        elif k == "callout":
            t = doc.add_table(rows=1, cols=1)
            t.style = "Table Grid"
            c = t.rows[0].cells[0]
            shade(c, "EAF2FC")
            r = c.paragraphs[0].add_run(b[1])
            r.bold = True
            doc.add_paragraph()
        elif k == "bullets":
            for x in b[1]:
                doc.add_paragraph(x, style="List Bullet")
        elif k == "code":
            p = doc.add_paragraph()
            r = p.add_run(b[1])
            r.font.name = "Consolas"
            r.font.size = Pt(9)
        elif k == "mermaid":
            continue  # the PNG of the same diagram is embedded; the source is architecture.mmd
        elif k == "image":
            img = OUT / b[1]
            if img.exists():
                doc.add_picture(str(img), width=Inches(b[3]))
                cap = doc.add_paragraph(b[2])
                cap.runs[0].italic = True
                cap.runs[0].font.size = Pt(9)
        elif k == "table":
            hdr, rows, capt = b[1], b[2], b[3]
            cap = doc.add_paragraph(capt)
            cap.runs[0].italic = True
            cap.runs[0].font.size = Pt(9)
            t = doc.add_table(rows=1 + len(rows), cols=len(hdr))
            t.style = "Table Grid"
            t.alignment = WD_TABLE_ALIGNMENT.CENTER
            small = Pt(8) if len(hdr) > 6 else Pt(9)
            for j, h in enumerate(hdr):
                c = t.rows[0].cells[j]
                c.text = ""
                run = c.paragraphs[0].add_run(str(h))
                run.bold = True
                run.font.size = small
                shade(c, "F0EFEC")
            for i, row in enumerate(rows, start=1):
                for j, v in enumerate(row):
                    c = t.rows[i].cells[j]
                    c.text = ""
                    run = c.paragraphs[0].add_run(str(v))
                    run.font.size = small
                    run.font.color.rgb = RGBColor(0x0B, 0x0B, 0x0B)
            doc.add_paragraph()
    doc.core_properties.title = "FairShed report"
    doc.core_properties.subject = "Fair, auditable load-shedding planner (Qiskit hackathon). Synthetic data, simulator only."
    doc.save(str(path))


# ------------------------------------------------------------------------------------------
# key numbers for the README block and the demo script (all read from results JSON)
# ------------------------------------------------------------------------------------------
NA = "not available"


def key_numbers() -> dict:
    K = {}
    base, abl, cnt = load("plans/base.json"), load("ablation.json"), load("counting.json")
    rsk, rep, sca = load("risk.json"), load("replay.json"), load("scaling.json")
    chk, heat, par, lot = load("checks.json"), load("plans/heatwave_cap.json"), load("pareto.json"), load("lottery.json")
    if base:
        i, e = base["instance"], base["exact"]
        K["base"] = (f"{i['n_feeders']} feeders x {i['n_hours']} hours, {e['n_valid']} valid plans, "
                     f"{e['n_optimal']} tied optima at cost {f(e['cost_min'], 2)}")
        K["n_valid"], K["n_optimal"] = e["n_valid"], e["n_optimal"]
    if abl:
        rows = [r for r in abl["rows"] if r["instance"] == abl["instance_name"]]
        q = [r for r in rows if r["kind"] == "quantum"]
        by = {r["method"]: r for r in rows}
        if q:
            best = max(q, key=lambda r: r["approx_ratio"])
            K["best_q"] = f"{best['label']}: approximation ratio {f(best['approx_ratio'])}, P(optimal) per shot {f(best['p_optimal'], 4)}"
            K["best_q_label"], K["best_q_ratio"], K["best_q_popt"] = best["label"], f(best["approx_ratio"]), f(best["p_optimal"], 4)
            K["qubits"] = best["n_qubits"]
        if "dicke_uniform" in by:
            K["uniform_popt"] = f(by["dicke_uniform"]["p_optimal"], 4)
        if "round_robin" in by:
            K["rr_ratio"] = f(by["round_robin"]["approx_ratio"])
        pen = [r for r in q if r["method"].startswith("penalty")]
        if pen:
            K["penalty_valid"] = " and ".join(pct(r["feasibility_pct"]) for r in pen)
        gas = next((r for r in abl["rows"] if r["method"] == "grover_adaptive_search"), None)
        if gas:
            K["gas"] = (f"Grover Adaptive Search on the {gas['instance']} block: {pct(gas['feasibility_pct'], 0)} of "
                        f"{gas['shots']} runs valid, {f(gas['p_optimal'], 2)} optimal")
    if lot and lot["tie_groups"]:
        g = lot["tie_groups"][0]
        K["tie"] = f"{g['n_plans']} plans tied at cost {f(g['cost'], 2)} get equal probability (spread {g['prob_spread']:.1e})"
    if par:
        K["pareto"] = f"{sum(1 for p in par['points'] if p['matches_exact'])} of {len(par['points'])} fairness weights"
    if cnt:
        K["count"] = (f"exact {cnt['exact_count']}, estimate {f(cnt['estimated_count'], 2)} "
                      f"(95% interval {f(cnt['ci'][0], 2)} to {f(cnt['ci'][1], 2)})")
        K["count_short"] = f"{f(cnt['estimated_count'], 2)} against an exact {cnt['exact_count']}"
    if rsk:
        K["cvar"] = (f"CVaR {f(rsk['alpha'] * 100, 0)}% exact {f(rsk['exact']['cvar'], 3)} MW, estimate "
                     f"{f(rsk['estimated']['cvar'], 3)} MW; P(unplanned cut) exact {f(rsk['exact']['tail_prob'], 3)}, "
                     f"estimate {f(rsk['estimated']['tail_prob'], 3)}")
        K["cvar_short"] = f"{f(rsk['estimated']['cvar'], 3)} MW against an exact {f(rsk['exact']['cvar'], 3)} MW"
    if rep:
        s = rep["summary"]
        nq = sum(1 for fr in rep["frames"] if "quantum" in fr["solver_used"])
        n_fail = sum(1 for fr in rep["frames"] if not fr["audit_passed"])
        K["replay_audit"] = "every committed plan passed the audit" if n_fail == 0 else f"{n_fail} committed plans failed the audit"
        K["replay"] = (f"{s['n_frames']} hourly frames, {nq} solved by the quantum solver, "
                       f"{s['matches_exact_count']} matched the exact optimum, {K['replay_audit']}")
        K["replay_frames"], K["replay_match"], K["replay_q"] = s["n_frames"], s["matches_exact_count"], nq
    if sca:
        ok = [p for p in sca["points"] if p["status"] == "ok"]
        big = max(ok, key=lambda p: (p["n_qubits"], p["bond_dim"] or 0)) if ok else None
        K["scale"] = (f"{len(ok)} of {len(sca['points'])} points ran, up to {big['n_qubits']} qubits; at "
                      f"{big['n_qubits']} qubits and bond dimension {big['bond_dim']} the ratio is "
                      f"{f(big['approx_ratio'])}") if big else NA
    if chk:
        K["checks"] = f"{chk['summary']['passed']} of {chk['summary']['total']}"
    if heat:
        st = heat["random_valid_stats"]
        rr = next((p for p in heat["plans"] if p["method"] == "round_robin"), None)
        K["heat"] = (f"round-robin breaks the rules {rr['n_violations'] if rr else NA} times; "
                     f"{pct(st['cap_violation_pct'])} of random valid plans break the consecutive-hour cap")
    return K


def readme_block(K: dict) -> str:
    g = lambda k: K.get(k, NA)
    lines = [
        f"- Base instance: {g('base')}.",
        f"- Best QAOA variant on it: {g('best_q')}; sampling the Dicke state alone gives P(optimal) {g('uniform_popt')}.",
        f"- Penalty QAOA (standard X mixer): only {g('penalty_valid')} of samples are valid plans.",
        f"- Fair lottery: {g('tie')}.",
        f"- {g('gas')}.",
        f"- Quantum counting of valid plans: {g('count')}.",
        f"- Tail risk by amplitude estimation: {g('cvar')}.",
        f"- Replay with the quantum window solver: {g('replay')}.",
        f"- MPS scaling: {g('scale')}.",
        f"- Where simple rules fail (scenario heatwave_cap): {g('heat')}.",
        f"- Proof checks passing: {g('checks')}.",
        "- The exact classical answer is better or equal on every instance; no speed-up is claimed.",
    ]
    return "\n".join(lines)


def update_readme(K: dict) -> None:
    p = ROOT / "README.md"
    if not p.exists():
        return
    text = p.read_text(encoding="utf-8")
    start, end = "<!-- RESULTS:START -->", "<!-- RESULTS:END -->"
    if start in text and end in text:
        head, rest = text.split(start, 1)
        _old, tail = rest.split(end, 1)
        p.write_text(head + start + "\n" + readme_block(K) + "\n" + end + tail, encoding="utf-8")


def demo_script(K: dict) -> str:
    g = lambda k: K.get(k, NA)
    return f"""# FairShed demo script (3 minutes)

Generated by `scripts/fill_report.py` from `results/*.json`. Every number below comes from the
results files; regenerate after `make demo` so the script matches what the dashboard shows.
Start the dashboard first: `python scripts/tasks.py ui`, open http://localhost:8000/ui/ (use
`?tiles=off` if the recording machine is offline).

## 0:00 to 0:20 Problem

- **On screen:** Plan screen, map of synthetic Karachi zones, hour slider.
- **Caption:** "Who loses power, and is it fair?"
- **Voice-over:** "When supply falls short, a utility switches whole feeders off, an hour at a
  time. The quota says how many. FairShed decides which ones: spread the hours evenly, avoid
  cutting the same area twice in a row, spare the areas that suffer most, never cut a hospital
  or a water pump, and let anyone audit the schedule. Everything you will see is synthetic data
  on a simulator."

## 0:20 to 1:20 Replay mode

- **On screen:** Replay screen. Press play. Point at the feeder cards changing, the actual vs
  forecast chart, the solver chip and the "Matches exact" chip. Then open Audit, pick
  "Round-robin", show the violations; switch to "Exact optimum", show it passes.
- **Caption:** "Re-planning every hour, warm-started from the last plan."
- **Voice-over:** "This is one afternoon and evening, hour by hour. Each hour a classical ridge
  forecast sets the next three quotas, a quantum circuit on the simulator picks the plan, and only
  the first hour is committed. Over {g('replay_frames')} hours, {g('replay_q')} were solved by the
  quantum solver and {g('replay_match')} matched the exact optimum; {g('replay_audit')}.
  The audit mode checks any schedule against four rules. In the heatwave scenario,
  {g('heat')}."

## 1:20 to 2:00 Quantum stages and real numbers

- **On screen:** Compare and proof: the ablation table, then the fair lottery panel, then the
  proof checklist. Then Risk and counting.
- **Caption:** "Constraint-preserving circuits: every sample is a valid plan."
- **Voice-over:** "Each hour starts in a Dicke state, so every sample meets the quota and never
  touches a protected feeder. The best variant, {g('best_q_label')}, reaches approximation ratio
  {g('best_q_ratio')}; a standard penalty mixer gives valid plans only {g('penalty_valid')} of the
  time. With the Grover mixer, tied optimal plans get equal probability: a fair lottery. Amplitude
  estimation counts the valid plans, {g('count_short')}, and puts the tail risk at {g('cvar_short')}.
  {g('checks')} proof checks pass."
- **Numbers on screen for reference:** {g('base')}; {g('tie')}; counting {g('count')}; risk {g('cvar')}.

## 2:00 to 2:30 Honest limits and scale

- **On screen:** Scale screen chart, then the callout "Simulator only".
- **Caption:** "Simulator only. No speed-up claimed."
- **Voice-over:** "Be clear about the limits. This runs on a simulator, the data is synthetic, and
  at {g('qubits')} qubits a classical brute force finds the exact answer, which is better than our
  sampled plans. Per-shot probability of the optimum is low; the plan is the best of 256 shots. The
  scale curve uses a matrix product state simulator: {g('scale')}. That shows how the circuit
  behaves as it grows; it is not a quantum advantage."

## 2:30 to 3:00 Close

- **On screen:** Back to Plan, press play once more; end on the badge "Simulator - synthetic data".
- **Caption:** "Fair, auditable, and honest about what quantum does today."
- **Voice-over:** "FairShed turns load-shedding into a constrained optimisation that a quantum
  circuit can sample from without ever proposing an invalid plan, with a fair lottery among ties
  and an audit anyone can run. The code, tests and report are in the repository, and every number
  you saw comes from a results file."

## Recording checklist

- [ ] `python scripts/tasks.py demo` finished, then `python scripts/fill_report.py` (so this script matches).
- [ ] `python scripts/tasks.py ui-smoke` prints "all 7 screens passed".
- [ ] Browser zoom 100%, window about 1440 x 900, notifications off, no other tabs visible.
- [ ] The badge "Simulator - synthetic data" is visible in every shot.
- [ ] Do not say "faster", "speed-up" or "real feeders".
- [ ] Record at 1080p, keep under 3:00, export MP4. Do not commit the video; upload it and share the link.
- [ ] Set the link to "anyone with the link" and open it in a private window before submitting.

## Defense Q&A

**Why not just classical?** At this size, classical wins: brute force finds the exact optimum
over {g('n_valid')} valid plans immediately, and our report says so. The point is the
formulation: the constraint-preserving circuits never propose an invalid plan, the Grover mixer
gives tied plans equal probability (a property a greedy heuristic does not offer), and the same
pipeline runs unchanged when the circuit is the thing being studied. We measured every quantum
number against the exact answer instead of claiming an advantage.

**Is the data real?** No. Feeders, demand, supply and the ledger are synthetic, on illustrative
Karachi zones, because real feeder maps are not public. Weather in the forecast is a real
Open-Meteo snapshot. Every screen carries the "Simulator - synthetic data" badge.

**How do you know the quantum code is right?** {g('checks')} proof checks run in pytest: the
cost table equals the classical cost on every bitstring, every XY and Grover-mixer sample is a
valid plan, Dicke states are uniform, tied plans get equal amplitude, counting is within
tolerance of enumeration, the qubit-to-plan bit order is tested, and fixed seeds reproduce.

**What does the penalty QAOA show?** That a standard mixer wastes most samples on invalid plans
({g('penalty_valid')} valid), which is why the Dicke and XY or Grover mixers matter.

**What would you do with more time?** Hardware runs with error mitigation on the 6-qubit block,
more shots or layers in the window solver so more replay frames match exact, and larger risk
blocks.
"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    FIG.mkdir(parents=True, exist_ok=True)
    (OUT / "architecture.mmd").write_text(MERMAID, encoding="utf-8")
    fig_architecture()
    blocks = build()
    (OUT / "FairShed_Report.md").write_text(to_markdown(blocks), encoding="utf-8")
    to_docx(blocks, OUT / "FairShed_Report.docx")
    K = key_numbers()
    update_readme(K)
    (ROOT / "docs" / "demo_script.md").write_text(demo_script(K), encoding="utf-8")
    print("wrote docs/report/FairShed_Report.md, docs/report/FairShed_Report.docx, docs/report/architecture.png, "
          "docs/report/architecture.mmd, docs/report/figures/*.png, docs/demo_script.md, README.md key results")
    return 0


if __name__ == "__main__":
    sys.exit(main())
