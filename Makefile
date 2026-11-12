# FairShed - shared file, change rarely.
# Every target forwards to scripts/tasks.py so behaviour is identical on Windows,
# macOS and Linux. No make? Run:  python scripts/tasks.py <target>

ifeq ($(OS),Windows_NT)
  VENV_PY := .venv/Scripts/python.exe
  SYS_PY  := python
else
  VENV_PY := .venv/bin/python
  SYS_PY  := python3
endif
# use the project venv when it exists, otherwise whatever python is on PATH (CI)
PY := $(if $(wildcard $(VENV_PY)),$(VENV_PY),$(SYS_PY))

.PHONY: help setup test demo ui report validate classical quantum replay ui-smoke status

help:
	@echo "make setup     create .venv and install pinned requirements"
	@echo "make test      pytest + schema validation of results/"
	@echo "make demo      regenerate every results file, then test, report, validate"
	@echo "make ui        serve the dashboard at http://localhost:8000/ui/"
	@echo "make report    rebuild report tables from results/*.json"
	@echo "make validate  validate results/*.json against schemas/"
	@echo "make ui-smoke  load every dashboard screen in a headless browser (Node 22+, Chrome or Edge)"
	@echo "make status    regenerate docs/STATUS.md"

setup:
	$(SYS_PY) scripts/tasks.py setup

test demo ui report validate classical quantum replay ui-smoke status:
	$(PY) scripts/tasks.py $@
