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
| `python scripts/run_quantum.py scaling` | Aer MPS curve, 6 instances x (statevector + 6 bond dimensions) | about 45 s |
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
| `scaling.py` | MPS curve; points run in an isolated worker process with time limits |
| `io.py` | the only file reader and writer; validates every result against its schema before writing |

**How to test:** `python -m pytest -q tests/quantum`. Checks Q01 to Q12: cost table
equals the contract on every bitstring, Dicke uniformity, bit order, XY and Grover samples
always valid, equal-cost equal amplitude, seed reproducibility, penalty objective, agreement
with Area 2's exact reference, counting within tolerance, GAS scoring, risk IAE against exact.

**Weak spots**

- Per-shot P(optimal) of every QAOA variant is low on the 18-qubit base instance; the decision
  rule (best valid of 256 shots) misses the optimum at one Pareto weight and in 3 of 12 replay
  frames.
- Aer on Windows: the interleaved MPS layout crashes at 16 qubits and one 12-qubit point at
  chi=2 crashes; both are isolated and recorded (`docs/KNOWN_ISSUES.md`).
- `risk.py` uses the 8-feeder replay cluster, not a 4-6 feeder block (a smaller block has zero
  loss in every scenario).
- COBYLA angles differ in the 4th decimal across machines, so sampled counts are reproducible per
  machine only.
- Many `DeprecationWarning`s from qiskit-optimization's use of `GroverOperator` (Qiskit 2.1+).

**TODO (concrete)**

1. In `stages.py`, raise `DECISION_SHOTS` to 1024 or use p=3 for `solve_window`; re-run
   `pareto` and the replay and check whether every point matches exact.
2. Add CVaR-QAOA (score samples by the mean of the best alpha fraction) as an ablation row.
3. Try `ordering="interleaved"` in `scaling.py` on Linux; compare the bond dimension needed.
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

**Paths:** `ui/`, `media/`, `docs/demo_script.md`, `scripts/ui_smoke.mjs`, `tests/ui/`.
Branch `feat/ui`.

**Reads:** every file in `results/` listed in `schemas/index.json`, validated in the browser
(`ui/js/validate.js`). Writes nothing.

**Entry points**

| Command | What it does |
|---|---|
| `python scripts/tasks.py ui` | serves the repo root; open http://localhost:8000/ui/ |
| `python scripts/tasks.py ui-smoke` | headless Chrome or Edge over CDP, loads all 7 screens, fails on console errors; screenshots in `results/tmp/ui_smoke/` |
| `http://localhost:8000/ui/?debug=1` | qubit indices and bitstrings |
| `http://localhost:8000/ui/?results=tests/fixtures/` | mock fixtures, with a "MOCK FIXTURES" badge |

**Structure:** `ui/js/main.js` (shell, router), `data.js` (load and validate results),
`banner.js` (missing or invalid files), `screens/*.js` (one module per screen, each exports
`mount()` and returns `destroy()`), `components/` (map, plan grid, shared widgets), `charts.js`
(Chart.js house style), `rules.js` (browser port of `src/audit/rules.py`), `vendor/` (GSAP,
Chart.js, Leaflet, IBM Plex fonts, all offline).

**How to test:** `node scripts/ui_smoke.mjs` (Node 22+ and Chrome, Chromium or Edge), or
`python -m pytest -q tests/ui`. CI runs it on Ubuntu with Node 22.

**Weak spots**

- `docs/demo_script.md` is generated by `scripts/fill_report.py` (so its numbers are real); edit
  the template in `demo_script()` there, not the markdown.
- The smoke test checks rendering, console errors and a few interactions (play on Plan and
  Replay, editing a cell in Audit, the Forecast period switch). It does not check the fairness
  slider or the map popovers. `node scripts/ui_smoke.mjs --results ../results/tmp/<dir>/` runs it
  against another results folder, which is how the "not available" path was checked.
- Leaflet tiles need the network; `?tiles=off` or offline use falls back to the tile grid.
- Screen layouts were checked at 1440 x 960 only.

**TODO (concrete)**

1. Extend `ui_smoke.mjs` to move the Plan fairness slider and open a feeder popover.
2. Check every screen at 390 px width and fix overflow (tables already scroll).
3. Add a "how this was computed" link on each KPI that opens the matching report section.
4. Record the 3-minute video from `docs/demo_script.md`; keep the file out of git (see `.gitignore`).

---

## Shared files (change rarely, all three approve)

`Makefile`, `requirements.txt`, `schemas/` (edit `schemas/build_schemas.py`, then run it),
`docs/CONTRACT.md`, `scripts/tasks.py`, `scripts/status_report.py`, `scripts/validate_results.py`,
`tests/conftest.py`, `.github/`.
