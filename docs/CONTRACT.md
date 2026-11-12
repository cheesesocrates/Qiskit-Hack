# FairShed data contract

The three areas never import each other's code. They talk only through the JSON files in
`results/`, whose shapes are fixed by `schemas/*.schema.json`. This file explains the
conventions those schemas cannot express. It is a shared file: change it rarely, by PR,
with all three owners agreeing.

To change a schema: edit `schemas/build_schemas.py`, run `python schemas/build_schemas.py`,
commit both. `tests/test_schemas.py` fails if they drift.

## 1. Variables and bit order (read this twice)

- `N = n_feeders`, `T = n_hours`. `x[t][f] = 1` means feeder `f` is **off** in hour `t`.
- Logical qubit / variable index: `q = t*N + f`.
- **`bits` strings in every results file are index-ordered:** `bits[q]` is the value of
  variable `q`. Character 0 is `x[0][0]`. Length is `T*N`.
- **This is the reverse of Qiskit's display order.** Qiskit count keys put qubit 0 on the
  right. Area 1 must reverse (and re-insert protected feeders as `0`) before writing.
  `tests/quantum/test_bit_order.py` guards this.
- `matrix` is the same plan as `T` rows of `N` integers: `matrix[t][f] = int(bits[t*N+f])`.
- Circuits may use a *compact* register that skips protected feeders (they are always 0).
  Compact order keeps the same relative order of the remaining `q`. Results always use the
  full logical `bits`.

## 2. Cost model

```
C(x) = w_h * hardship(x) + w_f * fairness(x) + w_c * consecutive(x)

hardship(x)    = sum_t sum_f  hardship[t][f] * x[t][f]
fairness(x)    = sum_f ( ledger_hours[f] + sum_t x[t][f] - mu )^2
consecutive(x) = sum_f sum_{t<T-1} x[t][f]*x[t+1][f]  +  sum_f prev_off[f]*x[0][f]

mu = fairness_target = ( sum_f ledger_hours[f] + sum_t quotas[t] ) / (number of non-protected feeders)
```

**Every `sum_f` above runs over non-protected feeders only.** Protected variables therefore
have zero coefficients in all three terms; a plan that switches a protected feeder off is
not more expensive, it is simply invalid.

- `weights = {hardship: w_h, fairness: w_f, consecutive: w_c}`.
- `breakdown` objects hold the **unweighted** term values.
- `ledger_hours[f]`: outage hours already served by feeder `f` before this window.
- `prev_off[f]`: 1 if feeder `f` was off in the hour just before the window.
- `mu` is a constant of the instance (it uses the quotas, not `x`), so every term is a
  QUBO and the cost is defined on all `2^(T*N)` bitstrings, valid or not.

Hard constraints (a plan is **valid / feasible** only if both hold):

1. Quota: for every hour `t`, `sum_f x[t][f] == quotas[t]`.
2. Protected: `x[t][f] == 0` for every protected feeder.

`quotas[t] = ceil(shortfall_mw[t] / feeder_mw)` (feeders are equal-size).

## 3. QUBO export (`instance.qubo`)

`qubo.terms.<hardship|fairness|consecutive>` each hold `{offset, linear, quadratic}` over
the logical index `q`:

```
term(x) = offset + sum_i linear[i]*x_i + sum_{[i,j,w] in quadratic} w * x_i * x_j      (i < j)
C(x)    = sum_k weights[k] * term_k(x)
```

Terms are exported **unweighted** so Area 1 can re-weight (the Pareto sweep changes only
`w_f`) without touching Area 2 code. Protected variables stay in the index space with zero
coefficients. Ising/Pauli form: substitute `x_i = (1 - Z_i)/2`.

## 4. Derived metrics (same definition in every area)

- `approx_ratio` of one valid plan: `(cost_max - C(x)) / (cost_max - cost_min)` over valid
  plans; 1.0 is optimal. An invalid sample scores 0. A method's `approx_ratio` is the mean
  over all its samples (so infeasibility is penalised, not hidden).
