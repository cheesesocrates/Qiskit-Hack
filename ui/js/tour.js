// Guided tour: 8 steps with a spotlight. Next and Back (buttons or arrow keys), Esc or "Skip tour" ends it.
// Steps point at elements by selector; a step whose element is missing (for example a "not available"
// screen) still shows its text, centred, so the tour never gets stuck.
import { el } from './util.js';
import { icon } from './icons.js';

const STEPS = [
  { hash: '#/home', sel: '.hero', title: 'What FairShed is',
    text: 'When there is not enough electricity, a utility must switch some neighbourhoods off. FairShed decides which ones, fairly, and lets anyone check the rules.' },
  { hash: '#/home', sel: '.problem', title: 'The problem in one line',
    text: 'The shortage sets how many feeders must be off each hour. FairShed picks which ones, never cuts a hospital, water pump or telecom tower, and spreads the hours fairly.' },
  { hash: '#/schedule', sel: '.plan-map-wrap', title: 'Who loses power',
    text: 'Each box is a feeder (a neighbourhood power line). Teal with a check means On, amber with stripes means Off, blue with a shield means Protected. Click a box to see why.' },
  { hash: '#/schedule', sel: '.dock', title: 'Step through the hours',
    text: 'Press Play or drag the slider to move hour by hour. The quota on the right says how many feeders must be off in that hour.' },
  { hash: '#/replay/watch', sel: '[data-tour="replay"]', title: 'Re-planning every hour',
    text: 'Every hour the planner solves the next three hours again with the real shortage, keeps only the first hour, and moves on.' },
  { hash: '#/results/scoreboard', sel: '[data-tour="scoreboard"]', title: 'Did the quantum part work?',
    text: 'The scoreboard compares every method on the same problem, and says plainly where the quantum circuit loses to the exact classical answer.' },
  { hash: '#/results/lottery', sel: '[data-tour="lottery"]', title: 'A fair lottery for ties',
    text: 'When several plans are equally good, the Grover mixer gives each exactly the same chance. That is what fair means for ties.' },
  { hash: '#/learn/glossary', sel: '.seg[aria-label="Explanation level"]', title: 'More detail when you want it',
    text: 'Switch to Expert for qubit counts, formulas and raw data. Any dotted-underlined word opens a short explanation, and Learn has the full glossary.' },
];

let state = null;

function rectOf(node) {
  const r = node.getBoundingClientRect();
  const pad = 8;
  return { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: Math.min(r.height + pad * 2, window.innerHeight - 24) };
}

function position() {
  if (!state) return;
  const { shade, card, target } = state;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  if (target && document.body.contains(target)) {
    const r = rectOf(target);
    Object.assign(shade.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top = r.top + r.height + 12;
    if (top + ch > vh - 12) top = Math.max(12, r.top - ch - 12);
    if (top < 12 || top + ch > vh - 12) top = Math.max(12, vh - ch - 12);
    const left = Math.max(12, Math.min(r.left, vw - cw - 12));
    Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
  } else {
    shade.style.display = 'none';
    Object.assign(card.style, { top: `${Math.max(12, (vh - card.offsetHeight) / 2)}px`, left: `${Math.max(12, (vw - card.offsetWidth) / 2)}px` });
  }
}

async function waitFor(sel, ms = 3000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const n = document.querySelector(sel);
    if (n && n.getBoundingClientRect().height > 0) return n;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

async function show(i) {
  if (!state) return;
  state.i = i;
  const s = STEPS[i];
  if (window.location.hash !== s.hash) window.location.hash = s.hash;
  const target = await waitFor(s.sel);
  if (!state) return;
  state.target = target;
  if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
  const { card } = state;
  const back = el('button', { type: 'button', class: 'btn', disabled: i === 0 ? true : null }, icon('arrowl', 20), 'Back');
  const next = el('button', { type: 'button', class: 'btn btn--primary' }, i === STEPS.length - 1 ? 'Finish' : 'Next', icon('arrowr', 20));
  const skip = el('button', { type: 'button', class: 'btn' }, icon('close', 20), 'Skip tour');
  back.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => (i === STEPS.length - 1 ? endTour() : show(i + 1)));
  skip.addEventListener('click', endTour);
  const h = el('h2', { tabindex: '-1', id: 'tour-title' }, s.title);
  card.replaceChildren(el('div', { class: 'tour-step' }, `Step ${i + 1} of ${STEPS.length}`), h, el('p', null, s.text),
    el('div', { class: 'tour-actions' }, back, el('span', { class: 'tb-spacer' }), skip, next));
  requestAnimationFrame(() => { position(); h.focus(); });
}

function onKey(e) {
  if (!state) return;
  if (e.key === 'Escape') { e.preventDefault(); endTour(); }
  else if (e.key === 'ArrowRight' && !(e.target && e.target.matches && e.target.matches('input'))) { e.preventDefault(); if (state.i < STEPS.length - 1) show(state.i + 1); else endTour(); }
  else if (e.key === 'ArrowLeft' && !(e.target && e.target.matches && e.target.matches('input'))) { e.preventDefault(); if (state.i > 0) show(state.i - 1); }
}

export function startTour() {
  endTour();
  const shade = el('div', { class: 'tour-shade', 'aria-hidden': 'true' });
  const card = el('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title' });
  document.body.append(shade, card);
  state = { shade, card, i: 0, target: null };
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('keydown', onKey);
  show(0);
}

export function endTour() {
  if (!state) return;
  state.shade.remove();
  state.card.remove();
  state = null;
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  document.removeEventListener('keydown', onKey);
  const btn = document.getElementById('tour-btn');
  if (btn) btn.focus();
}

export const TOUR_LENGTH = STEPS.length;
