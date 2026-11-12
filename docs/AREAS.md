# Areas

FairShed is split into three areas so three people can work in parallel. The areas never import
each other's code. They exchange only the JSON files in `results/`, validated against
`schemas/`; `docs/CONTRACT.md` explains the conventions (bit order, cost model, who writes what).
Branches and pull requests: `docs/GIT_WORKFLOW.md`. Measured status: `docs/STATUS.md`
(`python scripts/status_report.py`).

Use the venv's Python for every command below (`.venv/Scripts/python.exe` on Windows,
`.venv/bin/python` on Linux and macOS). `make <target>` is the same as
`python scripts/tasks.py <target>`.

---

## Area 1: Quantum

**Paths:** `src/quantum/`, `tests/quantum/`, `scripts/run_quantum.py`. Branch `feat/quantum`.

**Reads:** `results/plans/<scenario>.json` (the instance and its unweighted QUBO terms,
`instance.qubo.terms`), `results/forecast.json` and `results/instance.json` (risk only).
Never imports `src/data`, `src/cost` or any other Area 2 module.

**Writes:** `ablation.json`, `lottery.json`, `pareto.json`, `counting.json`, `risk.json`,
`scaling.json`, plus `results/tmp/` scratch (git-ignored angle cache and window files).

**Entry points**

| Command | What it does | Time on the dev machine |
|---|---|---|
| `python scripts/run_quantum.py all` | every stage below, in order; a failed stage deletes its own file | about 2.5 min |
| `python scripts/run_quantum.py ablation` | three QAOA variants at p=1 and p=3, Dicke-only, block comparison and Grover Adaptive Search | about 45 s |
| `python scripts/run_quantum.py lottery` | Grover-mixer samples, marginals, equal-cost tie groups | seconds (uses cached angles) |
| `python scripts/run_quantum.py pareto` | fairness-weight sweep, warm-started angles | about 30 s |
| `python scripts/run_quantum.py counting` | IAE count of valid plans on `block_4x2` | about 3 s |
| `python scripts/run_quantum.py risk` | IAE expected loss, tail probability, VaR, CVaR | about 4 s |
| `python scripts/run_quantum.py scaling` | Aer MPS curve, 8 instances (10 to 72 qubits) x (statevector up to 20 qubits + 6 bond dimensions); fidelity, bond dimension and memory per point; crash fallback | about 6 to 10 min |
| `python -m src.quantum.mps_probe --phase crash\|options\|layouts --report` | MPS diagnostics, one fresh process per configuration; `--report` writes `docs/MPS_DIAGNOSTICS.md` | 2 to 15 min per phase |
| `python scripts/run_quantum.py solve-window --in IN --out OUT` | the replay's window solver (Grover mixer, p=2, best of 256 shots) | 3 to 5 s per window |

**Modules**

| File | Role |
|---|---|
| `problem.py` | `QProblem`: QUBO and Ising over the compact register (no qubit for protected feeders), exact reference by enumeration, bit-order conversions |
| `dicke.py` | Dicke state preparation and its exact statevector (for tests) |
| `circuits.py` | cost layer, XY ring mixer, Grover mixer, penalty X mixer; builds parametrised QAOA circuits |
| `qaoa.py` | `QAOARunner` (statevector simulation, COBYLA with a small grid of ramp starts), sample and exact-state metrics, tie groups |
| `stages.py` | ablation, lottery, pareto stages, decision rule, `solve_window` |
| `gas.py` | Grover Adaptive Search (`GroverOptimizer`) on an integer-scaled penalised QUBO |
| `counting.py` | reversible validity oracle and IAE counting; seeded Aer sampler shared with `risk.py` |
| `risk.py` | residual scenarios loaded with `StatePreparation`, IAE for each risk measure |
| `scaling.py` | MPS curve; points run in an isolated worker process with time limits; a crashed point is retried once with the circuit routed to a line |
| `mps_probe.py` | MPS diagnostics (crash causes, simulator options, qubit layouts); writes `results/tmp/mps_probe.json` and `docs/MPS_DIAGNOSTICS.md` |
| `io.py` | the only file reader and writer; validates every result against its schema before writing |

**How to test:** `python -m pytest -q tests/quantum`. Checks Q01 to Q12: cost table
equals the contract on every bitstring, Dicke uniformity, bit order, XY and Grover samples
always valid, equal-cost equal amplitude, seed reproducibility, penalty objective, agreement
with Area 2's exact reference, counting within tolerance, GAS scoring, risk IAE against exact.

