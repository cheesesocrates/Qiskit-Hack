"""Area 1 file I/O. Reads the JSON contract, writes schema-checked results.

Deliberately independent of src/export (Area 2): the areas share JSON, not code.
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


def load_json(rel_path: str) -> dict:
    """Load results/<rel_path>. Raises FileNotFoundError with a helpful message."""
    path = RESULTS / rel_path
    if not path.exists():
        raise FileNotFoundError(f"results/{rel_path} not found - run scripts/run_classical.py first")
    return json.loads(path.read_text(encoding="utf-8"))


def load_scenario(name: str) -> dict:
    """results/plans/<name>.json: {'instance': ..., 'exact': ..., 'plans': [...]}."""
    return load_json(f"plans/{name}.json")


def _schema_for(rel_path: str) -> dict:
    index = json.loads((SCHEMAS / "index.json").read_text(encoding="utf-8"))["files"]
    for pattern, name in index.items():
        if fnmatch.fnmatch(rel_path, pattern):
            return json.loads((SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8"))
    raise KeyError(f"no schema registered for results/{rel_path}")


def write_result(rel_path: str, payload: dict, seed: int, source: str) -> Path:
    """Add meta fields, validate against the schema, write results/<rel_path>."""
    doc = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": int(seed),
        "source": source,
        "data_provenance": "synthetic",
    }
    doc.update(payload)
    errors = sorted(Draft202012Validator(_schema_for(rel_path)).iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        lines = [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message[:160]}" for e in errors[:10]]
        raise ValueError(f"results/{rel_path} does not match its schema:\n  " + "\n  ".join(lines))
    path = RESULTS / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path
