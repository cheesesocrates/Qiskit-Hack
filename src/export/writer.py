"""Results writer for Area 2: adds the meta fields, validates against the schema, writes JSON.

Area 1 (quantum) has its own copy of this idea in src/quantum/io.py on purpose: the areas
share the JSON contract, not Python code.
"""
from __future__ import annotations

import datetime as _dt
import fnmatch
import json
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
SCHEMAS = ROOT / "schemas"
SCHEMA_VERSION = "1.0"


def schema_for(rel_path: str) -> dict:
    """Schema that governs a path relative to results/ (see schemas/index.json)."""
    index = json.loads((SCHEMAS / "index.json").read_text(encoding="utf-8"))["files"]
    for pattern, name in index.items():
        if fnmatch.fnmatch(rel_path, pattern):
            return json.loads((SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8"))
    raise KeyError(f"no schema registered for results/{rel_path}")


def with_meta(payload: dict, seed: int, source: str) -> dict:
    doc = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": int(seed),
        "source": source,
        "data_provenance": "synthetic",
    }
    doc.update(payload)
    return doc


def write_result(rel_path: str, payload: dict, seed: int, source: str) -> Path:
    """Write results/<rel_path> (for example 'plans/base.json').

    Raises ValueError listing the schema errors instead of writing an invalid file.
    """
    doc = with_meta(payload, seed, source)
    errors = sorted(Draft202012Validator(schema_for(rel_path)).iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        lines = [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message[:160]}" for e in errors[:10]]
        raise ValueError(f"results/{rel_path} does not match its schema:\n  " + "\n  ".join(lines))
    path = RESULTS / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path


def read_result(rel_path: str) -> dict:
    return json.loads((RESULTS / rel_path).read_text(encoding="utf-8"))


def strip_volatile(doc: dict) -> dict:
    """Copy without fields that legitimately change between identical runs (for reproducibility tests)."""
    volatile = {"generated_at", "runtime_s"}
    if isinstance(doc, dict):
        return {k: strip_volatile(v) for k, v in doc.items() if k not in volatile}
    if isinstance(doc, list):
        return [strip_volatile(v) for v in doc]
    return doc
