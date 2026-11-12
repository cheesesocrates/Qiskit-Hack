# UI audit (before the redesign)

Done on 2026-11-12 at 18:45 PKT on branch `feat/ui`, from headless screenshots of every screen at
1440x900 and 390x844 (`node scripts/ui_smoke.mjs --viewport WxH --out results/tmp/audit_*`).
The dashboard worked (7 of 7 screens passed the smoke test) but was hard to read and hard to explain.

## Whole app

- **Legibility and contrast:** dark slate (#0B1220) with grey secondary text (#8A94A8, about 5.6:1)
  and 1px borders at about 1.2:1 against panels. Panels barely separate from the page.
- **Text size:** 49 CSS rules set text below 14px (10.5px to 13.5px): table headers, chips, captions,
  chart ticks (11px), tooltips, notes. Body copy is 14px to 15px.
- **Jargon:** screen names and labels use project words with no explanation: "Compare and proof",
  "Pareto", "approx. ratio", "P(optimal)", "fairness entropy", "chi", "IAE", "Dicke", "solver chip".
- **Hierarchy:** seven flat rail items with no start screen, no grouping and no "you are here".
  Nothing tells a first-time visitor what FairShed is or where to begin.
- **Missing explanations:** no screen says what it shows, how to read it, or what it does not show.
  Metric meanings exist only in the developers' heads.
- **Generic look:** dark dashboard, purple accent, identical panels, tiny mono labels.
- **Mobile (390px):** the 88px side rail takes a fifth of the width, the top bar overflows
  (title wraps to three lines, Reload is cut off), the hour-slider tick labels overlap.
- **Target sizes:** most buttons are 40px high; slider ticks and the details toggle are smaller.

## Plan

- The first view shows a big "8%" headline whose meaning ("lower cost than round-robin") needs the
  small print to understand, and which plan it describes is in 12px grey text.
- Map chips overlap on mobile; the map has no legend for on, off and protected.
- The fairness slider and method choice are hidden behind "Details"; Pareto weights are numbers
  (0, 0.25, ...), not plain choices.
- No plain-language reason is visible until a feeder is clicked, and nothing tells you to click.

## Compare and proof

- One ten-column table with long "Notes" strings (optimiser evaluations, transpiled depth).
- Column names are metric codes; no verdict says which method is better or where quantum loses.
- Bar charts repeat the table with no takeaway title. The lottery heat map prints 24 decimals.
- The proof checklist is a flat list of 30 rows with test ids.

## Audit

- Example names are fine, but "score 66.7%" is unexplained (share of individual checks).
- Violations are a table of rule ids and raw details; offending cells are outlined but small.

## Replay

- KPI tiles use unexplained terms ("window cost", "fairness spread").
- The solver chip shows a long technical string. "Matches exact" is not explained.
- Chart title states what is plotted, not what to notice.

## Risk and counting

- "IAE", "oracle queries", "flexibility bits", "VaR", "CVaR" with no explanation.
- The estimate and the exact value are side by side as numbers; no visual of how close they are.
- The block size for counting is in small text; it is easy to miss that it is a 4 x 2 block.

## Scale

- "Bond dimension (chi)" on the axis with no explanation; six lines of similar purple shades.
- Table of 6 x 8 numbers with "valid %" suffixes; no takeaway.

## Forecast

- Fine chart, but the title does not say how good the forecast is; "R squared" is unexplained.
- Provenance chips (real weather, synthetic demand) are small.

## What the redesign must fix (checked in the tests)

1. Light, high-contrast theme from tokens; text 7:1 where possible, never below 4.5:1; UI parts 3:1.
2. Nothing under 14px; body 18px; interactive targets at least 44px, primary at least 48px.
3. A Home screen and five grouped top-level items with plain names and a breadcrumb.
4. A "What am I looking at?" panel on every screen; plain translations next to every metric.
5. Takeaway titles built from the JSON; verdicts that say plainly where quantum loses.
6. Glossary terms that open on tap or keyboard; Beginner and Expert modes; a short guided tour.
