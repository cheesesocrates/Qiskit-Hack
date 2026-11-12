"""Validate every results/*.json against schemas/ (shared file).

Usage:  python scripts/validate_results.py [--strict]
Exit code 1 if any present file is invalid. Missing files are listed as warnings and only
fail the run with --strict (the dashboard shows "not available" for them).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
SCHEMAS = ROOT / "schemas"


def load_index() -> dict:
    return json.loads((SCHEMAS / "index.json").read_text(encoding="utf-8"))["files"]


def validate_file(path: Path, schema_name: str) -> list:
    schema = json.loads((SCHEMAS / f"{schema_name}.schema.json").read_text(encoding="utf-8"))
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # unreadable JSON is an error, not a crash
        return [f"not valid JSON: {exc}"]
    errors = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path))
    return [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message[:200]}" for e in errors]


def run(strict: bool = False) -> tuple:
    """Return (ok_files, missing_patterns, invalid: {file: [errors]})."""
    ok, missing, invalid = [], [], {}
    for pattern, schema_name in load_index().items():
        paths = sorted(RESULTS.glob(pattern))
        if not paths:
            missing.append(pattern)
            continue
        for p in paths:
            errs = validate_file(p, schema_name)
            rel = p.relative_to(RESULTS).as_posix()
            if errs:
                invalid[rel] = errs
            else:
                ok.append(rel)
    return ok, missing, invalid


def main() -> int:
    strict = "--strict" in sys.argv
    ok, missing, invalid = run(strict)
    for f in ok:
        print(f"  ok       results/{f}")
    for f in missing:
        print(f"  MISSING  results/{f}")
    for f, errs in invalid.items():
        print(f"  INVALID  results/{f}")
        for e in errs[:8]:
            print(f"           - {e}")
    print(f"{len(ok)} valid, {len(missing)} missing, {len(invalid)} invalid")
    return 1 if invalid or (strict and missing) else 0


if __name__ == "__main__":
    sys.exit(main())
