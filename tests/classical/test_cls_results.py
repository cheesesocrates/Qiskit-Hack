"""The classical results files validate against their schemas (Area 2)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from src.classical.plans import build_plans
from src.data.generator import base_instance
from src.data.scenarios import SCENARIOS
from src.export.writer import schema_for, with_meta

ROOT = Path(__file__).resolve().parents[2]


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def errors(rel_path: str, payload: dict) -> list:
    doc = with_meta(payload, 7, "test")
    return [e.message[:120] for e in Draft202012Validator(schema_for(rel_path)).iter_errors(doc)]


def test_payloads_validate_in_memory():
    assert errors("instance.json", base_instance().to_dict()) == []
    for name in SCENARIOS:
        assert errors(f"plans/{name}.json", build_plans(name, n_samples=100)) == [], name


def test_written_results_validate(monkeypatch):
    """Run both scripts (they write results/) and validate every file they produced."""
    monkeypatch.setattr(sys, "argv", ["run_classical.py"])
    assert load_script("run_classical").main() == 0
    monkeypatch.setattr(sys, "argv", ["run_audit.py"])
    assert load_script("run_audit").main() == 0

    validate = load_script("validate_results")
    ok, _missing, invalid = validate.run()
    mine = {"instance.json", "audit_example.json"} | {f"plans/{n}.json" for n in SCENARIOS}
    assert not [f for f in invalid if f in mine], {f: e for f, e in invalid.items() if f in mine}
    assert mine <= set(ok)

    doc = json.loads((ROOT / "results" / "plans" / "heatwave_cap.json").read_text(encoding="utf-8"))
    assert doc["data_provenance"] == "synthetic" and doc["exact"]["method"] == "brute_force"
    assert [p["method"] for p in doc["plans"]] == ["exact", "round_robin", "random_valid"]
