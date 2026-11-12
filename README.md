# FairShed

A fair, auditable load-shedding planner built with Qiskit, for the Qiskit hackathon
(Energy and Smart Infrastructure).

When supply falls short, a utility switches whole feeders off, one hour at a time. FairShed
decides **which** feeders: it spreads outage hours evenly, avoids cutting the same area hour
after hour, spares the areas where an outage hurts most, never cuts hospitals, water pumps or
telecom towers, and lets anyone audit a published schedule against the rules.

> **Simulator only. Synthetic data.** Every feeder, demand figure and outage ledger is synthetic,
> placed on illustrative Karachi zones. Weather in the forecast is a real Open-Meteo snapshot.
> Every quantum result runs on the Qiskit Aer simulator and is checked against the exact
> classical answer. No quantum speed-up is claimed.

## What is in it

- **Seven quantum components** (`src/quantum/`): Dicke-state + XY-mixer QAOA, Grover-mixer QAOA
  (equal-cost plans get equal probability, so ties are a fair lottery), penalty QAOA as a weak
  baseline, quantum counting of valid plans by iterative amplitude estimation, tail risk
  (expected loss, VaR, CVaR) by amplitude estimation, Grover Adaptive Search, and an MPS
  simulator scaling curve on larger instances (sizes in Key results below).
- **Classical side** (`src/`): seeded synthetic instances, a QUBO cost model, exact brute force
  and MILP, round-robin and random baselines, a ridge-regression shortfall forecast, an audit
  mode that scores any schedule, and a receding-horizon replay that re-plans every hour with the
  quantum window solver.
- **Dashboard** (`ui/`): static and offline (no build step). Built for the people who use the
  schedule: Start here, Schedule, Replay and rules (hour-by-hour replay, rule checker), Results
  (compare methods, fair tie-breaks, risk and counting, bigger cities, forecast). Every explanation
  sits behind one **Inner working** button: a side panel about the current screen, plus four pages
  for judges (how FairShed works in six steps, questions judges ask, the methods, glossary). It
  reads only `results/*.json` and shows "not available" for anything missing or schema-invalid.
- **Report** (`docs/report/`): `FairShed_Report.md` and `FairShed_Report.docx`, generated from
  the results files by `scripts/fill_report.py`, with the architecture diagram embedded.

## Setup

Requirements: Python 3.11 (the pinned versions were verified on 3.11.9), git. Optional for the
UI smoke test: Node 22 or newer and Chrome, Chromium or Edge.

```bash
git clone https://github.com/cheesesocrates/Qiskit-Hack.git
cd Qiskit-Hack
python scripts/tasks.py setup          # creates .venv and installs requirements.txt (Linux/macOS: python3)
```

On Windows, if `python` is not 3.11, install it with `py install 3.11` and run
`py -V:3.11 scripts/tasks.py setup`. Every `make <target>` below is a thin wrapper around
`python scripts/tasks.py <target>`, so `make` is optional.

Use the venv's Python for everything after setup:

| OS | Python in the venv |
|---|---|
| Windows | `.venv\Scripts\python.exe` (Git Bash: `.venv/Scripts/python.exe`) |
| Linux, macOS | `.venv/bin/python` |

## Run

```bash
PY=.venv/Scripts/python.exe            # Linux/macOS: PY=.venv/bin/python

$PY scripts/tasks.py test              # pytest + schema validation of results/
$PY scripts/tasks.py demo              # regenerate every results file, then test, report, validate
$PY scripts/tasks.py ui                # dashboard at http://localhost:8000/ui/  (Ctrl+C to stop)
$PY scripts/tasks.py ui-smoke          # load all 13 screens in headless Chrome/Edge, fail on console errors
$PY scripts/tasks.py report            # rebuild docs/report/ from results/*.json
$PY scripts/tasks.py status            # write docs/STATUS.md (files, schema checks, test counts)
```

With `make`: `make setup`, `make test`, `make demo`, `make ui`, `make ui-smoke`, `make report`,
`make status`.

One stage at a time:

```bash
$PY scripts/run_classical.py                     # instance.json, plans/*.json
$PY scripts/run_forecast.py                      # forecast.json
$PY scripts/run_audit.py                         # audit_example.json
$PY scripts/run_quantum.py all                   # ablation, lottery, pareto, counting, risk, scaling
$PY scripts/run_quantum.py ablation              # or one stage: lottery | pareto | counting | risk | scaling
$PY scripts/run_replay.py --solver quantum       # replay.json (exact fallback per frame, recorded)
$PY scripts/validate_results.py                  # every results file against schemas/
```

