# Git workflow

This is the team workflow for the three areas after handoff. Read it once, then follow it every time you push.

## Rules at a glance

- No commits directly to `main` after handoff. All change reaches `main` through a pull request.
- Three long-lived branches, one per area: `feat/quantum`, `feat/data-docs`, `feat/ui`.
- Edit only your own area (see the table below). Shared files change rarely, and only through a PR that all three people approve.
- Run `git pull --rebase origin main` before you start work and before every push.
- Push at least every 30-45 minutes, so teammates see your progress and conflicts stay small.
- Keep pull requests small: one topic each.
- Never force-push. Not to your branch, not to `main`, never.
- Run `make test` before opening a PR. On Windows without `make`, run `python scripts/tasks.py test`.
- Code freeze a few hours before the deadline. After the freeze, only fixes agreed by all three go in.

## Who edits what

| Area | Owner | Paths |
|------|-------|-------|
| 1. Quantum | Quantum | `src/quantum/`, `tests/quantum/`, `scripts/run_quantum.py` |
| 2. Classical, data, report | Data and docs | `src/data/`, `src/cost/`, `src/classical/`, `src/export/`, `src/audit/`, `src/replan/`, `src/forecast/`, `results/`, `docs/report/`, `README.md` |
| 3. UI and video | UI | `ui/`, `media/`, `docs/demo_script.md` |
| Shared | All three | `Makefile`, `requirements.txt`, `schemas/`, `docs/CONTRACT.md`, `scripts/tasks.py`, `tests/conftest.py`, `.github/` |

Areas talk only through the JSON files in `results/` and the schemas in `schemas/`. Do not import another area's internals.

## First-time setup for a branch

Run this once per area, by the person who owns the area.

```bash
git checkout main
git pull --rebase origin main
git checkout -b feat/quantum origin/main      # use feat/data-docs or feat/ui for the other areas
git push -u origin feat/quantum
```

## Daily loop

```bash
# 1. Start of work: get the latest main into your branch
git checkout feat/quantum
git pull --rebase origin main

# 2. Work, then save and check
git add src/quantum tests/quantum
git commit -m "quantum: short description of the change"
make test                                     # Windows without make: python scripts/tasks.py test

# 3. Push (pull again first, every time)
git pull --rebase origin main
git push origin feat/quantum
```

If `git push` is rejected, someone else pushed first. Run `git pull --rebase origin main` again, then push again. Do not use `--force`.

## Opening a pull request

1. Push your branch as above.
2. Open a PR from `feat/quantum` (or your branch) into `main`.
3. Fill in the PR template. Check the box for `make test` and `python scripts/validate_results.py`.
4. Get the review your area needs. Shared-file changes need approval from all three people.
5. Merge with **Create a merge commit**. Do not squash. Keeping the branch history intact makes the next `git pull --rebase origin main` cleaner.

After a PR merges, your branch stays. Run `git pull --rebase origin main` before you start the next topic.

## Shared-file changes

`Makefile`, `requirements.txt`, `schemas/`, `docs/CONTRACT.md`, `scripts/tasks.py`, `tests/conftest.py` and `.github/` change rarely. To change one:

1. Post in the team channel what you want to change and why.
2. Open a small PR that touches only the shared file(s) and nothing else.
3. Wait for approval from all three owners before merging.

## Resolving a conflict in `results/*.json`

Never hand-merge generated JSON. The files are produced by code, so a hand-merged file is wrong even if it looks valid.

During a rebase, `--ours` means the branch you are rebasing onto (`main`), and `--theirs` means your commit. Take `main`'s version, then regenerate:

```bash
git pull --rebase origin main                 # conflict shows up here
git checkout --ours -- results/ablation.json  # repeat for each conflicted results file; --ours = main
git add results/ablation.json
git rebase --continue
make demo                                     # or: python scripts/tasks.py demo on Windows
git add results/
git commit -m "results: regenerate after rebase"
git push origin feat/quantum                  # normal push, never --force
```

If the conflict is in a file your area does not own, tell its owner instead of regenerating it yourself.

## Code freeze and submission

A few hours before the deadline, the team agrees on the freeze time. After that:

1. No new feature PRs. Only agreed fixes.
2. Make sure `main` is up to date and passes CI.
3. Tag `main` and push the tag:

```bash
git checkout main
git pull --rebase origin main
make test
make demo
git tag -a v1.0-submission -m "Submission build"
git push origin v1.0-submission
```

4. Submit from the tag, not from `main`. To check out exactly what you are submitting:

```bash
git fetch --tags
git checkout v1.0-submission
```

If something must change after tagging, stop and agree with the team first. Do not move or delete the tag.

## First 10 minutes for a new teammate

1. Clone the repo and open `docs/SPEC.md` and `docs/AREAS.md`. Find your area.
2. Create and switch to your branch, using the first-time setup commands above, or check out the existing one: `git checkout feat/quantum` (or `feat/data-docs`, `feat/ui`).
3. Run `git pull --rebase origin main`.
4. Install dependencies: `pip install -r requirements.txt` in a virtual environment with Python 3.11.
5. Run `make test` (Windows without make: `python scripts/tasks.py test`). Note anything that fails and tell the owner.
6. Run `python scripts/validate_results.py` to check the results files.
7. Read `docs/KNOWN_ISSUES.md` so you know what does not work.
8. Read the PR template and the CODEOWNERS file.
9. Pick one small task from the TODO list in `docs/AREAS.md` for your area.
10. Make a first commit on your branch, push it, and open a draft PR so the team can see it.
