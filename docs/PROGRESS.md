# FairShed build progress

Resume file. A fresh session should read this first, then `docs/SPEC.md` (the full brief),
`docs/CONTRACT.md` (data contract) and `docs/HANDOFF_PROMPT.md` (copy-paste prompt).

Status words: **done** (built, run, tests pass), **partial** (code exists, not fully run or
verified), **not started**, **not working** (tried, fails: see `docs/KNOWN_ISSUES.md`).

Last updated: 2026-11-12 17:12 (local), by the first build session, mid-build.

## Milestones

| # | Milestone | Status | What exists / what is left |
|---|---|---|---|
| M1 | Repo skeleton, schemas, CI, git docs | partial | Done: folders, `docs/SPEC.md`, `docs/CONTRACT.md`, 12 schemas + `schemas/build_schemas.py`, `tests/test_schemas.py`, pinned `requirements.txt`, `.gitignore`, `.github/` (CI, CODEOWNERS, PR template), `docs/GIT_WORKFLOW.md`, `docs/KNOWN_ISSUES.md` skeleton. **Left: `Makefile` and `scripts/tasks.py` (setup, test, demo, ui, report) are NOT written yet; `docs/AREAS.md` not written.** |
| M2 | Generator, cost model, baselines, exporters | done | `src/cost`, `src/data`, `src/classical`, `src/export`, `src/audit`; `scripts/run_classical.py`, `scripts/run_audit.py`; `tests/classical` (18 passed when last run); `results/instance.json`, `results/plans/*.json`, `results/audit_example.json`. |
| M3 | Static dashboard: Plan, Compare/Proof | partial | A subagent was building all seven screens in `ui/` when this was written. Files exist but have not been reviewed or smoke-tested by the lead. `tests/ui/test_ui_smoke.py` may not exist yet. |
| M4 | Three QAOA variants + ablation/lottery/pareto | partial | Written: `src/quantum/{io,problem,dicke,circuits,qaoa,stages}.py`, `scripts/run_quantum.py`, `tests/quantum/{helpers,test_core}.py`. Verified by hand on the 18-qubit base case (Dicke exact to 1e-16, 100% valid samples for XY and Grover mixers, tie spread ~1e-18). **Not yet run: `pytest tests/quantum/test_core.py`, `scripts/run_quantum.py ablation|lottery|pareto`. `results/ablation.json`, `lottery.json`, `pareto.json` do not exist yet.** |
| M5 | Counting, risk (AE), Grover Adaptive Search | partial | A subagent was writing `src/quantum/{counting,risk,gas}.py` and tests. State unknown: check whether the files exist and whether `pytest tests/quantum` passes. |
| M6 | Audit, replay, ridge forecast | partial | Audit done. A subagent was writing `src/forecast`, `src/replan`, `scripts/run_forecast.py`, `scripts/run_replay.py`; `results/forecast.json` and `results/replay.json` exist but are unreviewed. Replay with `--solver quantum` has not been run against the real window solver. |
| M7 | MPS scaling | partial | A subagent was writing `src/quantum/scaling.py` + `tests/quantum/test_scaling.py`. State unknown. |
| M8 | Report, README, demo script | not started | Need `docs/report/` (with Mermaid diagram exported to an image), `scripts/fill_report.py` (tables from `results/*.json`, no hand-typed numbers), `README.md`, `docs/demo_script.md`. |
| M9 | Final pass from a clean venv | not started | `make test`, `make demo`, finish `docs/AREAS.md`, this file and `docs/KNOWN_ISSUES.md`, push. |

## Real numbers seen so far (base 8x3, seed 7; re-run to confirm, never copy by hand)

- 24 logical variables, 18 qubits (protected feeders have no qubit); 4500 valid plans; 4 tied optimal plans at cost 10.5; worst valid cost 41.5.
- Uniform over valid plans: P(optimal) = 4/4500 = 0.09%.
- Dicke + XY QAOA p=1: P(optimal) about 1.0%, approx ratio about 0.79 (COBYLA, 100 iterations).
- Grover-mixer QAOA p=3: P(optimal) about 0.8%, approx ratio about 0.85; equal-cost plans equal probability (spread 1e-18).
- Penalty QAOA p=2: about 20% valid samples, approx ratio about 0.13 (weak baseline, as expected).
- heatwave_cap scenario: exact cost 40.67 passes the audit; round-robin costs 121.17 with 4 violations; random-valid breaks the consecutive cap in 99.6% of 2000 samples.

## Environment facts

- Windows 11, Git Bash + PowerShell. Python 3.11 venv at `.venv` (`.venv/Scripts/python.exe`).
- Pinned: qiskit 2.6.2, qiskit-aer 0.18.2, qiskit-algorithms 0.4.0, qiskit-optimization 0.7.0.
- `make` is not on PATH in Git Bash. `mingw32-make` is; `/c/msys64/usr/bin/make.exe` exists.
  Plan: Makefile targets just call `python scripts/tasks.py <target>` so Windows users can
  run the script directly.
- Playwright is not installed; Edge/Chrome channels can be used without downloading browsers.
- Git remote: see the top of `docs/HANDOFF_PROMPT.md`.

## Design decisions already made (do not re-litigate)

- Areas talk only through `results/*.json` + `schemas/`. Area 1 never imports Area 2 code;
  it reads the QUBO from `results/plans/<scenario>.json` (`instance.qubo.terms`, unweighted).
- `bits` in results are index-ordered (`bits[t*N+f]`), the reverse of Qiskit count keys.
- Circuits use a compact register (no qubit for protected feeders): 8x3 -> 18 qubits.
- The replay calls the quantum solver as a subprocess through JSON files
  (`scripts/run_quantum.py solve-window`), falling back to exact per frame and saying so.
- Decision rule for a QAOA plan: best valid sample among 256 shots (uniform sampling would
  find an optimum only about 20% of the time at 256 shots, so the circuit matters).
- UI: IBM Plex Sans/Mono, dark slate, colour only for feeder state, one iris accent.
- Proof checks: tests marked `@pytest.mark.check(id, name)` are merged into `results/checks.json`.

## Next steps, in order

1. Write `scripts/tasks.py` + `Makefile` (setup, test, demo, ui, report, validate).
2. Run `pytest tests/quantum/test_core.py`; fix failures.
3. Run `scripts/run_quantum.py ablation`, `lottery`, `pareto`; check JSON validates.
4. Collect the subagent work for M5/M6/M7/M3: run their tests, run their stages, review.
5. Run `scripts/run_replay.py --solver quantum`.
6. M8: report + `scripts/fill_report.py` + README + `docs/demo_script.md`.
7. `docs/AREAS.md`, `docs/KNOWN_ISSUES.md`, clean-venv `make test` and `make demo`, push.