Dashboard options: `?debug=1` shows qubit indices and bitstrings; `?tiles=off` keeps the
offline grid instead of map tiles.

## Expected outputs

- `test`: every test passes; the UI smoke test is skipped (with the reason) if Node 22+ or a
  browser is missing. `validate_results.py` ends with `20 valid, 0 missing, 0 invalid`.
- `demo`: rewrites the 20 files in `results/`, `results/checks.json` and `docs/report/`. A failed
  quantum stage deletes its own output file and the dashboard says "not available"; nothing
  is faked.
- `ui-smoke`: `ui_smoke: all 13 screens passed`, with screenshots in `results/tmp/ui_smoke/`.

## Key results

Generated from `results/*.json` by `scripts/fill_report.py`; do not edit by hand. The full
tables are in `docs/report/FairShed_Report.md`.

<!-- RESULTS:START -->
- Base instance: 8 feeders x 3 hours, 4500 valid plans, 4 tied optima at cost 10.50.
- Best QAOA variant on it: Grover-mixer QAOA, p=3: approximation ratio 0.846, P(optimal) per shot 0.0093; sampling the Dicke state alone gives P(optimal) 0.0022.
- Penalty QAOA (standard X mixer): only 19.6% and 27.9% of samples are valid plans.
- Fair lottery: 4 plans tied at cost 10.50 get equal probability (spread 4.8e-18).
- Grover Adaptive Search on the block_4x2 block: 90% of 20 runs valid, 0.30 optimal.
- Quantum counting of valid plans: exact 9, estimate 9.07 (95% interval 8.90 to 9.23).
- Tail risk by amplitude estimation: CVaR 95% exact 0.906 MW, estimate 0.911 MW; P(unplanned cut) exact 0.125, estimate 0.125.
- Replay with the quantum window solver: 12 hourly frames, 12 solved by the quantum solver, 9 matched the exact optimum, every committed plan passed the audit.
- MPS scaling: 52 of 52 points ran, up to 72 qubits; at 72 qubits and bond dimension 64 the ratio is 0.599.
- Where simple rules fail (scenario heatwave_cap): round-robin breaks the rules 4 times; 99.6% of random valid plans break the consecutive-hour cap.
- Proof checks passing: 36 of 36.
- The exact classical answer is better or equal on every instance; no speed-up is claimed.
<!-- RESULTS:END -->

## Repository layout

| Area | Paths | Writes |
|---|---|---|
| 1. Quantum | `src/quantum/`, `tests/quantum/`, `scripts/run_quantum.py` | ablation, lottery, pareto, counting, risk, scaling |
| 2. Classical, data, report | `src/{data,cost,classical,export,audit,replan,forecast}/`, `results/`, `docs/report/`, `README.md` | instance, plans, forecast, audit_example, replay, report |
| 3. UI and video | `ui/`, `media/`, `docs/demo_script.md` | nothing (reads results) |
| Shared | `Makefile`, `requirements.txt`, `schemas/`, `docs/CONTRACT.md`, `scripts/tasks.py`, `tests/conftest.py`, `.github/` | `results/checks.json` (tests) |

The areas never import each other's code. They exchange only the JSON files in `results/`,
validated against `schemas/`. Read `docs/CONTRACT.md` for the bit order (results `bits` are
index-ordered, `bits[t*N+f]`, the reverse of Qiskit count keys) and the cost model.

## Pinned versions

qiskit 2.6.2, qiskit-aer 0.18.2, qiskit-algorithms 0.4.0, qiskit-optimization 0.7.0,
numpy 2.4.6, scipy 1.17.1, jsonschema 4.26.0, pytest 9.2.0, matplotlib 3.11.2,
python-docx 1.2.0, lxml 6.1.3 (`requirements.txt`).

## Documentation

- `docs/report/FairShed_Report.docx`: the report (results, classical comparison, architecture, limitations).
- `docs/KNOWN_ISSUES.md`: everything that is limited or does not work, and why.
- `docs/STATUS.md`: generated status (files, schema checks, proof checks).
- `docs/AREAS.md`: entry points, tests, weak spots and a TODO list per area.
- `docs/demo_script.md`: the 3-minute video script with numbers from the results.
- `docs/GIT_WORKFLOW.md`: branches, pull requests, code freeze.
- `docs/SPEC.md`: the original build brief. `docs/PROGRESS.md`: build log for the next session.
