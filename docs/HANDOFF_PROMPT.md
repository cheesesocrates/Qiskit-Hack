# Handoff prompt

Copy everything in the block below into a fresh agent session opened in this repo folder.

```
You are taking over FairShed, a fair, auditable load-shedding planner for a Qiskit hackathon
(Energy and Smart Infrastructure). Do not restart or redesign; continue from the real state.

Repository: https://github.com/cheesesocrates/Qiskit-Hack (remote "origin", branch main).

1. Read, in this order: docs/PROGRESS.md (RESUME HERE block, milestones, decisions, real
   numbers), docs/SPEC.md (the original brief and honesty rules), docs/CONTRACT.md (data
   contract), docs/KNOWN_ISSUES.md, docs/AREAS.md (entry points, tests, TODO per area),
   docs/GIT_WORKFLOW.md.
2. Run `git status`, `git log --oneline -20`, `git pull --rebase origin main`.
3. Environment: Python 3.11 venv at .venv (Windows: .venv/Scripts/python.exe, Linux/macOS:
   .venv/bin/python). If missing: `python scripts/tasks.py setup` (on Windows without 3.11:
   `py install 3.11` then `py -V:3.11 scripts/tasks.py setup`).
   Pinned: qiskit 2.6.2, qiskit-aer 0.18.2, qiskit-algorithms 0.4.0, qiskit-optimization 0.7.0,
   numpy 2.4.6, scipy 1.17.1, jsonschema 4.26.0, pytest 9.2.0, matplotlib 3.11.2,
   python-docx 1.2.0, lxml 6.1.3. Do not change pins unless something is broken.
4. Verify before trusting the docs:
     <venv python> scripts/tasks.py test          # pytest + schema validation
     <venv python> scripts/tasks.py ui-smoke      # needs Node 22+ and Chrome/Edge
     <venv python> scripts/status_report.py       # writes docs/STATUS.md (measured status)
5. Regenerate everything: <venv python> scripts/tasks.py demo (classical, quantum, replay,
   tests, report). The report, README key-results block and docs/demo_script.md are generated
   by scripts/fill_report.py from results/*.json; never type numbers into them.
6. Rules:
   - Honesty: never fabricate a number; simulator only; no speed-up claims; synthetic data is
     labelled synthetic. Anything that does not work goes into docs/KNOWN_ISSUES.md and the UI
     shows "not available".
   - Areas talk only through results/*.json + schemas/. Area 1 (src/quantum) never imports
     Area 2 code.
   - Results bits are index-ordered (bits[t*N+f]); Qiskit count keys are the reverse.
   - No em dashes in prose. Plain, direct sentences.
   - After the submission tag (v1.0-submission), follow docs/GIT_WORKFLOW.md: feature
     branches and pull requests, no direct commits to main, never force-push, never move the tag.
7. Keep docs/PROGRESS.md (RESUME HERE block), docs/KNOWN_ISSUES.md and docs/AREAS.md current
   after every step, commit and push often.
```
