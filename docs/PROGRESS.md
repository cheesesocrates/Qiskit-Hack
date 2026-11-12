# FairShed build progress

Resume file. A fresh session reads this first, then `docs/SPEC.md` (the full brief),
`docs/CONTRACT.md` (data contract), `docs/KNOWN_ISSUES.md`, `docs/AREAS.md` and
`docs/HANDOFF_PROMPT.md` (copy-paste prompt).

Status words: **done** (built, run, tests pass), **partial** (code exists, not fully run or
verified), **not started**, **not working** (tried, fails: see `docs/KNOWN_ISSUES.md`).

## RESUME HERE

- Updated: 2026-11-12 17:38 PKT (UTC+5), session 2 (resume session).
- Deadline: 2026-11-12 23:59 PKT. Code freeze 22:59. Tag `v1.0-submission` and push by 23:30.
- Remote: `https://github.com/cheesesocrates/Qiskit-Hack` (origin). CI on push to main.
- Last commit before this session: `38d151d` ("hi"). CI on `38d151d`: success.
- Passing: `pytest -q` 51 passed, 0 failed (22 s). `scripts/validate_results.py`: 18 valid,
  2 missing (`risk.json`, `scaling.json`), 0 invalid.
- Half-finished: `src/quantum/scaling.py` (no `run_scaling`, no `__main__`), `src/quantum/risk.py`
  and `src/quantum/gas.py` do not exist, five UI screens are stubs.
- Next command: `.venv/Scripts/python.exe -m pytest -q` (confirm green), then continue the
  "Next steps" list at the bottom.

## Session 2 verification log (what was actually run)

| Command | Result |
|---|---|
| `date` | Thu Nov 12 17:22 PKT 2026 |
| `git remote -v` | origin `https://github.com/cheesesocrates/Qiskit-Hack` |
| `gh run list` | `38d151d` ci success; `fb6b102` ci failure (Makefile was missing then) |
| `py install 3.11` then `py -V:3.11 -m venv .venv`, `pip install -r requirements.txt` | Python 3.11.9; qiskit 2.6.2, qiskit-aer 0.18.2, qiskit-algorithms 0.4.0, qiskit-optimization 0.7.0, numpy 2.4.6, scipy 1.17.1 installed. The machine had only Python 3.14. |
| `.venv/Scripts/python.exe -m pytest -q` | 51 passed in 22 s |
| `.venv/Scripts/python.exe scripts/validate_results.py` | 18 valid, 2 missing, 0 invalid (after counting ran) |
| `scripts/run_quantum.py counting` | ok in 2.5 s, wrote `results/counting.json` |
| `scripts/run_quantum.py scaling` | FAILED: `ImportError: cannot import name 'run_scaling'` |

## Milestones

| # | Milestone | Status | Evidence |
|---|---|---|---|
| M1 | Repo skeleton, schemas, CI, git docs | partial | `Makefile` and `scripts/tasks.py` exist (added in `38d151d`); CI green on `38d151d`. Missing: `docs/AREAS.md`. |
| M2 | Generator, cost model, baselines, exporters | done | `tests/classical` all pass inside the 51. |
| M3 | Static dashboard: Plan, Compare/Proof | partial | `ui/js/screens/plan.js` (298 lines) and `compare.js` (151 lines) are real. No smoke test yet. |
| M4 | Three QAOA variants + ablation/lottery/pareto | partial | `tests/quantum/test_core.py` passes (Q01-Q09). `results/ablation.json`, `lottery.json`, `pareto.json` exist and validate, written 12:08-12:09 UTC by session 1. GAS rows missing (no `src/quantum/gas.py`). |
| M5 | Counting, risk (AE), Grover Adaptive Search | partial | Counting done (`results/counting.json`, exact 9, estimate in CI). `risk.py` and `gas.py` do not exist. No counting test. |
| M6 | Audit, replay, ridge forecast | partial | `audit_example.json`, `forecast.json`, `replay.json` exist and validate. Replay was run with `--solver exact` only. UI screens are stubs. |
| M7 | MPS scaling | partial | `src/quantum/scaling.py` lacks `run_scaling()` and the `--worker` entry point. |
| M8 | Report, README, demo script | not started | |
| M9 | Final pass from a clean venv | not started | |

## Spec coverage checklist

