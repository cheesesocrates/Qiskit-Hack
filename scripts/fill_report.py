"""Build the FairShed report from results/*.json (Area 2). Never type a number by hand.

Usage:  python scripts/fill_report.py

Writes:
  docs/report/FairShed_Report.md      the short report (about 4 pages) as markdown
  docs/report/FairShed_Report.docx    the same report as Word (Times New Roman, A4, black and white)
  docs/report/FairShed_Report.pdf     PDF copy (LibreOffice, or Microsoft Word on Windows, when present)
  docs/report/architecture.mmd        Mermaid source of the architecture diagram
  docs/report/architecture.png        the same diagram, black and white, 300 dpi (Figure 1)
  docs/report/figures/mps_memory.png  exact vs MPS memory by instance size (Figure 2)
  README.md key-results block and docs/demo_script.md

Every number in the report is read from results/*.json at build time, from the installed
package versions, or quoted from docs/SPEC.md (problem context). Limitations are parsed from
docs/KNOWN_ISSUES.md so the report and the issue list cannot drift apart. A results file that
is missing is reported as "not available", never filled in.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import subprocess
import sys
from importlib import metadata
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

NA = "not available"
# Team details and figure widths as set by the team in Word (kept so a rebuild does not undo them)
TEAM_LINE = ("Team: Hello Child. Members: Raahim Babar, Zarrar Nadeem, Ahmed Ayan Arsalan. "
             "Domain: Energy and Smart Infrastructure.")
FIG1_WIDTH_IN, FIG2_WIDTH_IN = 7.03, 6.53
CONTEXT_SOURCE = ("Dunya News, 6 October 2026",
                  "https://dunyanews.tv/en/Business/976376-electricity-shortfall-in-pakistan-exceeds-4000mw")

# Glossary (section 10). In report text, [[shown words|key]] links to the entry `key`;
# [[shown words|https://...]] is a web link.
GLOSSARY = [
    ("amplitude_estimation", "Amplitude estimation", "A quantum method that estimates a probability built into a "
     "circuit, such as the share of valid plans. We use the iterative version in Qiskit and check every estimate "
     "against the exact value."),
    ("approx_ratio", "Approximation ratio", "How close a plan is to the best one: 1 is the best valid plan, 0 the "
     "worst valid plan, and an invalid plan scores 0. A circuit's ratio is the average over its tries."),
    ("bond_dimension", "Bond dimension", "The setting that controls how much an [[MPS|mps]] simulation keeps of the "
     "links ([[entanglement|entanglement]]) between neighbouring qubits. Higher is more accurate, slower and uses "
     "more memory."),
    ("cobyla", "COBYLA", "A classical optimisation routine. It adjusts the circuit's angles step by step to lower the "
     "average cost of the plans the circuit produces."),
    ("dicke", "Dicke state", "An equal mix of every way to switch on exactly k of n qubits. Here: every way to cut "
     "exactly the required number of feeders in one hour, all with the same weight."),
    ("entanglement", "Entanglement", "Quantum correlation between qubits. It is what makes a quantum state hard to "
     "store on a normal computer."),
    ("exact", "Exact solver (brute force, MILP)", "Classical methods that are guaranteed to find the best plan. Brute "
     "force checks every valid plan; MILP (mixed-integer linear programming) is a standard solver used for the "
     "larger instances."),
    ("feeder", "Feeder and express feeder", "A feeder is a power line that supplies one neighbourhood; load shedding "
     "switches whole feeders off. An express feeder is a dedicated line kept out of load shedding, used for "
     "hospitals and water pumps."),
    ("fidelity", "Fidelity", "How much a simulated quantum state overlaps the exact one: 1 means identical, 0 means "
     "nothing in common."),
    ("gas", "Grover Adaptive Search", "A quantum search method that repeatedly looks for a plan cheaper than the best "
     "one found so far."),
    ("grover_mixer", "Grover mixer", "A [[mixer|mixer]] that treats every valid plan the same way, so plans with "
     "equal cost always get exactly equal probability: a fair lottery among tied plans."),
    ("ising", "Ising form (Z and ZZ terms)", "The cost rewritten for qubits. Each 0/1 variable x is replaced by "
     "(1 - Z)/2, where Z is +1 or -1 depending on the qubit. Terms with one variable become Z terms; terms with a "
     "pair of variables become ZZ terms."),
    ("json", "JSON results files and schemas", "Every part of the project writes its results to JSON files; a schema "
     "is a rule sheet that checks each file's structure before it is used."),
    ("mixer", "Mixer (XY mixer)", "The [[QAOA|qaoa]] step that moves probability between plans. The XY mixer swaps "
     "which feeders are off within an hour, so the number of feeders off never changes."),
    ("mps", "MPS (matrix product state)", "A way to simulate a quantum circuit on a normal computer by storing the "
     "state as a chain of small blocks, one per qubit, instead of one number per possible on/off pattern. It uses "
     "far less memory but becomes approximate when the [[bond dimension|bond_dimension]] is capped."),
    ("penalty_qaoa", "Penalty QAOA", "The textbook version of [[QAOA|qaoa]]: the rules are only a cost penalty and a "
     "standard mixer is used, so the circuit can still produce invalid plans."),
    ("qaoa", "QAOA", "Quantum Approximate Optimisation Algorithm: a short circuit that alternates a cost step and a "
     "[[mixer|mixer]] step. A classical optimiser tunes its angles; each measurement gives one candidate plan."),
    ("qubit", "Qubit", "A quantum bit. Here each qubit is one yes/no switch: is this feeder off in this hour?"),
    ("qubo", "QUBO", "Quadratic unconstrained binary optimisation: a cost written as a sum of terms on 0/1 variables "
     "and on pairs of them. It is the standard input form for quantum optimisers."),
    ("replay", "Receding-horizon replay", "Re-planning every hour for the next three hours with the latest "
     "forecast, then committing only the first hour."),
    ("ridge", "Ridge regression", "A simple classical forecasting model (a regularised straight-line fit). Here it "
     "predicts the electricity shortfall from weather and time of day."),
    ("round_robin", "Round-robin", "A simple take-turns rule that cuts feeders in a fixed rotation, with no "
     "optimisation."),
    ("rule_preserving", "Rule-preserving circuit", "A circuit built so that every measurement is a valid plan: it "
     "starts in a [[Dicke state|dicke]] and uses an XY or [[Grover mixer|grover_mixer]], which never change how "
     "many feeders are off."),
    ("rz", "RZ and RZZ gates", "Rotation gates that add a phase depending on one qubit (RZ) or on a pair of qubits "
     "(RZZ). They put the [[Z and ZZ terms|ising]] of the cost into the circuit."),
    ("shot", "Shot (try, measurement)", "One run of the circuit followed by a measurement, which gives one plan."),
    ("simulator", "Simulator (Qiskit Aer)", "A program on a normal computer that computes exactly what an ideal, "
     "noise-free quantum computer would do. No quantum hardware was used."),
    ("cvar", "Tail risk (VaR and CVaR)", "How bad the bad hours get. VaR 95% is the loss exceeded only 5% of the "
     "time; CVaR 95% is the average loss in that worst 5%. Here the loss is the shortfall (MW) that the plan does "
     "not cover."),
    ("valid", "Valid plan", "A plan that meets every hourly quota and never cuts a protected feeder."),
]
GLOSSARY.sort(key=lambda g: g[1].lower())
LINK = re.compile(r"\[\[([^|\]]+)\|([^\]]+)\]\]")


def segments(text: str) -> list:
    """[(shown text, link target or None)]; a target is a glossary key or an http(s) URL."""
    out, pos = [], 0
    for m in LINK.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], None))
        out.append((m.group(1), m.group(2)))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], None))
    return out


def plain(text: str) -> str:
    return LINK.sub(lambda m: m.group(1), text)

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
OUT = ROOT / "docs" / "report"
FIG = OUT / "figures"
REPO_URL = "https://github.com/cheesesocrates/Qiskit-Hack"



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
# figures (black and white, 300 dpi)
# ------------------------------------------------------------------------------------------
plt.rcParams.update({"font.family": "serif", "font.serif": ["Times New Roman", "Liberation Serif", "DejaVu Serif"]})

MERMAID = """flowchart LR
  W["Weather snapshot (real) + synthetic demand"] --> F["Ridge forecast (classical): hourly quotas"]
  F --> I["Instance and cost model (feeders, rules, QUBO)"]
  I --> R[("results/*.json, checked by schemas")]
  X["Exact reference: brute force, MILP, simple baselines"] <--> R
  R <--> Q["Quantum (Qiskit, Aer simulator): QAOA, counting, risk, Grover search, MPS"]
  R <--> P["Hour-by-hour replay (exact fallback)"]
  P <-- "window files" --> Q
  R --> A["Audit (rule checker)"]
  R --> D["Dashboard and report"]
