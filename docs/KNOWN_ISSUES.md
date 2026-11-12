# Known issues

Honesty rule: anything that does not work is listed in this file as NOT WORKING, and the
dashboard shows "not available" for it. Nothing is hidden, faked or quietly dropped. If a result
is partial or synthetic, say so here and in the UI.

Status words: **NOT WORKING** (fails), **limit** (works, with a stated restriction), **partial**.

| Item | Status | Detail | What to try next | Owner area |
| --- | --- | --- | --- | --- |
| MPS scaling, `scale_8x2` at chi=2 | limit | One of 40 points: the Aer worker process crashed (Windows access violation) at bond dimension 2 on 12 qubits. Recorded as `failed` with no numbers; every other point ran. | Re-run on Linux; if it still crashes, try `mps_swap_direction="mps_swap_left"` for that point only. | Area 1 |
| MPS scaling, qubit layout | limit | The "interleaved" layout (same feeder on neighbouring sites) crashes Aer 0.18.2 on Windows at 16 qubits (exit 0xC0000409). The stage uses the default layout. | Try `ordering="interleaved"` on Linux; it should need a smaller bond dimension. | Area 1 |
| MPS memory pre-check | limit | Aer's MPS memory estimate is far too high (28 qubits: "57345 MB required"), so `max_memory_mb` is raised to 4 TB. Real use is bounded by the bond dimension; each point still runs in an isolated worker with a time limit. | None needed unless a point is killed for memory. | Area 1 |
| Risk block size | limit | The spec asks for a 4-6 feeder block. The risk stage uses the 8-feeder replay cluster, because with 4-6 feeders the uncovered shortfall is zero in every residual scenario. The loss is the MW the peak-hour plan does not cover. | Use a larger residual spread or smaller feeders to make a 4-6 feeder block meaningful. | Area 1 |
| Pareto point at fairness weight 1.0 | limit | The QAOA decision rule (best valid of 256 shots) returns cost 11.0 where the exact optimum is 10.5. The other 5 weights match exact. Shown as "matches_exact: false". | More shots or p=3 for the decision rule. | Area 1 |
| Replay frames worse than exact | limit | 3 of 12 frames (16:00, 17:00, 19:00) commit a plan whose window cost is above the exact optimum. All 12 plans are valid and pass the audit. | Same as above: more shots or layers in `solve_window`. | Area 1 |
| Cross-machine reproducibility | limit | Fixed seeds reproduce results on one machine. COBYLA angles differ in the 4th decimal between machines (BLAS/OS), so sampled counts can differ slightly across machines. | None; tests compare runs on the same machine. | Area 1 |
| GAS runtime on StatevectorSampler | limit | GroverOptimizer with qiskit's StatevectorSampler took 258 s for 10 runs. The stage uses the Aer sampler (9.4 s for 20 runs). | Keep the Aer sampler. | Area 1 |
| UI smoke test in CI | limit | `tests/ui/test_ui_smoke.py` needs Node 22+ and Chrome/Chromium/Edge. It skips (with the reason) when either is missing, so CI may report it as skipped. | Add `actions/setup-node@v4` with Node 22 to the CI workflow. | Area 3 |
| Weather data | limit | Weather is a committed snapshot of the real Open-Meteo archive; demand, supply and shortfall are synthetic. `forecast.json` says so in `weather_provenance` and `demand_provenance`. | None. | Area 2 |
