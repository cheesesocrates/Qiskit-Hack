"""Schema tests (shared)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
META = ("schema_version", "generated_at", "seed", "source", "data_provenance")


def _builder():
    spec = importlib.util.spec_from_file_location("build_schemas", SCHEMAS / "build_schemas.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _validator():
    spec = importlib.util.spec_from_file_location("validate_results", ROOT / "scripts" / "validate_results.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.check(id="S01", name="Committed schemas match schemas/build_schemas.py")
def test_schemas_match_builder(check_detail):
    rendered = _builder().render()
    for fname, text in rendered.items():
        on_disk = (SCHEMAS / fname).read_text(encoding="utf-8")
        assert json.loads(on_disk) == json.loads(text), f"{fname} is stale: run python schemas/build_schemas.py"
    check_detail(f"{len(rendered)} schema files in sync")


@pytest.mark.check(id="S02", name="Every schema is valid and requires the five meta fields")
def test_schemas_are_wellformed(check_detail):
    names = sorted(p for p in SCHEMAS.glob("*.schema.json"))
    assert len(names) >= 12
    for p in names:
        schema = json.loads(p.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        for key in META:
            assert key in schema["required"], f"{p.name} does not require {key}"
        assert schema["properties"]["data_provenance"] == {"const": "synthetic"}
    check_detail(f"{len(names)} schemas checked")


@pytest.mark.check(id="S03", name="All results JSON files validate against their schemas")
def test_results_validate(check_detail):
    ok, missing, invalid = _validator().run()
    assert not invalid, f"invalid results files: {invalid}"
    check_detail(f"{len(ok)} files valid, {len(missing)} not generated yet")
