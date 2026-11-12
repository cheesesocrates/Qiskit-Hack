"""Shared pytest plumbing (shared file: change rarely).

1. Puts the repo root on sys.path so tests can `import src...`.
2. Collects "proof checks": any test marked
       @pytest.mark.check(id="Q03", name="Every Grover-mixer sample is a valid plan")
   is recorded and merged into results/checks.json at the end of the run. A test can attach
   a one-line detail with the `check_detail` fixture:  check_detail("4500 of 4500 valid").
   Set FAIRSHED_NO_CHECKS=1 to disable writing.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

CHECKS_PATH = ROOT / "results" / "checks.json"
_RECORDS: dict = {}


def pytest_configure(config):
    config.addinivalue_line("markers", "check(id, name): record this test as a proof check in results/checks.json")
    config.addinivalue_line("markers", "slow: long-running test")


@pytest.fixture
def check_detail(request):
    def _set(text) -> None:
        request.node._check_detail = str(text)
    return _set


def _area(nodeid: str) -> str:
    for key in ("quantum", "classical", "ui"):
        if f"tests/{key}/" in nodeid.replace("\\", "/"):
            return key
    return "shared"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    marker = item.get_closest_marker("check")
    if marker is None or rep.skipped:
        return
    if rep.when == "call" or (rep.when == "setup" and rep.failed):
        cid = marker.kwargs.get("id") or (marker.args[0] if marker.args else item.name)
        name = marker.kwargs.get("name") or (marker.args[1] if len(marker.args) > 1 else item.name)
        detail = getattr(item, "_check_detail", "")
        if rep.failed:
            detail = (str(rep.longrepr).strip().splitlines() or ["failed"])[-1][:300]
        prev = _RECORDS.get(cid)
        passed = bool(rep.passed) and (prev["passed"] if prev else True)
        if prev and not prev["passed"]:
            detail = prev["detail"]
        elif prev and rep.passed and not detail:
            detail = prev["detail"]
        _RECORDS[cid] = {"id": cid, "name": name, "passed": passed, "detail": detail,
                         "area": _area(item.nodeid), "test": item.nodeid.split("[")[0]}


def pytest_sessionfinish(session, exitstatus):
    if not _RECORDS or os.environ.get("FAIRSHED_NO_CHECKS"):
        return
    merged: dict = {}
    if CHECKS_PATH.exists():
        try:
            for row in json.loads(CHECKS_PATH.read_text(encoding="utf-8")).get("checks", []):
                merged[row["id"]] = row
        except Exception:
            merged = {}
    merged.update(_RECORDS)
    rows = [merged[k] for k in sorted(merged)]
    n_pass = sum(1 for r in rows if r["passed"])
    doc = {
        "schema_version": "1.0",
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": 0,
        "source": "tests/conftest.py (pytest run)",
        "data_provenance": "synthetic",
        "checks": rows,
        "summary": {"total": len(rows), "passed": n_pass, "failed": len(rows) - n_pass},
    }
    CHECKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CHECKS_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8", newline="\n")
