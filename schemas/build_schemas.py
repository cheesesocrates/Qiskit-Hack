"""Single source of truth for the JSON Schemas in this folder.

Edit this file, then run:  python schemas/build_schemas.py
A test (tests/test_schemas.py) fails if the committed *.schema.json files drift from it.

Only a small JSON Schema subset is used on purpose, so the dashboard's tiny validator
(ui/js/validate.js) can check the same files in the browser:
  type (string or list), properties, required, items, enum, const, minimum, maximum,
  minItems, maxItems, pattern.   No $ref, no oneOf/anyOf.
Unknown extra properties are always allowed (forward compatible).
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_VERSION = "1.0"

S = {"type": "string"}
N = {"type": "number"}
I = {"type": "integer"}
B = {"type": "boolean"}
N0 = {"type": ["number", "null"]}
I0 = {"type": ["integer", "null"]}
S0 = {"type": ["string", "null"]}
B0 = {"type": ["boolean", "null"]}
BITS = {"type": "string", "pattern": "^[01]+$"}
BITS0 = {"type": ["string", "null"], "pattern": "^[01]+$"}
PCT = {"type": "number", "minimum": 0, "maximum": 100}
PROB = {"type": "number", "minimum": 0, "maximum": 1}
PROB0 = {"type": ["number", "null"], "minimum": 0, "maximum": 1}


def obj(props: dict, optional: tuple = (), desc: str | None = None) -> dict:
    """Object schema; every key is required unless listed in `optional`."""
    out = {"type": "object", "properties": props,
           "required": [k for k in props if k not in optional]}
    if desc:
        out["description"] = desc
    return out


def arr(items: dict, min_items: int | None = None) -> dict:
    out = {"type": "array", "items": items}
    if min_items is not None:
        out["minItems"] = min_items
    return out


def enum(*values) -> dict:
    return {"enum": list(values)}


META = {
    "schema_version": {"const": SCHEMA_VERSION},
    "generated_at": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}T"},
    "seed": I,
    "source": S,
    "data_provenance": {"const": "synthetic"},
}


def top(title: str, desc: str, props: dict, optional: tuple = ()) -> dict:
    allp = dict(META)
    allp.update(props)
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": title,
        "description": desc,
        "type": "object",
        "properties": allp,
        "required": [k for k in allp if k not in optional],
    }


MATRIX = arr(arr({"type": "integer", "minimum": 0, "maximum": 1}))
BREAKDOWN = obj({"hardship": N, "fairness": N, "consecutive": N},
                desc="Unweighted term values; cost = sum(weights[k] * breakdown[k]).")

QUBO_TERM = obj({
    "offset": N,
    "linear": arr(N),
    "quadratic": arr({"type": "array", "minItems": 3, "maxItems": 3}),
}, desc="value(x) = offset + sum_i linear[i]*x_i + sum_(i<j) w*x_i*x_j, quadratic rows are [i, j, w].")

FEEDER = obj({
    "id": I, "name": S, "zone": S,
    "kind": enum("residential", "commercial", "industrial", "hospital", "water_pump", "telecom"),
    "protected": B, "population": I, "heat_index": N, "lat": N, "lon": N,
})

INSTANCE_PROPS = {
    "name": S,
    "n_feeders": {"type": "integer", "minimum": 1},
    "n_hours": {"type": "integer", "minimum": 1},
    "start_hour": {"type": "integer", "minimum": 0, "maximum": 23},
    "feeder_mw": N,
    "shortfall_mw": arr(N),
    "quotas": arr({"type": "integer", "minimum": 0}),
    "feeders": arr(FEEDER, 1),
    "hardship": arr(arr(N)),
    "ledger_hours": arr(N),
    "prev_off": arr({"type": "integer", "minimum": 0, "maximum": 1}),
    "weights": obj({"hardship": N, "fairness": N, "consecutive": N}),
    "rules": obj({"max_consecutive": I, "max_daily_hours": N}),
    "fairness_target": N,
    "qubo": obj({
        "n_vars": I,
        "var_order": S,
        "terms": obj({"hardship": QUBO_TERM, "fairness": QUBO_TERM, "consecutive": QUBO_TERM}),
    }),
}
INSTANCE = obj(INSTANCE_PROPS, desc="Same shape as results/instance.json without the meta fields.")

PLAN_ROW = obj({
    "method": S, "label": S, "kind": enum("classical", "quantum"),
    "bits": BITS, "matrix": MATRIX, "cost": N, "breakdown": BREAKDOWN,
    "feasible": B, "approx_ratio": PROB0, "fairness_entropy": N0,
    "audit_passed": B, "n_violations": I, "notes": S,
})

SCHEMAS = {
    "instance": top(
        "instance", "Base problem instance (Area 2 writes, Areas 1 and 3 read).", INSTANCE_PROPS),

    "plans": top(
        "plans/<scenario>", "One scenario: its instance, the exact reference and classical baseline plans.", {
            "scenario": S,
            "description": S,
            "instance": INSTANCE,
            "exact": obj({
                "method": enum("brute_force", "milp"),
                "cost_min": N, "cost_max": N,
                "n_valid": I, "n_optimal": I0,
                "optimal_bits": arr(BITS),
            }),
            "plans": arr(PLAN_ROW, 1),
            "random_valid_stats": obj({
                "n_samples": I, "mean_cost": N, "mean_approx_ratio": N,
                "cap_violation_pct": PCT, "p_optimal": PROB,
            }),
        }),

    "ablation": top(
        "ablation", "Method comparison table (Area 1 writes).", {
            "instance_name": S,
            "reference": obj({"cost_min": N, "cost_max": N, "n_valid": I, "n_optimal": I0}),
            "rows": arr(obj({
                "method": S, "label": S, "kind": enum("classical", "quantum"), "instance": S,
                "n_qubits": I0, "layers": I0, "shots": I0,
                "feasibility_pct": PCT, "p_optimal": PROB, "approx_ratio": PROB,
                "fairness_entropy": N0, "runtime_s": N0,
                "best_cost": N0, "best_bits": BITS0, "notes": S,
            }), 1),
            "notes": S,
        }),

    "lottery": top(
        "lottery", "Sampled plans from the Grover-mixer circuit and per-feeder outage marginals.", {
            "method": S, "instance_name": S, "shots": I, "n_qubits": I, "layers": I,
            "all_feasible": B,
            "samples": arr(obj({
                "bits": BITS, "count": I, "prob": PROB, "cost": N, "feasible": B, "is_optimal": B,
            }), 1),
            "marginals": arr(arr(PROB)),
            "expected_hours": arr(N),
            "tie_groups": arr(obj({
                "cost": N, "n_plans": I, "prob_min": N, "prob_max": N, "prob_spread": N,
            })),
            "notes": S,
        }),

    "pareto": top(
        "pareto", "Precomputed plans across fairness weights (the dashboard's fairness slider).", {
            "instance_name": S, "method": S, "fairness_metric_name": S, "default_index": I,
            "points": arr(obj({
                "fairness_weight": N,
                "plan": obj({"bits": BITS, "matrix": MATRIX}),
                "cost": N, "breakdown": BREAKDOWN,
                "fairness_metric": N, "fairness_entropy": N, "hardship_total": N,
                "exact_cost": N, "matches_exact": B, "p_optimal": PROB,
            }), 1),
            "notes": S,
        }),

    "checks": top(
        "checks", "Proof checks written by the test run (tests/conftest.py).", {
            "checks": arr(obj({
                "id": S, "name": S, "passed": B, "detail": S,
                "area": enum("quantum", "classical", "ui", "shared"), "test": S,
            })),
            "summary": obj({"total": I, "passed": I, "failed": I}),
        }),

    "audit_example": top(
        "audit_example", "Audit of example schedules against the four rules.", {
            "scenario": S,
            "instance": INSTANCE,
            "rules": obj({"max_consecutive": I, "max_daily_hours": N}),
            "examples": arr(obj({
                "label": S, "method": S, "bits": BITS, "matrix": MATRIX,
                "passed": B, "score": {"type": "number", "minimum": 0, "maximum": 100},
                "violations": arr(obj({
                    "rule": enum("quota", "protected", "max_consecutive", "daily_hours"),
                    "hour": I0, "feeder": I0, "detail": S,
                })),
                "per_rule": obj({
                    "quota": obj({"passed": B, "count": I}),
                    "protected": obj({"passed": B, "count": I}),
                    "max_consecutive": obj({"passed": B, "count": I}),
                    "daily_hours": obj({"passed": B, "count": I}),
                }),
            }), 1),
        }),

    "replay": top(
        "replay", "Receding-horizon replay of one day, one frame per committed hour.", {
            "scenario": S, "horizon_hours": I, "n_feeders": I,
            "feeders": arr(FEEDER, 1),
            "solver_requested": S,
            "frames": arr(obj({
                "step": I,
                "hour": {"type": "integer", "minimum": 0, "maximum": 23},
                "shortfall_mw": N, "forecast_mw": N0,
                "quota": I,
                "plan": arr({"type": "integer", "minimum": 0, "maximum": 1}),
                "changed_from_previous": arr(I),
                "revised_vs_prior_plan": arr(I),
                "window_quotas": arr(I), "window_bits": BITS,
                "cost": N, "exact_cost": N0, "matches_exact": B0,
                "solver_used": S, "warm_started": B,
                "ledger_after": arr(N), "runtime_s": N, "audit_passed": B,
            }), 1),
            "summary": obj({
                "n_frames": I, "n_changed": I, "matches_exact_count": I0,
                "total_hardship": N, "fairness_spread_hours": N, "final_ledger": arr(N),
            }),
            "notes": S,
        }),

    "risk": top(
        "risk", "Tail risk (VaR / CVaR) on a small feeder block by amplitude estimation.", {
            "method": S,
            "block": obj({"n_feeders": I, "feeder_ids": arr(I), "critical_feeder_ids": arr(I), "description": S}),
            "alpha": PROB, "loss_unit": S, "residual_source": S,
            "scenarios": arr(obj({"label": S, "shortfall_extra_mw": N, "prob": PROB, "loss": N}), 2),
            "n_qubits": I, "epsilon_target": N, "confidence_alpha": N, "oracle_queries": I,
            "exact": obj({"expected_loss": N, "tail_prob": PROB, "var": N, "cvar": N}),
            "estimated": obj({
                "expected_loss": N, "expected_loss_ci": arr(N, 2),
                "tail_prob": N, "tail_prob_ci": arr(N, 2),
                "var": N, "cvar": N, "cvar_ci": arr(N, 2),
            }),
            "within_tolerance": B, "notes": S,
        }),

    "counting": top(
        "counting", "Quantum counting of valid plans (the flexibility number), checked by enumeration.", {
            "method": S,
            "instance": obj({"n_feeders": I, "n_hours": I, "quotas": arr(I), "protected": arr(I)}),
            "n_qubits_search": I, "n_qubits_total": I, "search_space": I,
            "exact_count": I, "estimated_count": N, "estimated_count_rounded": I,
            "ci": arr(N, 2), "tolerance": N, "within_tolerance": B,
            "epsilon_target": N, "confidence_alpha": N, "oracle_queries": I,
            "flexibility_bits": N, "notes": S,
        }),

    "scaling": top(
        "scaling", "MPS-simulator scaling: approximation ratio vs bond dimension vs feeders.", {
            "method": S, "layers": I, "shots": I, "parameter_source": S,
            "points": arr(obj({
                "n_feeders": I, "n_hours": I, "n_qubits": I,
                "bond_dim": I0, "simulator": S,
                "approx_ratio": PROB0, "feasibility_pct": {"type": ["number", "null"]},
                "exact_cost_min": N0, "exact_cost_max": N0, "exact_method": S0,
                "best_sampled_cost": N0, "runtime_s": N0,
                "status": enum("ok", "failed", "skipped"), "notes": S,
            }), 1),
            "notes": S,
        }),

    "forecast": top(
        "forecast", "Classical ridge-regression shortfall forecast. The demand series is synthetic.", {
            "label": {"const": "classical"},
            "model": obj({"type": S, "alpha": N, "features": arr(S), "n_train": I, "n_test": I}),
            "weather_source": enum("open-meteo-live", "open-meteo-snapshot", "synthetic-scenario-file"),
            "weather_provenance": enum("real", "synthetic"),
            "demand_provenance": {"const": "synthetic"},
            "location": S,
            "metrics": obj({"mae_mw": N, "rmse_mw": N, "r2": N}),
            "series": arr(obj({
                "time": S, "hour": I, "temperature_c": N,
                "shortfall_actual_mw": N, "shortfall_pred_mw": N,
                "split": enum("train", "test"),
            }), 1),
            "residuals": obj({
                "n": I, "std_mw": N,
                "bins": arr(obj({"lo": N, "hi": N, "mid": N, "prob": PROB}), 2),
            }),
            "day_ahead": arr(obj({"hour": I, "shortfall_pred_mw": N, "quota": I}), 1),
            "notes": S,
        }),
}

# results file (relative to results/)  ->  schema name
FILE_MAP = {
    "instance.json": "instance",
    "plans/*.json": "plans",
    "ablation.json": "ablation",
    "lottery.json": "lottery",
    "pareto.json": "pareto",
    "checks.json": "checks",
    "audit_example.json": "audit_example",
    "replay.json": "replay",
    "risk.json": "risk",
    "counting.json": "counting",
    "scaling.json": "scaling",
    "forecast.json": "forecast",
}


def render() -> dict[str, str]:
    """Return {filename: text} for every schema file plus the index."""
    out = {f"{name}.schema.json": json.dumps(schema, indent=2) + "\n" for name, schema in SCHEMAS.items()}
    out["index.json"] = json.dumps({"schema_version": SCHEMA_VERSION, "files": FILE_MAP}, indent=2) + "\n"
    return out


def main() -> None:
    for fname, text in render().items():
        (HERE / fname).write_text(text, encoding="utf-8", newline="\n")
        print("wrote", fname)


if __name__ == "__main__":
    main()
