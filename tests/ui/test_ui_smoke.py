"""UI smoke test (Area 3): every dashboard screen loads with no console errors.

Runs scripts/ui_smoke.mjs (Node 22+ and a Chrome, Chromium or Edge install). Skips, with the
reason, when either is missing, so `make test` still works on machines without a browser.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.check(id="U01", name="Every dashboard screen loads with no console errors (headless browser)")
def test_every_screen_loads(check_detail):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    proc = subprocess.run([node, str(ROOT / "scripts" / "ui_smoke.mjs")], cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=600)
    out = proc.stdout + proc.stderr
    if proc.returncode == 2:
        pytest.skip("ui smoke test could not start: " + out.strip().splitlines()[-1])
    assert proc.returncode == 0, out
    passed = sum(1 for line in out.splitlines() if line.startswith("PASS"))
    check_detail(f"{passed} of 7 screens loaded with no console errors")