| Requirement | Status | File | Evidence |
|---|---|---|---|
| Q1 Dicke + XY-mixer QAOA | done | `src/quantum/{dicke,circuits,qaoa}.py` | Q02, Q04 pass; ablation rows `xy_qaoa_p1`, `xy_qaoa_p3` |
| Q2 Grover-mixer QAOA | done | `src/quantum/circuits.py` | Q05, Q06 pass; ablation rows `grover_qaoa_p1/p3`; lottery tie spread 5.6e-18 |
| Q3 Penalty QAOA (X mixer) | done | `src/quantum/circuits.py` | Q08 pass; ablation rows `penalty_qaoa_p1/p3` |
| Q4 Counting by IAE | done | `src/quantum/counting.py` | `results/counting.json` valid; test missing |
| Q5 Risk / CVaR by AE | not started | `src/quantum/risk.py` (missing) | |
| Q6 Grover Adaptive Search | not started | `src/quantum/gas.py` (missing) | ablation notes say "No module named 'src.quantum.gas'" |
| Q7 MPS scaling | partial | `src/quantum/scaling.py` | ImportError on `run_scaling` |
| UI Plan | partial | `ui/js/screens/plan.js` | not smoke-tested |
| UI Compare and proof | partial | `ui/js/screens/compare.js` | not smoke-tested |
| UI Audit | not started | `ui/js/screens/audit.js` (2-line stub) | |
| UI Replay | not started | `ui/js/screens/replay.js` (stub) | |
| UI Risk and counting | not started | `ui/js/screens/risk.js` (stub) | |
| UI Scale | not started | `ui/js/screens/scale.js` (stub) | |
| UI Forecast | not started | `ui/js/screens/forecast.js` (stub) | |
| Test: cost model equals classical cost | done | `tests/classical/test_cls_cost_model.py` C01, `tests/quantum/test_core.py` Q01 | pass |
| Test: XY and Grover samples valid | done | Q04, Q05 | pass |
| Test: Dicke uniform weight-m | done | Q02 | pass |
| Test: equal-cost equal Grover amplitude | done | Q06 | pass |
| Test: counting within tolerance of enumeration | not started | | |
| Test: bit ordering | done | Q03, C09 | pass |
| Test: fixed seeds reproduce | done | Q07, C06, C14 | pass |
| Test: all JSON validates | done | S03, `tests/classical/test_cls_results.py` | pass |
| Baselines (exact, round-robin, random-valid, MILP) | done | `src/classical` | C02-C05 pass |
| Audit mode | done | `src/audit/rules.py`, `results/audit_example.json` | C07 pass |
| Replay (receding horizon) | partial | `src/replan/engine.py`, `results/replay.json` | C12-C14 pass; exact solver only so far |
| Forecast (ridge) | done | `src/forecast`, `results/forecast.json` | C10, C11 pass |
| Report (markdown + .docx) | not started | `docs/report/` | |
| README | not started | `README.md` | |
| Demo script | not started | `docs/demo_script.md` | |
| `docs/AREAS.md` | not started | | |
| CI | done | `.github/workflows/ci.yml` | green on `38d151d` |

## Results files

| File | Exists | Schema-valid | generated_at (UTC) |
|---|---|---|---|
| instance.json, plans/*.json (9) | yes | yes | rewritten by every `pytest` run |
| ablation.json | yes | yes | 2026-11-12T12:08:24Z (session 1) |
| lottery.json | yes | yes | 2026-11-12T12:08:28Z (session 1) |
| pareto.json | yes | yes | 2026-11-12T12:09:36Z (session 1) |
| counting.json | yes | yes | 2026-11-12T12:26:16Z (session 2) |
| forecast.json | yes | yes | 2026-11-12T12:08:46Z |
| replay.json | yes | yes | 2026-11-12T12:08:53Z (solver exact) |
| audit_example.json | yes | yes | rewritten by `pytest` |
| checks.json | yes | yes | rewritten by `pytest` |
| risk.json | no | | |
| scaling.json | no | | |

## Decisions made

Session 1 (do not re-litigate):
- Areas talk only through `results/*.json` + `schemas/`. Area 1 never imports Area 2 code;
  it reads the QUBO from `results/plans/<scenario>.json` (`instance.qubo.terms`, unweighted).
- `bits` in results are index-ordered (`bits[t*N+f]`), the reverse of Qiskit count keys.
- Circuits use a compact register (no qubit for protected feeders): 8x3 gives 18 qubits.
- The replay calls the quantum solver as a subprocess through JSON files
  (`scripts/run_quantum.py solve-window`), falling back to exact per frame and saying so.
- Decision rule for a QAOA plan: best valid sample among 256 shots.
- UI: IBM Plex Sans/Mono, dark slate, colour only for feeder state, one iris accent.
- Proof checks: tests marked `@pytest.mark.check(id, name)` are merged into `results/checks.json`.

Session 2:
- Python 3.11.9 installed with the Windows `py install 3.11` manager because only 3.14 was present. Pins unchanged.
- `pytest` rewrites `generated_at` in the classical results files. Data is otherwise identical
  (checked with `git diff`). Those timestamp changes are committed as they are.
- Q07 reproducibility holds within one machine; angles differ in the 4th decimal between
  machines (session 1 recorded -0.6916, this machine -0.6918).

## Real numbers (copied from results JSON, base 8x3 seed 7 unless noted)

From `results/ablation.json` (session 1 run, to be refreshed): exact cost 10.5 over 4500 valid
plans; round-robin cost 12.0, ratio 0.952; random-valid mean ratio 0.619; Dicke-only sampled
P(optimal) 0.0022 (exact state 0.0009); XY p=1 sampled P(optimal) 0.0078, ratio 0.787;
Grover p=3 sampled P(optimal) 0.0093, ratio 0.846; penalty p=1 19.4% valid, ratio 0.124.
From `results/counting.json`: block 4x2, exact count 9, IAE estimate 9.07, 95% CI [8.90, 9.23].

## Next steps, in order

1. Write `src/quantum/gas.py` (GroverOptimizer on block_4x2), `run_scaling()` in `scaling.py`,
   `tests/quantum/test_counting.py`; rerun `scripts/run_quantum.py all`.
2. UI smoke test script; check Plan and Compare render real results with no console errors.
3. README, `scripts/fill_report.py`, `docs/report/` (markdown + .docx + diagram), `docs/demo_script.md`, `docs/AREAS.md`.
4. `src/quantum/risk.py`; replay with `--solver quantum`; Audit, Replay, Forecast, Risk, Scale screens.
5. Clean-clone `make test` and `make demo`; tag `v1.0-submission`.