- `p_optimal`: fraction of samples with `C(x) <= cost_min + 1e-9` and valid.
- `feasibility_pct`: percent of samples that are valid.
- `fairness_entropy`: with `H_f = ledger_hours[f] + expected plan hours of f` over
  non-protected feeders and `p_f = H_f / sum H_f`, it is `-sum p_f ln p_f / ln(n_free)`.
  1.0 means the burden is spread perfectly evenly. If all `H_f` are 0 it is 1.0.
- `fairness_metric` (pareto): standard deviation of `H_f` over non-protected feeders, in hours.

## 5. Meta fields

Every results file starts with:

| field | meaning |
|---|---|
| `schema_version` | `"1.0"` |
| `generated_at` | ISO-8601 UTC timestamp |
| `seed` | integer seed that reproduces the file |
| `source` | script or module that wrote it |
| `data_provenance` | always `"synthetic"` (feeders, demand and ledger are synthetic) |

Weather in `forecast.json` may be real (Open-Meteo); it says so in `weather_provenance`.
The demand and shortfall series are synthetic in every case.

## 6. Who writes what

| file | written by | read by |
|---|---|---|
| `instance.json` | Area 2 `scripts/run_classical.py` | 1, 3 |
| `plans/<scenario>.json` | Area 2 `scripts/run_classical.py` | 1, 3 |
| `forecast.json` | Area 2 `scripts/run_forecast.py` | 1 (risk), 3 |
| `audit_example.json` | Area 2 `scripts/run_audit.py` | 3 |
| `replay.json` | Area 2 `scripts/run_replay.py` | 3 |
| `ablation.json`, `lottery.json`, `pareto.json` | Area 1 `scripts/run_quantum.py` | 3, report |
| `counting.json`, `risk.json`, `scaling.json` | Area 1 `scripts/run_quantum.py` | 3, report |
| `checks.json` | shared `tests/conftest.py` (any `make test`) | 3, report |

Scenario files Area 2 always writes to `results/plans/`:
`base` (8x3, quotas 3,2,4), `heatwave_cap` (round-robin and random fail), `block_4x2`
(8 variables: counting and Grover Adaptive Search), and `scale_<N>x<T>` instances for the
MPS scaling curve. Each embeds its instance and the exact reference (`exact.cost_min`,
`exact.cost_max`, `exact.method`).

### Optional fields in `scaling.json` (added after `v1.1-submission`)

Readers must treat these as optional: files written before the change do not have them.

- top level `layout`: the qubit layout of `points` on the MPS chain (`default`, `paired` or
  `interleaved`; see `qubit_positions` in `src/quantum/scaling.py`).
- per point `fidelity`: overlap of the simulated final state with the exact one, |<exact|mps>|^2
  (1 = exact; measured up to 20 qubits, null above); `max_bond_dim_used`: the largest bond
  dimension of that run's final MPS; `mps_memory_mb`: the memory of that MPS. For the
  statevector point (`bond_dim` null) the last two are null and `fidelity` is 1 by definition.

### The one cross-area call: the window solver

The replay (Area 2) can ask the quantum area to solve a window. It does so through files,
not imports:

```
python scripts/run_quantum.py solve-window --in results/tmp/window_in.json --out results/tmp/window_out.json
```

- `window_in.json`: `{"instance": <instance object>, "warm_start": <opaque object or null>, "seed": int}`
- `window_out.json`: `{"bits": "<T*N index-ordered>", "cost": number, "feasible": bool,
  "method": str, "p_optimal": number|null, "runtime_s": number, "warm_start": <opaque object for the next call>}`

If the command fails or returns an infeasible plan, the replay falls back to the exact
solver for that frame and records `solver_used` honestly.

## 7. Proof checks

Tests mark themselves with `@pytest.mark.check(id="Q03", name="...")`. `tests/conftest.py`
collects them and merges them into `results/checks.json`. A test can attach a short detail
string with the `check_detail` fixture: `check_detail("924 of 924 samples valid")`.
ID prefixes: `C` classical, `Q` quantum, `S` shared/schema, `U` UI.

## 8. Honesty rules that bind every area

- Never write a number that was not computed by the code in this repo on this machine.
- If a stage fails, do not write a fake file. Leave the file out (the dashboard shows
  "not available") and add a row to `docs/KNOWN_ISSUES.md`.
- Simulator only. No speedup claims. Synthetic data is labelled synthetic.
