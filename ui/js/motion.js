// Motion: GSAP only, restrained (150-400 ms, power2.out), nothing loops. Honours prefers-reduced-motion
// (durations become 0). If GSAP failed to load, values are applied instantly.
import { fmt } from './util.js';

const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const G = window.gsap;
const live = new Set();

export const reduced = () => !!mq.matches;
export const dur = (s) => (reduced() ? 0 : s);

function track(tw) {
  if (!tw) return tw;
  live.add(tw);
  tw.eventCallback('onComplete', () => live.delete(tw));
  return tw;
}

/** gsap.to with house defaults. */
export function to(target, vars) {
  if (!G) { applyNow(target, vars); return null; }
  const { duration = 0.25, ease = 'power2.out', ...rest } = vars;
  return track(G.to(target, { ...rest, ease, duration: dur(duration) }));
}

export function set(target, vars) { if (G) G.set(target, vars); else applyNow(target, vars); }

function applyNow(target, vars) {
  const list = typeof target === 'string' ? document.querySelectorAll(target) : [].concat(target);
  for (const n of list) if (n && n.style) {
    if ('opacity' in vars) n.style.opacity = vars.opacity;
    if ('autoAlpha' in vars) { n.style.opacity = vars.autoAlpha; n.style.visibility = vars.autoAlpha ? 'visible' : 'hidden'; }
  }
}

export function fadeIn(node, d = 0.2) {
  if (!node) return;
  set(node, { opacity: 0 });
  to(node, { opacity: 1, duration: d });
}

/**
 * Count a number up (first appearance) or between values (change). The element keeps its last shown
 * value in a property so the next call tweens from there. `format` turns a number into text.
 */
export function countTo(node, value, format = (v) => fmt(v, 0), d = 0.4) {
  if (!node) return;
  if (value === null || value === undefined || Number.isNaN(value)) { node.textContent = 'n/a'; node._cv = undefined; return; }
  const from = node._cv === undefined ? 0 : node._cv;
  if (node._tw) node._tw.kill();
  node._cv = value;
  if (!G || reduced() || from === value) { node.textContent = format(value); return; }
  const o = { v: from };
  node._tw = track(G.to(o, { v: value, duration: d, ease: 'power2.out', onUpdate: () => { node.textContent = format(o.v); },
    onComplete: () => { node.textContent = format(value); } }));
}

/** Kill every running tween (called on route change). */
export function killAll() {
  for (const tw of live) tw.kill();
  live.clear();
}
