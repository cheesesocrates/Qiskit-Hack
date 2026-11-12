// Contrast check for ui/css/tokens.css (Area 3). Run: node scripts/ui_contrast.mjs
// Computes WCAG 2.x contrast ratios for every theme in the file and exits 1 if any pair misses
// its target: body text >= 7:1, secondary text and state text >= 4.5:1, controls, borders that
// carry meaning and chart lines >= 3:1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'ui', 'css', 'tokens.css'), 'utf8');

function themes() {
  const out = {};
  const re = /(:root(?:\[data-theme="(\w+)"\])?)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const name = m[2] || 'light';
    const vars = {};
    for (const v of m[3].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) vars[v[1]] = v[2];
    out[name] = { ...(out.light || {}), ...vars };
  }
  return out;
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const CHECKS = [
  // [foreground, background, minimum, what]
  ['text', 'bg', 7, 'body text on page'],
  ['text', 'panel', 7, 'body text on panel'],
  ['text', 'raised', 7, 'body text on raised fill'],
  ['text-dim', 'bg', 4.5, 'secondary text on page'],
  ['text-dim', 'panel', 4.5, 'secondary text on panel'],
  ['text-dim', 'raised', 4.5, 'secondary text on raised fill'],
  ['accent', 'panel', 4.5, 'links and selected labels on panel'],
  ['accent', 'bg', 4.5, 'links on page'],
  ['accent', 'accent-tint', 4.5, 'selected label on its tint'],
  ['on-accent', 'accent', 4.5, 'primary button label'],
  ['border-strong', 'panel', 3, 'control outlines'],
  ['on', 'on-tint', 4.5, '"On" label on its tint'],
  ['off', 'off-tint', 4.5, '"Off" label on its tint'],
  ['protected', 'protected-tint', 4.5, '"Protected" label on its tint'],
  ['on', 'panel', 4.5, '"On" on panel'],
  ['off', 'panel', 4.5, '"Off" on panel'],
  ['protected', 'panel', 4.5, '"Protected" on panel'],
  ['pass', 'pass-tint', 4.5, 'pass label'],
  ['danger', 'danger-tint', 4.5, 'fail label'],
  ['danger', 'panel', 4.5, 'error text on panel'],
  ['text', 'on-tint', 7, 'text on "On" tint'],
  ['text', 'off-tint', 7, 'text on "Off" tint'],
  ['text', 'protected-tint', 7, 'text on "Protected" tint'],
  ...['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((c) => [c, 'panel', 3, `chart colour ${c}`]),
];

let failed = 0;
for (const [name, t] of Object.entries(themes())) {
  console.log(`theme ${name}`);
  for (const [fg, bg, min, what] of CHECKS) {
    if (!t[fg] || !t[bg]) { console.log(`  FAIL  missing token --${!t[fg] ? fg : bg}`); failed++; continue; }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1 (min ${min})  --${fg} on --${bg}  ${what}`);
  }
}
console.log(failed ? `ui_contrast: ${failed} pair(s) below target` : 'ui_contrast: every pair meets its target');
process.exit(failed ? 1 : 0);
