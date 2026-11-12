"""Cross-platform task runner (shared file). The Makefile only forwards to this script,
so on Windows without `make` you can run the same targets directly:

  python scripts/tasks.py setup      create .venv and install pinned requirements
  python scripts/tasks.py test       pytest + schema validation of results/
  python scripts/tasks.py demo       regenerate every results file, then test, report, validate
  python scripts/tasks.py ui         serve the dashboard at http://localhost:8000/ui/
  python scripts/tasks.py report     rebuild the report tables from results/*.json
  python scripts/tasks.py validate   validate results/*.json against schemas/
  python scripts/tasks.py ui-smoke   contrast check + every dashboard screen in headless Chrome/Edge (Node 22+)
  python scripts/tasks.py status     regenerate docs/STATUS.md (files, schema checks, test counts)
  python scripts/tasks.py classical | quantum | replay     one area's stages only

The targets run with the interpreter that runs this script (use the venv's python).
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable


def sh(*args: str, check: bool = True) -> int:
    print(f"\n$ {' '.join(args)}", flush=True)
    env = dict(os.environ, PYTHONPATH=str(ROOT), MPLBACKEND="Agg", PYTHONIOENCODING="utf-8")
    code = subprocess.call(list(args), cwd=ROOT, env=env)
    if check and code != 0:
        print(f"FAILED ({code}): {' '.join(args)}", flush=True)
        sys.exit(code)
    return code


def venv_python() -> Path:
    sub = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    return ROOT / ".venv" / sub


def setup() -> None:
    if not venv_python().exists():
        sh(PY, "-m", "venv", ".venv")
    vpy = str(venv_python())
    sh(vpy, "-m", "pip", "install", "--upgrade", "pip")
    sh(vpy, "-m", "pip", "install", "-r", "requirements.txt")
    print(f"\nEnvironment ready. Use: {vpy} scripts/tasks.py demo")


def validate() -> None:
    sh(PY, "scripts/validate_results.py")


def test() -> None:
    sh(PY, "-m", "pytest", "-q")
    validate()


def classical() -> None:
    sh(PY, "scripts/run_classical.py")
    sh(PY, "scripts/run_forecast.py")
    sh(PY, "scripts/run_audit.py")


def quantum() -> int:
    # stages are independent: a failed stage removes its file and the rest still run
    return sh(PY, "scripts/run_quantum.py", "all", check=False)


def replay() -> None:
    sh(PY, "scripts/run_replay.py")


def report() -> None:
    if (ROOT / "scripts" / "fill_report.py").exists():
        sh(PY, "scripts/fill_report.py")
    else:
        print("scripts/fill_report.py not present - report step skipped")


def demo() -> None:
    t0 = time.time()
    classical()
    q_code = quantum()
    replay()
    sh(PY, "-m", "pytest", "-q", check=False)      # refreshes results/checks.json
    report()
    sh(PY, "scripts/validate_results.py", "--strict" if q_code == 0 else "--", check=False)
    print(f"\nDemo data regenerated in {time.time() - t0:.0f}s. "
          f"Run `python scripts/tasks.py ui` and open http://localhost:8000/ui/")
    if q_code != 0:
        print("One or more quantum stages failed: see the log above and docs/KNOWN_ISSUES.md.")
        sys.exit(1)


def ui_smoke() -> None:
    import shutil
    node = shutil.which("node")
    if not node:
        print("node is not installed: the UI smoke test needs Node 22+ and Chrome, Chromium or Edge")
        sys.exit(2)
    sh(node, "scripts/ui_contrast.mjs")
    sh(node, "scripts/ui_smoke.mjs", "--viewport", "1440x900")


def status() -> None:
    sh(PY, "scripts/status_report.py")


def ui() -> None:
    port = os.environ.get("PORT", "8000")
    print(f"Dashboard: http://localhost:{port}/ui/   (Ctrl+C to stop)")
    sh(PY, "-m", "http.server", port, "--bind", "127.0.0.1")


TARGETS = {"setup": setup, "test": test, "demo": demo, "ui": ui, "report": report, "validate": validate,
           "classical": classical, "quantum": quantum, "replay": replay, "ui-smoke": ui_smoke, "status": status}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        print(__doc__)
        sys.exit(2)
    TARGETS[sys.argv[1]]()