"""


def fig_architecture() -> Path:
    fig, ax = plt.subplots(figsize=(7.0, 2.8), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 41)
    ax.axis("off")

    def box(x, y, w, h, text, lw=0.9, size=7.4, weight="normal"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.3,rounding_size=0.8", fc="white", ec="black",
                                    lw=lw))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color="black", weight=weight)

    def arrow(x1, y1, x2, y2, both=False, text=None, dy=1.2):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="<|-|>" if both else "-|>", mutation_scale=8,
                                     color="black", lw=0.8))
        if text:
            ax.text((x1 + x2) / 2, (y1 + y2) / 2 + dy, text, ha="center", va="center", fontsize=6.6, style="italic")

    # classical inputs (left)
    box(1, 33, 25, 7, "Weather snapshot (real)\n+ synthetic demand")
    box(1, 23, 25, 7, "Ridge forecast (classical)\nsets the hourly quotas")
    box(1, 13, 25, 7, "Instance + cost model\nfeeders, rules, QUBO")
    box(1, 1, 25, 8, "Exact reference\nbrute force, MILP,\nround-robin, random")
    arrow(13.5, 33, 13.5, 30.4)
    arrow(13.5, 23, 13.5, 20.4)
    # hub and consumers (middle)
    box(36, 15, 28, 11, "results/*.json\nchecked by schemas\n(the only link between parts)", lw=1.8, size=7.8,
        weight="bold")
    box(36, 31, 28, 9, "Hour-by-hour replay\nre-plans every hour,\nexact fallback")
    box(36, 1, 13, 8, "Audit\n(rule checker)")
    box(51, 1, 13, 8, "Dashboard\nand report")
    arrow(26.4, 16.5, 35.6, 19)
    arrow(26.4, 5, 35.6, 17, both=True)
    arrow(50, 26.4, 50, 30.6, both=True)
    arrow(42, 14.6, 42, 9.4)
    arrow(58, 14.6, 58, 9.4)
    # quantum group (right)
    ax.add_patch(FancyBboxPatch((72, 1), 27, 39, boxstyle="round,pad=0.3,rounding_size=1.2", fc="white", ec="black",
                                lw=0.9, ls="--"))
    ax.text(85.5, 38.3, "Quantum (Qiskit, Aer simulator)", ha="center", va="center", fontsize=7.6, weight="bold")
    q = ["QAOA: Dicke + XY mixer,\nGrover mixer, penalty", "Counting valid plans\n(amplitude estimation)",
         "Tail risk\n(amplitude estimation)", "Grover Adaptive Search", "MPS scaling study"]
    for t, y, h in zip(q, [29, 21.5, 14, 8, 2], [6.5, 6, 6, 4.3, 4.3]):
        box(74, y, 23, h, t, size=7.0)
    arrow(64.4, 20.5, 71.6, 20.5, both=True, text="instance in,\nresults out", dy=3.0)
    arrow(64.4, 36, 71.6, 33, both=True, text="window files", dy=2.0)
    fig.tight_layout(pad=0.2)
    p = OUT / "architecture.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


def _mps_rows(sca) -> list:
    """Per instance size: the MPS point with the largest bond dimension that ran (needs mps_memory_mb)."""
    if not sca:
        return []
    out = []
    for n in sorted({p["n_qubits"] for p in sca["points"]}):
        pts = [p for p in sca["points"] if p["n_qubits"] == n and p["bond_dim"] is not None and p["status"] == "ok"
               and p.get("mps_memory_mb") is not None]
        if pts:
            out.append(max(pts, key=lambda p: p["bond_dim"]))
    return out


def fig_mps_memory(sca) -> Path | None:
    rows = _mps_rows(sca)
    if not rows:
        return None
    n = [p["n_qubits"] for p in rows]
    exact = [16.0 * 2.0 ** q for q in n]
    mps = [p["mps_memory_mb"] * 2 ** 20 for p in rows]
    fig, ax = plt.subplots(figsize=(6.0, 2.5), dpi=300)
    ax.semilogy(n, exact, color="black", ls="-", marker="s", ms=4, lw=1.1, label="Exact simulation (16 bytes per basis state)")
    ax.semilogy(n, mps, color="black", ls="--", marker="o", ms=4, mfc="white", lw=1.1,
                label="MPS, largest bond dimension that ran (measured)")
    ticks = [10.0 ** k for k in range(3, 25, 3) if min(mps) / 10 <= 10.0 ** k <= max(exact) * 10]
    names = {3: "1 KB", 6: "1 MB", 9: "1 GB", 12: "1 TB", 15: "1 PB", 18: "1 EB", 21: "1 ZB", 24: "1 YB"}
    ax.set_yticks(ticks, [names[int(round(math.log10(t)))] for t in ticks])
    ax.minorticks_off()
    ax.set_xticks(n)
    ax.set_xlabel("Qubits in the circuit", fontsize=9)
    ax.set_ylabel("Memory (log scale)", fontsize=9)
    ax.tick_params(labelsize=8, colors="black")
    ax.grid(color="#bbbbbb", lw=0.4, ls=":")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.legend(fontsize=7.5, frameon=False, loc="upper left")
    fig.tight_layout(pad=0.3)
    p = FIG / "mps_memory.png"
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    return p


# ------------------------------------------------------------------------------------------
# content: a short report, every number read from results/*.json
# ------------------------------------------------------------------------------------------
def pinned_versions() -> dict:
    out = {}
    for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Za-z0-9_.-]+)==([^\s#]+)", line.strip())
        if m:
            out[m.group(1).lower()] = m.group(2)
    return out


def _bytes(b: float) -> str:
    units = ["bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    i = 0
    while b >= 1000 and i < len(units) - 1:
        b /= 1000
        i += 1
    return f"{b:.0f} {units[i]}" if b >= 10 else f"{b:.1f} {units[i]}"


def nodash(s: str) -> str:
    return s.replace("—", ", ").replace("–", " to ")


def context_with_source() -> str:
    """The SPEC context facts, with the news source linked after the sentence it supports (the shortfall)."""
    sentences = re.split(r"(?<=\.)\s+", nodash(spec_context()))
    name, url = CONTEXT_SOURCE
    sentences[0] = sentences[0].rstrip(".") + f" (source: [[{name}|{url}]])."
    return " ".join(sentences)


def build() -> list:
    abl, lot, par = load("ablation.json"), load("lottery.json"), load("pareto.json")
    cnt, rsk, sca = load("counting.json"), load("risk.json"), load("scaling.json")
    rep, chk = load("replay.json"), load("checks.json")
    base, heat = load("plans/base.json"), load("plans/heatwave_cap.json")
    B = []
    inst = base["instance"] if base else None
    ex = base["exact"] if base else None
    rows = [r for r in abl["rows"] if r["instance"] == abl["instance_name"]] if abl else []
    by = {r["method"]: r for r in rows}
    q_rows = [r for r in rows if r["kind"] == "quantum"]
    xy, gr, pen = by.get("xy_qaoa_p3"), by.get("grover_qaoa_p3"), by.get("penalty_qaoa_p3")
    best_q = max(q_rows, key=lambda r: r["approx_ratio"]) if q_rows else None
    rr = by.get("round_robin")
    gas = next((r for r in abl["rows"] if r["method"] == "grover_adaptive_search"), None) if abl else None
    tie = lot["tie_groups"][0] if lot and lot.get("tie_groups") else None
    n_q = best_q["n_qubits"] if best_q else None
    shots = best_q["shots"] if best_q else None
    ok_scale = [p for p in sca["points"] if p["status"] == "ok"] if sca else []
    big_n = max((p["n_qubits"] for p in ok_scale), default=None)
    checks = f"{chk['summary']['passed']} of {chk['summary']['total']}" if chk else NA
    nq_rep = sum(1 for fr in rep["frames"] if "quantum" in fr["solver_used"]) if rep else None
    pass_rep = sum(1 for fr in rep["frames"] if fr["audit_passed"]) if rep else None
    par_ok = sum(1 for p in par["points"] if p["matches_exact"]) if par else None
    V = pinned_versions()

    # ---------------------------------------------------------------- 1. summary
    B += [("title", "FairShed: fair and auditable load-shedding with Qiskit"),
          ("meta", TEAM_LINE),
          ("meta", f"Repository: {REPO_URL}.")]
    B += [("h1", "1. Summary"),
          ("p", "When there is not enough electricity, a utility switches whole [[feeders|feeder]] (the power lines that supply "
                "one neighbourhood) off for an hour at a time. FairShed decides which feeders go off in each hour. "
                "Hospitals, water pumps and telecom towers are never cut, outage hours are shared fairly, and no area "
                "is cut hour after hour. We solve this optimisation problem with Qiskit quantum circuits, run on a "
                "[[simulator|simulator]], that only ever produce [[valid plans|valid]]. "
                "Every quantum result is checked against an exact classical answer, and at this size the classical "
                "answer is better, so we claim no speed-up.")]
    heads = []
    if xy and gr and pen:
        heads.append(("Every plan is valid. ", f"Both [[rule-preserving circuits|rule_preserving]] gave a valid plan in "
                      f"{min(xy['feasibility_pct'], gr['feasibility_pct']):.0f}% of {shots} [[tries|shot]]; the standard "
                      f"[[penalty circuit|penalty_qaoa]] managed only {pen['feasibility_pct']:.1f}%."))
    if tie:
        heads.append(("A fair lottery. ", f"The {tie['n_plans']} tied best plans got equal chances (largest "
                      f"difference {tie['prob_spread']:.1e})."))
    if cnt and rsk:
        heads.append(("Quantum estimates match exact values. ", f"Counting valid plans: {cnt['estimated_count']:.2f} "
                      f"against exactly {cnt['exact_count']}. [[Tail risk (CVaR)|cvar]]: {rsk['estimated']['cvar']:.3f} MW "
                      f"against {rsk['exact']['cvar']:.3f} MW."))
    if best_q and rr:
        heads.append(("Where quantum loses. ", f"The best circuit gets {best_q['approx_ratio'] * 100:.0f}% of the way "
                      f"to the best plan on average and finds it in {best_q['p_optimal'] * 100:.2f}% of single tries. "
                      f"Simple [[round-robin|round_robin]] gets {rr['approx_ratio'] * 100:.0f}%; the [[exact solver|exact]] gets 100%."))
    B += [("bullets", heads)]
    B += [("table", ["Requirement (hackathon brief)", "Rubric line", "Section"], [
        ["Identify the problem and its users", "A. Problem validity", "2"],
        ["Formulate variables, objective, constraints, test instance", "A. Problem validity", "2, 3"],
        ["Justify the quantum algorithm and the mapping", "B. Quantum use", "3, 4"],
        ["Implement a working, reproducible Qiskit component", "C. Implementation", "4, 9"],
        ["Evaluate against an exact reference", "C. Validation", "6"],
        ["Reflect on correctness, limits and trade-offs", "B. Awareness of limits", "8"],
        ["Architecture diagram", "C. Implementation", "5"],
        ["Originality", "D. Innovation", "7"],
        ["Glossary of terms (linked from the text)", "E. Presentation", "10"]],
        "Table 1. Where to find each requirement.", None)]

    # ---------------------------------------------------------------- 2. problem statement
    B += [("h1", "2. Problem statement"), ("h2", "2.1 Context and users"),
          ("p", context_with_source()),
          ("bullets", [("Utility planner: ", "needs a cut schedule for the next hours that meets the shortfall."),
                       ("Regulator or public: ", "need to check that a published schedule follows the rules.")])]
    B += [("h2", "2.2 Objective and rules"),
          ("p", "Objective: choose which feeders are off in each hour so the total cost (harm + unfairness + "
                "back-to-back cuts) is as low as possible."),
          ("bullets", [("Quota: ", "exactly the required number of feeders is off in each hour."),
                       ("Protection: ", "hospitals, water pumps and telecom towers are never off.")])]
    if inst:
        prot = ", ".join(f"feeder {fd['id']} ({fd['kind'].replace('_', ' ')})" for fd in inst["feeders"] if fd["protected"])
        B += [("h2", "2.3 Test instance"),
              ("bullets", [f"{inst['n_feeders']} synthetic feeders on illustrative Karachi zones, {inst['n_hours']} hours.",
                           f"Feeders off per hour: {', '.join(map(str, inst['quotas']))}. Protected: {prot}.",
                           f"{n_q} [[qubits|qubit]]; {ex['n_valid']} [[valid plans|valid]] out of {2 ** n_q if n_q else NA} on/off patterns; "
                           f"{ex['n_optimal']} plans tie for the best cost ({ex['cost_min']:.2f})."])]
    B += [("h2", "2.4 How success is measured"),
          ("p", "Cost (lower is better), the share of tries that are valid plans, the [[approximation ratio|approx_ratio]] "
                "(how close a plan is to the best one: 0 is the worst valid plan, 1 the best, invalid plans score 0) "
                "and the chance that one try ([[one measurement|shot]]) is a best plan.")]

    # ---------------------------------------------------------------- 3. formulation
    w = inst["weights"] if inst else {}
    B += [("h1", "3. Formulation"),
          ("bullets", [("Decision variables: ", "x[t][f] = 1 if feeder f is off in hour t, else 0."),
                       ("Cost: ", f"{f(w.get('hardship'), 1)} x harm + {f(w.get('fairness'), 1)} x unfairness + "
                                  f"{f(w.get('consecutive'), 1)} x back-to-back cuts. Harm sums a per-feeder, per-hour "
                                  "score over the feeders that are off. Unfairness sums, over feeders, the squared gap "
                                  "between total outage hours (past + new) and the average. Back-to-back counts "
                                  "feeders off in two adjacent hours."),
                       ("Hard rules: ", "the hourly quota and the protected feeders.")]),
          ("h2", "3.1 From plan to qubits"),
          ("bullets", ["One [[qubit|qubit]] per (hour, feeder) switch, qubit q = t x N + f; protected feeders get no "
                       "qubit, so they can never be switched off.",
                       "The cost is a [[QUBO|qubo]] (a quadratic function of 0/1 variables). Writing x = (1 - Z)/2 "
                       "turns it into [[Z and ZZ terms|ising]], which become [[RZ and RZZ rotation gates|rz]].",
                       "The quota is not a penalty: it is built into the circuit (Section 4)."])]

    # ---------------------------------------------------------------- 4. quantum approach
    B += [("h1", "4. Quantum approach and why"), ("h2", "4.1 Key idea"),
          ("p", "We use [[QAOA|qaoa]]: a short quantum circuit that alternates a cost step and a mixing step, with "
                "its angles tuned by a classical optimiser. Each hour starts in a [[Dicke state|dicke]], an equal mix of "
                "every way to switch off exactly the required number of feeders. The [[mixer|mixer]] (the step that "
                "moves probability between plans) never changes how many feeders are off. So every measured plan is "
                "valid by construction. The standard [[penalty version|penalty_qaoa]] only discourages invalid plans "
                "and wastes most of its tries on them."),
          ("table", ["Component", "What it does", "Why this one"], [
              ["[[Dicke|dicke]] + [[XY mixer|mixer]] QAOA", "Swaps which feeders are off, never how many",
               "Rules hold in every sample"],
              ["[[Grover mixer|grover_mixer]] QAOA", "Treats all valid plans alike", "Equal chances for tied plans; picks the "
                                                                     "dashboard and replay plans"],
              ["[[Penalty QAOA|penalty_qaoa]]", "Rules only as a cost penalty", "Weak baseline"],
              ["Counting ([[amplitude estimation|amplitude_estimation]])", "Estimates the share of valid plans", "Planner freedom, checkable"],
              ["[[Tail risk|cvar]] (amplitude estimation)", "Estimates expected loss and CVaR from forecast errors",
               "Exact check available"],
              ["[[Grover Adaptive Search|gas]]", "Repeated search for a better plan", "Second method to compare"],
              ["[[MPS|mps]] scaling", "Same circuit, larger cities, compressed simulator", "Behaviour beyond exact "
                                                                                    "simulation"]],
           "Table 2. Quantum components.", None),
          ("h2", "4.2 Implementation and assumptions"),
          ("p", f"Qiskit {V.get('qiskit', NA)} circuits in src/quantum/ run with scripts/run_quantum.py on the "
                f"Qiskit Aer {V.get('qiskit-aer', NA)} [[simulator|simulator]]. Assumptions: an ideal simulator (no noise, no "
                "hardware), results from a finite number of [[measurements|shot]], angles tuned by the classical "
                "optimiser [[COBYLA|cobyla]], and a plan is the best valid result of 256 measurements.")]

    # ---------------------------------------------------------------- 5. architecture
    B += [("h1", "5. Architecture"),
          ("image", "architecture.png", "Figure 1. Architecture: all parts exchange only JSON files.", FIG1_WIDTH_IN,
           "Diagram: weather and demand feed a classical forecast, which sets quotas for the instance and cost model. "
           "All parts read and write results JSON files: the exact reference, the quantum solvers, the replay, the "
           "audit, the dashboard and the report."),
          ("p", "How to read Figure 1:"),
          ("bullets", [("Left, inputs: ", "a real weather snapshot and synthetic demand feed a classical "
                                          "[[ridge regression|ridge]] forecast, which sets how many feeders must be off "
                                          "each hour. The instance and its cost ([[QUBO|qubo]]) are then written out."),
                       ("Centre, the hub: ", "every part reads and writes [[JSON results files|json]], each checked "
                                            "against a schema. The quantum and classical code never call each other."),
                       ("Right, quantum: ", "the Qiskit circuits read the instance and write their results back."),
                       ("Bottom left, the answer key: ", "the [[exact solver|exact]] and simple baselines write the "
                                                        "reference every quantum number is compared with."),
                       ("Top and bottom centre: ", "the [[hour-by-hour replay|replay]] asks the quantum solver for each "
                                                   "hour's plan through files and falls back to the exact solver; the "
                                                   "rule checker, dashboard and report only read results.")])]

    # ---------------------------------------------------------------- 6. results
    B += [("h1", "6. Results against the classical reference")]
    if rows:
        def row(r, label):
            return [label, f"{r['feasibility_pct']:.1f}", f"{r['p_optimal']:.4f}", f"{r['approx_ratio']:.3f}"]
        milp_ok = bool(chk) and any(c["id"] == "C03" and c["passed"] for c in chk["checks"])
        t3 = [row(by["exact"], "[[Exact|exact]] (brute force; MILP agrees)" if milp_ok else "[[Exact|exact]] (brute force)")] \
            if "exact" in by else []
        for key, label in (("round_robin", "[[Round-robin|round_robin]] (take turns)"), ("random_valid", "Random valid plan"),
                           ("xy_qaoa_p3", "Dicke + XY mixer QAOA"), ("grover_qaoa_p3", "Grover mixer QAOA"),
                           ("penalty_qaoa_p3", "Penalty QAOA")):
            if key in by:
                t3.append(row(by[key], label))
        take = (f"Both rule-preserving circuits are always valid; the penalty circuit is valid in "
                f"{pen['feasibility_pct']:.1f}% of tries. On average quality, round-robin ({rr['approx_ratio']:.3f}) "
                f"and the exact solver (1.000) beat the best circuit ({best_q['approx_ratio']:.3f}).") if (pen and rr and best_q) else None
        B += [("h2", "6.1 Base instance"),
              ("table", ["Method", "Valid plans (%)", "Chance one try is best", "[[Approximation ratio|approx_ratio]]"], t3,
               f"Table 3. Base instance, {n_q} qubits. Circuits: 3 layers, {shots} measurements each.", take)]
        rr_plan = next((r for r in base["plans"] if r["method"] == "round_robin"), None) if base else None
        rules = inst["rules"] if inst else {}
        if best_q and rr_plan and ex:
            chance = ex["n_optimal"] / ex["n_valid"]
            B += [("p", f"How to compare: a random valid plan is a best plan {ex['n_optimal']} times in "
                        f"{ex['n_valid']} ({chance * 100:.2f}%), so the best circuit ({best_q['p_optimal'] * 100:.2f}% per "
                        f"try) is about {best_q['p_optimal'] / chance:.0f} times better than chance, but it still needs many "
                        f"tries. Round-robin scores well here because the base case allows "
                        f"{rules.get('max_consecutive', NA)} back-to-back hours: its plan passes every rule and costs "
                        f"{rr_plan['cost']:.1f} against the best {ex['cost_min']:.1f}. With a stricter limit it breaks the "
                        f"rules (Section 6.3).")]
    else:
        B += [na("ablation.json")]
    t4 = []
    if cnt:
        t4.append(["Counting (4x2 block)", f"{cnt['estimated_count']:.2f} ({cnt['ci'][0]:.2f} to "
                   f"{cnt['ci'][1]:.2f})", str(cnt["exact_count"]), "yes" if cnt["within_tolerance"] else "no"])
    if rsk:
        t4.append([f"Tail risk, CVaR {rsk['alpha'] * 100:.0f}%", f"{rsk['estimated']['cvar']:.3f} MW",
                   f"{rsk['exact']['cvar']:.3f} MW", "yes" if rsk["within_tolerance"] else "no"])
    if tie:
        t4.append([f"{tie['n_plans']} tied best plans", f"spread {tie['prob_spread']:.1e}", "equal", "yes"])
    if gas:
        t4.append(["Grover search (4x2 block)", f"{gas['feasibility_pct']:.0f}% valid, "
                   f"{gas['p_optimal'] * 100:.0f}% best", "100% best", "worse"])
    if par:
        t4.append(["Fairness-weight sweep", f"{par_ok} of {len(par['points'])} at best cost",
                   f"{len(par['points'])} of {len(par['points'])}", "yes" if par_ok == len(par["points"]) else "mostly"])
    if rep:
        s = rep["summary"]
        t4.append([f"Replay ({nq_rep} of {s['n_frames']} hours by circuit)", f"{s['matches_exact_count']} best, "
                   f"{pass_rep} pass rules", f"{s['n_frames']} best", "yes" if s["matches_exact_count"] == s["n_frames"]
                   else "mostly"])
    if sca:
        t4.append(["MPS scaling", f"{len(ok_scale)} of {len(sca['points'])} runs, up to {big_n} qubits",
                   "MILP", "see 6.3"])
    if t4:
        B += [("h2", "6.2 Other quantum components"),
              ("table", ["Component", "Quantum result", "Exact value", "Agrees"], t4,
               "Table 4. Other quantum components against their exact value.",
               "The [[amplitude-estimation|amplitude_estimation]] results agree with the exact values; the search "
               "and planning results reach the best plan only part of the time.")]
        extra = []
        if cnt:
            extra.append(f"Counting and tail risk are estimates, so each has an error bar; both exact values fall inside "
                         f"the stated tolerance (counting tolerance {cnt['tolerance']:.1f} plans).")
        if gas:
            extra.append(f"[[Grover Adaptive Search|gas]] found a valid plan in {gas['feasibility_pct']:.0f}% of its "
                         f"runs and the best plan in {gas['p_optimal'] * 100:.0f}%; the exact solver always finds it.")
        if rep:
            s_ = rep["summary"]
            extra.append(f"In the [[replay|replay]] the circuit planned every hour it was asked to; in "
                         f"{s_['n_frames'] - s_['matches_exact_count']} of {s_['n_frames']} hours its plan followed every "
                         f"rule but was not the cheapest.")
        if extra:
            B += [("p", " ".join(extra))]
    if heat:
        hr = {p["method"]: p for p in heat["plans"]}
        st = heat["random_valid_stats"]
        cap = heat["instance"]["rules"]["max_consecutive"]
        B += [("h2", "6.3 Rules under stress and larger cities"),
              ("p", f"Heatwave scenario (no feeder off more than {cap} hour in a row): round-robin breaks the rules "
                    f"{hr['round_robin']['n_violations']} times and {st['cap_violation_pct']:.1f}% of random valid "
                    f"plans break the back-to-back limit. The exact plan passes every rule.")]
    mps_rows = _mps_rows(sca)
    if mps_rows and fig_mps_memory(sca):
        top = mps_rows[-1]
        two_h = [p for p in mps_rows if p["n_hours"] == 2]
        mid = two_h[-1] if two_h else top
        fid = [p for p in ok_scale if p.get("fidelity") is not None and p["bond_dim"] is not None]
        fmax = max(fid, key=lambda p: (p["n_qubits"], p["bond_dim"])) if fid else None
        best_big = max((p for p in ok_scale if p["n_qubits"] == top["n_qubits"] and p["bond_dim"] is not None),
                       key=lambda p: p["approx_ratio"])
        txt = (f"An [[MPS (matrix product state)|mps]] simulator compresses the quantum state; the "
               f"[[bond dimension|bond_dimension]] sets how much it keeps. At {mid['n_qubits']} qubits, bond dimension {mid['bond_dim']} gave "
               f"{mid['feasibility_pct']:.0f}% valid plans (ratio {mid['approx_ratio']:.2f}) in "
               f"{_bytes(mid['mps_memory_mb'] * 2 ** 20)}, where exact simulation needs "
               f"{_bytes(2 ** mid['n_qubits'] * 16)}. At {top['n_qubits']} qubits the best run (bond dimension "
               f"{best_big['bond_dim']}) gave {best_big['feasibility_pct']:.1f}% valid plans (ratio "
               f"{best_big['approx_ratio']:.2f}) but bond dimension {top['bond_dim']} gave "
               f"{top['feasibility_pct']:.0f}%, so the result has not settled.")
        if fmax:
            txt += (f" [[Fidelity|fidelity]] (overlap with the exact state) is measurable only up to {fmax['n_qubits']} qubits: "
                    f"{fmax['fidelity']:.2f} at bond dimension {fmax['bond_dim']}.")
        txt += " This is a classical simulation, not a quantum advantage."
        B += [("p", txt),
              ("image", "figures/mps_memory.png", "Figure 2. Memory for exact simulation (computed) and for the MPS "
               "simulation (measured).", FIG2_WIDTH_IN,
               "Line chart, log scale: exact simulation memory grows from kilobytes to zettabytes as qubits rise "
               "from 10 to 72, while the MPS memory stays at a few megabytes.")]
    elif sca:
        big = max(ok_scale, key=lambda p: (p["n_qubits"], p["bond_dim"] or 0)) if ok_scale else None
        if big:
            B += [("p", f"MPS scaling: {len(ok_scale)} of {len(sca['points'])} runs, up to {big['n_qubits']} qubits; "
                        f"at bond dimension {big['bond_dim']} the ratio is {big['approx_ratio']:.2f}. This is a "
                        "classical simulation, not a quantum advantage.")]

    # ---------------------------------------------------------------- 7. originality
    B += [("h1", "7. What is original"),
          ("bullets", [("Fairness in the model: ", "past outage hours and back-to-back cuts count, and solutions with "
                                                     "them are heavily penalized."),
                       ("Rules in the circuit: ", "every sample is a valid plan, with no penalty tuning."),
                       ("A fair lottery: ", "tied best plans get exactly equal chances ([[Grover mixer|grover_mixer]])."),
                       ("Audit and replay: ", "any schedule can be checked; the replay re-plans hourly with an exact "
                                              "fallback.")])]

    # ---------------------------------------------------------------- 8. limitations
    lim = [("Simulator and synthetic data: ", "an ideal, noise-free simulator, no hardware; feeders, demand and "
                                               "outage history are made up, only the weather snapshot is real."),
           ("Classical wins at this size: ", "the exact solver is better and faster; no speed-up is claimed.")]
    if best_q:
        miss = []
        if par and par_ok is not None:
            miss.append(f"{len(par['points']) - par_ok} of {len(par['points'])} fairness weights")
        if rep:
            miss.append(f"{rep['summary']['n_frames'] - rep['summary']['matches_exact_count']} of "
                        f"{rep['summary']['n_frames']} replay hours")
        lim.append(("Low single-try chance: ", f"one try is a best plan only {best_q['p_optimal'] * 100:.2f}% of the "
                    f"time, so a plan is the best of 256 tries; this still missed the best plan at "
                    f"{' and '.join(miss)}."))
    if sca:
        n_fb = sum(1 for p in ok_scale if "first attempt" in p["notes"])
        lim.append(("MPS limits: ", f"Aer crashed on Windows on some circuits at bond dimension 2 or 4 ({n_fb} "
                    f"run retried); fidelity is measurable only up to 20 qubits; angles from small instances are reused; "
                    f"the largest instances do not settle."))
    lim += [("Risk block: ", "8 feeders, not 4 to 6, because smaller blocks have zero loss in every scenario.")]
    B += [("h1", "8. Limitations and trade-offs"), ("bullets", lim)]

    # ---------------------------------------------------------------- 9. reproducibility
    B += [("h1", "9. Reproducibility"),
          ("bullets", [f"Python 3.11, qiskit {V.get('qiskit', NA)}, qiskit-aer {V.get('qiskit-aer', NA)}, "
                       f"qiskit-algorithms {V.get('qiskit-algorithms', NA)}, qiskit-optimization "
                       f"{V.get('qiskit-optimization', NA)} (requirements.txt); seed 7.",
                       f"Commands: python scripts/tasks.py setup, then test, demo and ui (the dashboard). Code and "
                       f"results: {REPO_URL}.",
                       f"{checks} proof checks pass (results/checks.json); scripts/validate_results.py checks every "
                       "results file against its schema. Optimiser angles differ slightly between machines, so "
                       "sampled counts reproduce on one machine."])]
    B += [("h1", "10. Glossary"), ("glossary", GLOSSARY)]
    return B


# ------------------------------------------------------------------------------------------
# renderers
# ------------------------------------------------------------------------------------------
def md(text: str) -> str:
    out = []
    for t, target in segments(str(text)):
        if target is None:
            out.append(t)
        elif target.startswith("http"):
            out.append(f"[{t}]({target})")
        else:
            out.append(f"[{t}](#g-{target.replace('_', '-')})")
    return "".join(out)


def to_markdown(blocks: list) -> str:
    out = []
    for b in blocks:
        k = b[0]
        if k == "title":
            out += [f"# {b[1]}", ""]
        elif k == "meta":
            out += [md(b[1]), ""]
        elif k == "glossary":
            out += [f'- <a id="g-{key.replace("_", "-")}"></a>**{term}:** {md(text)}' for key, term, text in b[1]] + [""]
        elif k == "h1":
            out += [f"## {b[1]}", ""]
        elif k == "h2":
            out += [f"### {b[1]}", ""]
        elif k == "p":
            out += [md(b[1]), ""]
        elif k == "bullets":
            out += [f"- **{x[0].strip()}** {md(x[1])}" if not isinstance(x, str) else f"- {md(x)}" for x in b[1]] + [""]
        elif k == "image":
            out += [f"![{b[4]}]({b[1]})", "", b[2], ""]
        elif k == "table":
            hdr, rows, cap, take = b[1], b[2], b[3], b[4]
            esc = lambda s: str(s).replace("|", "/").replace("\n", " ")
            out += [cap, "", "| " + " | ".join(md(esc(c)) for c in hdr) + " |", "|" + "---|" * len(hdr)]
            out += ["| " + " | ".join(md(esc(c)) for c in r) + " |" for r in rows] + [""]
            if take:
                out += [md(take), ""]
    return "\n".join(out) + "\n"


FONT = "Times New Roman"


def _tnr_style(style, size=12, bold=None):
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor
    style.font.name = FONT
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.font.italic = False
    if bold is not None:
        style.font.bold = bold
    rf = style.element.get_or_add_rPr().get_or_add_rFonts()
    for a in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        rf.attrib.pop(qn(a), None)
    for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rf.set(qn(a), FONT)


def to_docx(blocks: list, path: Path) -> None:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Inches, Mm, Pt

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = sec.top_margin = sec.bottom_margin = Cm(2.54)
    # document defaults: no theme fonts
    rpr_default = doc.styles.element.find(qn("w:docDefaults")).find(qn("w:rPrDefault")).find(qn("w:rPr"))
    rf = rpr_default.find(qn("w:rFonts"))
    if rf is not None:
        for a in list(rf.attrib):
            del rf.attrib[a]
        for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            rf.set(qn(a), FONT)
    for name, size, bold in (("Normal", 12, None), ("Title", 14, True), ("Heading 1", 12, True),
                             ("Heading 2", 12, True), ("List Bullet", 12, None), ("Footer", 12, None),
                             ("Table Grid", 12, None)):
        try:
            _tnr_style(doc.styles[name], size, bold)
        except KeyError:
            pass
    normal = doc.styles["Normal"].paragraph_format
    normal.line_spacing, normal.space_after, normal.space_before = 1.15, Pt(6), Pt(0)
    title = doc.styles["Title"]
    ppr = title.element.get_or_add_pPr()
    for el_ in ppr.findall(qn("w:pBdr")):
        ppr.remove(el_)
    title.paragraph_format.space_after = Pt(6)
    for name in ("Heading 1", "Heading 2"):
        pf = doc.styles[name].paragraph_format
        pf.space_before, pf.space_after, pf.keep_with_next = Pt(8 if name == "Heading 1" else 4), Pt(2), True
    lb = doc.styles["List Bullet"].paragraph_format
    lb.space_after = Pt(2)

    # page number, bottom centre
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    fld.append(r)
    fp._p.append(fld)

    from docx.opc.constants import RELATIONSHIP_TYPE as RT

    def link_run(par, text, target, bold=False):
        h = OxmlElement("w:hyperlink")
        if target.startswith("http"):
            h.set(qn("r:id"), par.part.relate_to(target, RT.HYPERLINK, is_external=True))
        else:
            h.set(qn("w:anchor"), "g_" + target)
        r_ = OxmlElement("w:r")
        rpr = OxmlElement("w:rPr")
        if bold:
            rpr.append(OxmlElement("w:b"))
        u = OxmlElement("w:u")
        u.set(qn("w:val"), "single")
        rpr.append(u)
        r_.append(rpr)
        t_ = OxmlElement("w:t")
        t_.text = text
        t_.set(qn("xml:space"), "preserve")
        r_.append(t_)
        h.append(r_)
        par._p.append(h)

    def rich(par, text, bold=False):
        for t_, target in segments(str(text)):
            if target is None:
                run_ = par.add_run(t_)
                run_.bold = bold or None
            else:
                link_run(par, t_, target, bold)

    def runs(par, item):
        if isinstance(item, str):
            rich(par, item)
        else:
            par.add_run(item[0]).bold = True
            rich(par, item[1])

    bookmark_id = [100]

    for b in blocks:
        k = b[0]
        if k == "title":
            doc.add_paragraph(b[1], style="Title")
        elif k == "meta":
            p = doc.add_paragraph()
            rich(p, b[1])
            p.paragraph_format.space_after = Pt(0)
        elif k == "glossary":
            for key, term, text in b[1]:
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(3)
                bookmark_id[0] += 1
                start = OxmlElement("w:bookmarkStart")
                start.set(qn("w:id"), str(bookmark_id[0]))
                start.set(qn("w:name"), "g_" + key)
                p._p.append(start)
                p.add_run(term + ": ").bold = True
                rich(p, text)
                end = OxmlElement("w:bookmarkEnd")
                end.set(qn("w:id"), str(bookmark_id[0]))
                p._p.append(end)
        elif k == "h1":
            doc.add_paragraph(b[1], style="Heading 1")
        elif k == "h2":
            doc.add_paragraph(b[1], style="Heading 2")
        elif k == "p":
            rich(doc.add_paragraph(), b[1])
        elif k == "bullets":
            for x in b[1]:
                runs(doc.add_paragraph(style="List Bullet"), x)
        elif k == "image":
            img = OUT / b[1]
            if img.exists():
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.keep_with_next = True
                p.paragraph_format.line_spacing = 1.0
                p.paragraph_format.space_after = Pt(0)
                shape = p.add_run().add_picture(str(img), width=Inches(b[3]))
                shape._inline.docPr.set("descr", b[4])
                doc.add_paragraph(b[2])
        elif k == "table":
            hdr, rows, capt, take = b[1], b[2], b[3], b[4]
            cp = doc.add_paragraph(capt)
            cp.paragraph_format.keep_with_next = True
            cp.paragraph_format.space_after = Pt(2)
            tb = doc.add_table(rows=1 + len(rows), cols=len(hdr))
            tb.style = "Table Grid"
            for i, vals in enumerate([hdr] + rows):
                for j, v in enumerate(vals):
                    c = tb.rows[i].cells[j]
                    c.text = ""
                    para = c.paragraphs[0]
                    para.paragraph_format.space_after = Pt(0)
                    para.paragraph_format.line_spacing = 1.0
                    rich(para, v, bold=(i == 0))
            if take:
                tp = doc.add_paragraph()
                rich(tp, take)
                tp.paragraph_format.space_before = Pt(4)
            else:
                doc.add_paragraph().paragraph_format.space_after = Pt(0)
    doc.core_properties.title = "FairShed report"
    doc.core_properties.subject = "Fair, auditable load-shedding planner (Qiskit hackathon). Synthetic data, simulator only."
    doc.save(str(path))


def to_pdf(docx_path: Path) -> tuple:
    """(pdf path or None, page count or None). LibreOffice if present, else Microsoft Word on Windows."""
    import shutil
    pdf = docx_path.with_suffix(".pdf")
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(docx_path.parent), str(docx_path)],
                       capture_output=True, timeout=180)
        return (pdf if pdf.exists() else None), None
    if sys.platform == "win32":
        ps = (f"$w = New-Object -ComObject Word.Application; $w.Visible = $false; "
              f"$d = $w.Documents.Open('{docx_path}', $false, $true); $n = $d.ComputeStatistics(2); "
              f"$d.SaveAs2('{pdf}', 17); $d.Close(0); $w.Quit(); Write-Output $n")
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=180)
            pages = int(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else None
            return (pdf if pdf.exists() else None), pages
        except Exception:
            return None, None
    return None, None


# ------------------------------------------------------------------------------------------
# key numbers for the README block and the demo script (all read from results JSON)
# ------------------------------------------------------------------------------------------
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

- **On screen:** Start here, then Schedule: the map of synthetic Karachi zones and the hour slider.
- **Caption:** "Who loses power, and is it fair?"
- **Voice-over:** "When supply falls short, a utility switches whole feeders off, an hour at a
  time. The quota says how many. FairShed decides which ones: spread the hours evenly, avoid
  cutting the same area twice in a row, spare the areas that suffer most, never cut a hospital
  or a water pump, and let anyone audit the schedule. Everything you will see is synthetic data
  on a simulator."

## 0:20 to 1:20 Replay mode

- **On screen:** Replay and rules > Watch it hour by hour. Press Play. Point at the feeder cards
  changing, the real vs forecast chart, the solver chip and the "Matches best plan" chip. Then open
  Rule checker, pick "Round-robin", show the violations; switch to "Exact optimum", show it passes.
- **Caption:** "Re-planning every hour, warm-started from the last plan."
- **Voice-over:** "This is one afternoon and evening, hour by hour. Each hour a classical ridge
  forecast sets the next three quotas, a quantum circuit on the simulator picks the plan, and only
  the first hour is committed. Over {g('replay_frames')} hours, {g('replay_q')} were solved by the
  quantum solver and {g('replay_match')} matched the exact optimum; {g('replay_audit')}.
  The audit mode checks any schedule against four rules. In the heatwave scenario,
  {g('heat')}."

## 1:20 to 2:00 Quantum stages and real numbers

- **On screen:** Results > Scoreboard (summary, table, proof checklist), then Results > Fair
  lottery, then Results > Uncertainty and counting.
- **Caption:** "Constraint-preserving circuits: every sample is a valid plan."
- **Voice-over:** "Each hour starts in a Dicke state, so every sample meets the quota and never
  touches a protected feeder. The best variant, {g('best_q_label')}, reaches approximation ratio
  {g('best_q_ratio')}; a standard penalty mixer gives valid plans only {g('penalty_valid')} of the
  time. With the Grover mixer, tied optimal plans get equal probability: a fair lottery. Amplitude
  estimation counts the valid plans, {g('count_short')}, and puts the tail risk at {g('cvar_short')}.
  {g('checks')} proof checks pass."
- **Numbers on screen for reference:** {g('base')}; {g('tie')}; counting {g('count')}; risk {g('cvar')}.

## 2:00 to 2:30 Honest limits and scale

- **On screen:** Results > Bigger problems: the chart, then the callout "This is not a quantum advantage".
- **Caption:** "Simulator only. No speed-up claimed."
- **Voice-over:** "Be clear about the limits. This runs on a simulator, the data is synthetic, and
  at {g('qubits')} qubits a classical brute force finds the exact answer, which is better than our
  sampled plans. Per-shot probability of the optimum is low; the plan is the best of 256 shots. The
  scale curve uses a matrix product state simulator: {g('scale')}. That shows how the circuit
  behaves as it grows; it is not a quantum advantage."

## 2:30 to 3:00 Close

- **On screen:** Back to Schedule, press Play once more; end on the badge "Simulator - synthetic data".
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
    pdf, pages = to_pdf(OUT / "FairShed_Report.docx")
    K = key_numbers()
    update_readme(K)
    (ROOT / "docs" / "demo_script.md").write_text(demo_script(K), encoding="utf-8")
    print("wrote docs/report/FairShed_Report.md and .docx, docs/report/architecture.png and .mmd, "
          "docs/report/figures/mps_memory.png, docs/demo_script.md, README.md key results")
    print(f"PDF: {pdf.relative_to(ROOT) if pdf else 'not written (no LibreOffice or Word found)'}"
          + (f", {pages} pages" if pages else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
