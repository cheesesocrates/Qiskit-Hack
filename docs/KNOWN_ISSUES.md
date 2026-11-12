# Known issues

Honesty rule: anything that does not work is listed in this file as NOT WORKING, and the dashboard shows "not available" for it. Nothing is hidden, faked or quietly dropped. If a result is partial or synthetic, say so here and in the UI.

| Item | Status | Detail | Owner area |
| --- | --- | --- | --- |

<!-- rows are added below this line -->
| `results/scaling.json` (MPS scaling) | partial | `src/quantum/scaling.py` has the worker, simulator settings and scoring but no `run_scaling()` entry point, so `run_quantum.py scaling` fails with ImportError. Session 2 is finishing it. | Area 1 |
| Risk / CVaR by amplitude estimation | not started | `src/quantum/risk.py` does not exist; `results/risk.json` is not written; the Risk screen shows "not available". | Area 1 |
| Grover Adaptive Search comparator | not started | `src/quantum/gas.py` does not exist; the ablation notes say so and no GAS row is written. | Area 1 |
| Five dashboard screens | not started | Audit, Replay, Risk and counting, Scale, Forecast are 2-line stubs in `ui/js/screens/`. | Area 3 |
| Cross-machine reproducibility | known limit | Fixed seeds reproduce results on one machine. COBYLA angles differ in the 4th decimal between machines (BLAS/OS), so sampled counts can differ slightly across machines. | Area 1 |