**Weak spots**

- Per-shot P(optimal) of every QAOA variant is low on the 18-qubit base instance; the decision
  rule (best valid of 256 shots) misses the optimum at one Pareto weight and in 3 of 12 replay
  frames.
- Aer 0.18.2 on Windows crashes or hangs on some MPS circuits at bond dimension 2 or 4. The stage
  retries such a point once with the circuit routed to a line; points that fail both ways carry no
  numbers (`docs/KNOWN_ISSUES.md`, `docs/MPS_DIAGNOSTICS.md`).
- MPS fidelity is measured only up to 20 qubits (it needs the exact state). At 54 and 72 qubits
  bond dimension 64 is not enough: most samples are invalid there.
- `risk.py` uses the 8-feeder replay cluster, not a 4-6 feeder block (a smaller block has zero
  loss in every scenario).
- COBYLA angles differ in the 4th decimal across machines, so sampled counts are reproducible per
  machine only.
- Many `DeprecationWarning`s from qiskit-optimization's use of `GroverOperator` (Qiskit 2.1+).

**TODO (concrete)**

1. In `stages.py`, raise `DECISION_SHOTS` to 1024 or use p=3 for `solve_window`; re-run
   `pareto` and the replay and check whether every point matches exact.
2. Add CVaR-QAOA (score samples by the mean of the best alpha fraction) as an ablation row.
3. Run the MPS stage on Linux (CI) to see whether the small-bond-dimension crashes are Windows-only;
   try bond dimensions 128 and 256 on the 54- and 72-qubit instances on a bigger machine.
4. Add a noise-model row (Aer `NoiseModel` from a fake backend) for the 6-qubit block.
5. Make `risk.py` take a feeder subset and a feeder size so a 4-6 feeder block has a non-zero loss.

---

## Area 2: Classical, data and report

**Paths:** `src/data/`, `src/cost/`, `src/classical/`, `src/export/`, `src/audit/`,
`src/replan/`, `src/forecast/`, `results/`, `docs/report/`, `README.md`, plus the scripts
`run_classical.py`, `run_forecast.py`, `run_audit.py`, `run_replay.py`, `fill_report.py`.
Branch `feat/data-docs`.

**Writes:** `instance.json`, `plans/*.json` (base, heatwave_cap, block_4x2, scale_6x2 to
scale_20x2), `forecast.json`, `audit_example.json`, `replay.json`, `docs/report/*`, the README
key-results block, `docs/demo_script.md` (generated, see Area 3).
**Reads:** Area 1's results files (report only) and, for the replay, Area 1's window solver
through files.

**Entry points**

| Command | What it does |
|---|---|
| `python scripts/run_classical.py` | seeded instances, exact (brute force or MILP), round-robin, random-valid baselines |
| `python scripts/run_forecast.py` | ridge regression on the committed weather snapshot (`--refresh` forces a live Open-Meteo fetch) |
| `python scripts/run_audit.py` | audit examples on `heatwave_cap` |
| `python scripts/run_replay.py --solver quantum` | 12-hour receding-horizon replay; exact fallback per frame |
| `python scripts/fill_report.py` | report .md and .docx, figures, architecture diagram, README block, demo script |
| `python scripts/tasks.py classical` | the first three in order |

**How to test:** `python -m pytest -q tests/classical tests/test_schemas.py`.
Checks C01 to C14 and S01 to S03: cost model equals QUBO and Pauli forms on every bitstring,
brute force equals filtered full enumeration, MILP equals brute force, baselines valid,
heatwave_cap baselines fail, fixed seeds reproduce, audit flags each rule, ridge beats the mean
predictor, replay commits valid plans and falls back to exact, schemas in sync, every results
file validates.

**Weak spots**

- `pytest` rewrites `generated_at` in the classical results files, so every test run dirties
  the working tree (data unchanged).
- The replay ledger starts at zero at 12:00; earlier cuts that day are not modelled.
- The forecast's demand series is synthetic; only the weather is real.
- `fill_report.py` is long; its text sections are templates with numbers filled from JSON. A
  missing results file becomes "not available", but a renamed field inside a file stops the script
  with a KeyError, so update it together with any schema change.

**TODO (concrete)**

