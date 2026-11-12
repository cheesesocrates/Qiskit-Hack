#!/usr/bin/env python3
"""WCAG 2.x contrast check for every text/icon colour in the dashboard palette.

Reads the colour tokens straight from ui/css/tokens.css (so the check cannot drift from the CSS),
computes contrast ratios against the two surfaces and against the flat state tints, and fails
if any pair is below 4.5:1 (normal text) or 3:1 (large text, icons, graphics, focus ring).

Usage:  python ui/tests/contrast.py            (prints a report, exit code 1 on failure)
        python ui/tests/contrast.py --markdown (prints the report as a Markdown table)
"""
import re
import sys
from pathlib import Path

TOKENS = Path(__file__).resolve().parents[1] / "css" / "tokens.css"


def load_tokens(text):
    return {m.group(1): m.group(2).upper() for m in re.finditer(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;", text)}


def lum(hexcol):
    r, g, b = (int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# (token, kind): kind "text" needs 4.5, "large" (large text, icons, graphics, focus ring) needs 3.0
FOREGROUNDS = [
    ("text", "text"), ("text-dim", "text"), ("muted", "text"),
    ("on", "text"), ("off", "text"), ("protected", "text"), ("danger", "text"),
    ("accent", "text"), ("series-b", "text"),
    ("border-strong", "large"),
]
SURFACES = ["bg", "panel", "raised"]
TINTS = {"on": "on-tint", "off": "off-tint", "protected": "protected-tint", "danger": "danger-tint"}
# text drawn ON a filled accent (buttons, slider thumb label): token pairs
ON_FILL = [("bg", "accent"), ("bg", "on"), ("bg", "off"), ("bg", "protected"), ("bg", "danger")]


def run():
    tok = load_tokens(TOKENS.read_text(encoding="utf-8"))
    rows, failed = [], 0

    def check(fg, bg, kind, note=""):
        nonlocal failed
        r = ratio(tok[fg], tok[bg])
        need = 4.5 if kind == "text" else 3.0
        ok = r >= need
        failed += 0 if ok else 1
        rows.append((fg, tok[fg], bg, tok[bg], r, need, "pass" if ok else "FAIL", note))

    for fg, kind in FOREGROUNDS:
        for s in SURFACES:
            if fg not in tok or s not in tok:
                print(f"missing token: {fg} or {s}")
                failed += 1
                continue
            check(fg, s, kind)
    for fg, tint in TINTS.items():
        check(fg, tint, "text", "state colour on its own chip tint")
    for fg, bg in ON_FILL:
        check(fg, bg, "text", "dark text on filled colour")
    check("accent", "bg", "large", "focus ring / slider thumb")
    return rows, failed


def main():
    rows, failed = run()
    if "--markdown" in sys.argv:
        print("| foreground | on | ratio | needs | result |\n|---|---|---|---|---|")
        for fg, fh, bg, bh, r, need, res, note in rows:
            print(f"| {fg} {fh} | {bg} {bh} | {r:.2f} | {need} | {res}{' (' + note + ')' if note else ''} |")
    else:
        for fg, fh, bg, bh, r, need, res, note in rows:
            print(f"{res:5} {r:6.2f}:1 (needs {need})  {fg:14}{fh}  on {bg:15}{bh}  {note}")
    print(f"\n{len(rows)} pairs checked, {failed} below threshold")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
