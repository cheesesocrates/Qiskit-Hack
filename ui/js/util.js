// Small DOM and formatting helpers shared by every screen.

/** el('div', {class:'x', onclick: fn, dataset:{a:1}}, 'text', childNode, ...) */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function svgEl(html, cls) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const n = t.content.firstChild;
  if (cls) n.setAttribute('class', cls);
  return n;
}

// ---------- number formatting (values always come from JSON) ----------
const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = {};
export function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return (cache[d] || (cache[d] = nf(d))).format(v);
}
/** Trim trailing zeros: 3.50 -> 3.5, 4 -> 4 */
export function fmtTrim(v, maxD = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return String(Number(Number(v).toFixed(maxD)));
}
export const fmtPct = (v, d = 0) => (v === null || v === undefined ? 'n/a' : `${fmt(v, d)}%`);
export const fmtProb = (v, d = 3) => fmt(v, d);
export function fmtSec(s) {
  if (s === null || s === undefined) return 'n/a';
  if (s < 0.01) return `${fmt(s * 1000, 2)} ms`;
  if (s < 1) return `${fmt(s * 1000, 0)} ms`;
  return `${fmt(s, 2)} s`;
}

export const pad2 = (n) => String(n).padStart(2, '0');
/** Real clock label for hour index t of an instance: "19:00" */
export function clock(start, t) { return `${pad2(((start + t) % 24 + 24) % 24)}:00`; }
export function clockRange(start, t) { return `${clock(start, t)} to ${clock(start, t + 1)}`; }

// ---------- plan helpers (bit order per docs/CONTRACT.md) ----------
/** Variable index of hour t, feeder f. */
export const qIndex = (t, f, N) => t * N + f;
export const reverseStr = (s) => s.split('').reverse().join('');
export function matrixFromBits(bits, N) {
  const out = [];
  for (let i = 0; i < bits.length; i += N) out.push([...bits.slice(i, i + N)].map(Number));
  return out;
}
export const bitsFromMatrix = (M) => M.map((r) => r.join('')).join('');

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : 0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Weighted cost from unweighted breakdown terms. */
export function weightedCost(breakdown, weights) {
  return Object.keys(weights).reduce((acc, k) => acc + weights[k] * (breakdown[k] || 0), 0);
}

/** Why a feeder is protected, from its kind. */
export const PROTECTED_WHY = {
  hospital: 'hospital',
  water_pump: 'water pump',
  telecom: 'telecom tower',
};
export const KIND_LABEL = {
  residential: 'residential', commercial: 'commercial', industrial: 'industrial',
  hospital: 'hospital', water_pump: 'water pump', telecom: 'telecom tower',
};

/** Per-key method lookup in a plans file, tolerant to naming: returns the first row whose method matches. */
export function findRow(rows, re) {
  return rows.find((r) => re.test(r.method) || re.test(r.label || ''));
}

/** Tiny and large numbers: 1.2e-17 stays readable, ordinary numbers use fixed decimals. */
export function fmtSmart(v, d = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  if (v !== 0 && Math.abs(v) < 10 ** -d) return Number(v).toExponential(1);
  return fmt(v, d);
}