1. Stop tests from rewriting committed results (write to a temp dir in `tests/classical/test_cls_results.py`).
2. Add a second replay day (a cooler day) and compare outage spread.
3. Add per-feeder outage hours over the replay to `replay.json` summary and the report.
4. Add a short "how to read the dashboard" section to the report with screenshots from `results/tmp/ui_smoke/`.

---

## Area 3: UI and video

**Paths:** `ui/`, `media/`, `docs/demo_script.md` (generated), `docs/UI_*.md`, `docs/TEAM_CHEATSHEET.md`
(generated), `scripts/ui_smoke.mjs`, `scripts/ui_contrast.mjs`, `tests/ui/`. Branch `feat/ui`.

**Reads:** every file in `results/` listed in `schemas/index.json`, validated in the browser
(`ui/js/validate.js`). Writes nothing to `results/`. Target: a desktop browser at 1440 x 900 or wider.

**Entry points**

| Command | What it does |
|---|---|
| `python scripts/tasks.py ui` | serves the repo root; open http://localhost:8000/ui/ |
| `python scripts/tasks.py ui-smoke` | contrast check, then every screen in headless Chrome or Edge: console errors, text under 14px, targets under 44px, keyboard focus, Beginner/Expert, glossary, tour |
| `node scripts/ui_contrast.mjs` | contrast of every colour pair in `ui/css/tokens.css` (light and dark) |
| `node scripts/ui_smoke.mjs --results ../results/tmp/<dir>/` | the same against another results folder (the "not available" path) |
| `node scripts/ui_smoke.mjs --no-checks --full --out media/screenshots --scale 0.4` | regenerate the committed screenshots |
| `node ui/tools/make_cheatsheet.mjs` | regenerate `docs/TEAM_CHEATSHEET.md` from the results |
| `http://localhost:8000/ui/?debug=1` | bit-level debug blocks (Expert mode shows them too) |
| `http://localhost:8000/ui/?results=tests/fixtures/` | mock fixtures, with a "Mock fixtures" badge |

**Structure:** `ui/js/main.js` (shell, router with five sections and sub-tabs; old routes like
`#/plan` still work), `explain.js` ("What am I looking at?", page header, chart block, raw JSON),
`glossary.js` (32 terms, popover cards), `metrics.js` (plain translations of every metric),
`tour.js` (8-step guided tour), `screens/*.js` (home, plan = Schedule, replay, audit = Rule checker,
compare = Scoreboard, lottery, risk = Uncertainty and counting, scale = Bigger problems, forecast,
learn), `components/` (map, plan grid, widgets), `charts.js` (Chart.js with theme colours, direct
labels, no animation), `rules.js` (browser port of `src/audit/rules.py`), `css/tokens.css` (the only
place colours live), `vendor/` (GSAP, Chart.js, Leaflet, Atkinson Hyperlegible, IBM Plex Mono; MIT
or OFL licences in `vendor/licenses/`).

**Rules for UI copy:** never type a result number; build sentences from the JSON. Say where quantum
loses as plainly as where it wins. No em dashes. Sentence case. Every chart title is a takeaway.

**How to test:** `python -m pytest -q tests/ui` (U01 smoke with all checks, U02 contrast, U03
not-available path). Needs Node 22+ and Chrome, Chromium or Edge; skips otherwise. CI runs it.

**Weak spots**

- Desktop only by team decision; below 760 px the layout stacks but is not tested.
- The keyboard check counts focus stops and focus rings; it does not verify the reading order.
- The map popover and the fairness choice are not exercised by the smoke test.
- Leaflet map tiles need the network; offline, the tile grid is shown instead.
- The top bar fits one row at 1440 px; narrower desktop windows wrap it to two rows.

**TODO (concrete)**

1. Presenter mode: arrow keys step through screens in the order of `docs/demo_script.md`.
2. Smoke test: open a feeder popover and switch the fairness choice, asserting no errors.
3. Add `make cheatsheet` once the shared Makefile can change.
4. Record the 3-minute video from the final UI (`docs/demo_script.md`); keep video files out of git.

---

## Shared files (change rarely, all three approve)

`Makefile`, `requirements.txt`, `schemas/` (edit `schemas/build_schemas.py`, then run it),
`docs/CONTRACT.md`, `scripts/tasks.py`, `scripts/status_report.py`, `scripts/validate_results.py`,
`tests/conftest.py`, `.github/`.
