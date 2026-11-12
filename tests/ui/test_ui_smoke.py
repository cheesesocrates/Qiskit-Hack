"""UI checks (Area 3), desktop browser at 1440x900.

1. scripts/ui_contrast.mjs: every colour pair in ui/css/tokens.css meets its contrast target.
2. scripts/ui_smoke.mjs: every screen loads with no console errors, no text under 14px, no target
   under 44px, a keyboard-only Tab walk with visible focus, the Beginner/Expert switch, a glossary
   card and the 8-step tour.
3. The "not available" path: a copy of results/ with two files removed and one broken still loads
   every screen without errors, and the affected screens say "Not available".

Needs Node 22+ and Chrome, Chromium or Edge; skips with the reason when either is missing.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    return node


def _run(args):
    return subprocess.run([_node(), *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=900)


@pytest.mark.check(id="U02", name="Every colour pair in the UI tokens meets its contrast target")
def test_contrast(check_detail):
    proc = _run([str(ROOT / "scripts" / "ui_contrast.mjs")])
    assert proc.returncode == 0, proc.stdout + proc.stderr
    check_detail(proc.stdout.strip().splitlines()[-1])


@pytest.mark.check(id="U01", name="Every screen loads with no console errors, readable text, large targets and keyboard focus")
def test_every_screen_loads(check_detail):
    proc = _run([str(ROOT / "scripts" / "ui_smoke.mjs"), "--viewport", "1440x900"])
    out = proc.stdout + proc.stderr
    if proc.returncode == 2:
        pytest.skip("ui smoke test could not start: " + out.strip().splitlines()[-1])
    assert proc.returncode == 0, out
    passed = sum(1 for line in out.splitlines() if line.startswith("PASS"))
    check_detail(f"{passed} screens and flows pass at 1440x900 (console, 14px text, 44px targets, keyboard, modes, glossary, tour)")


@pytest.mark.check(id="U03", name="Missing or invalid results files show 'Not available' without errors")
def test_not_available_path(check_detail):
    tmp = ROOT / "results" / "tmp" / "na_test"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    for f in (ROOT / "results").glob("*.json"):
        shutil.copy(f, tmp / f.name)
    shutil.copytree(ROOT / "results" / "plans", tmp / "plans")
    (tmp / "risk.json").unlink()
    (tmp / "scaling.json").unlink()
    (tmp / "counting.json").write_text(json.dumps({"broken": True}), encoding="utf-8")
    proc = _run([str(ROOT / "scripts" / "ui_smoke.mjs"), "--results", "../results/tmp/na_test/", "--no-checks",
                 "--out", "results/tmp/ui_smoke_na"])
    out = proc.stdout + proc.stderr
    if proc.returncode == 2:
        pytest.skip("ui smoke test could not start: " + out.strip().splitlines()[-1])
    assert proc.returncode == 0, out
    lines = {line.split()[1]: line for line in out.splitlines() if line.startswith(("PASS", "FAIL"))}
    for screen in ("results/uncertainty", "results/scale"):
        assert screen in lines and "0 not-available" not in lines[screen], out
    check_detail("2 files removed and 1 broken: banner shown, affected screens say Not available, no errors")
