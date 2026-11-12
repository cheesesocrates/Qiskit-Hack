// Entry point: load results, draw the shell (rail, badge, banner), route between the seven screens.
import { params, SCENARIOS, SCREEN_META } from './config.js';
import { loadResults } from './data.js';
import { renderBanner } from './banner.js';
import { el, clear, fmt } from './util.js';
import { icon } from './icons.js';
import * as motion from './motion.js';
import { setupDefaults, destroyAll as destroyCharts } from './charts.js';
import plan from './screens/plan.js';
import compare from './screens/compare.js';
import audit from './screens/audit.js';
import replay from './screens/replay.js';
import risk from './screens/risk.js';
import scale from './screens/scale.js';
import forecast from './screens/forecast.js';

const SCREENS = { plan, compare, audit, replay, risk, scale, forecast };
const mainEl = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const titleEl = document.getElementById('screen-title');
const statusEl = document.getElementById('status');

let results = null;
let current = null; // { id, controller }
let routeToken = 0;

function routeId() {
  const m = /^#\/([a-z]+)/.exec(window.location.hash);
  return m && SCREENS[m[1]] ? m[1] : 'plan';
}

function drawRail() {
  const rail = document.getElementById('rail');
  for (const s of SCREEN_META) {
    const a = el('a', { class: 'rail-item', href: `#/${s.id}`, dataset: { route: s.id } }, icon(s.icon, 22), el('span', null, s.label));
    rail.append(a);
  }
  if (params.debug) rail.append(el('div', { class: 'rail-foot' }, 'debug on'));
}

function markActive(id) {
  document.querySelectorAll('.rail-item').forEach((a) => {
    if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function updateStatus() {
  if (!results) { statusEl.textContent = 'Loading results...'; return; }
  const all = Object.values(results.files);
  const ok = all.filter((f) => f.status === 'ok').length;
  const t = results.loadedAt.toLocaleTimeString('en-GB');
  statusEl.textContent = `${ok} of ${all.length} result files loaded at ${t}`;
}

async function showRoute() {
  const token = ++routeToken;
  const id = routeId();
  if (current) {
    try { current.controller && current.controller.destroy && current.controller.destroy(); } catch (e) { console.error('destroy failed', e); }
    destroyCharts();
    motion.killAll();
    current = null;
  }
  clear(mainEl);
  markActive(id);
  const screen = SCREENS[id];
  titleEl.textContent = screen.title;
  document.title = `${screen.title} - FairShed`;
  if (!results) return;
  try {
    const controller = await screen.mount({ root: mainEl, results, params });
    if (token !== routeToken) { controller && controller.destroy && controller.destroy(); return; }
    current = { id, controller };
  } catch (e) {
    console.error(`Screen "${id}" failed to render`, e);
    clear(mainEl);
    mainEl.append(el('div', { class: 'page' }, el('div', { class: 'na na--invalid', role: 'alert' }, icon('fail', 20),
      el('div', null, el('div', { class: 'na-title' }, 'This screen failed to render'), el('p', { class: 'mono' }, String(e && e.message || e))))));
  }
  if (token === routeToken) { motion.fadeIn(mainEl.firstElementChild, 0.18); }
}

async function load() {
  statusEl.textContent = 'Loading results...';
  results = await loadResults({ base: params.base, schemasBase: params.schemas, scenarios: SCENARIOS });
  renderBanner(bannerEl, results);
  updateStatus();
  // exposed for tests and debugging only
  window.__fairshed = { results, params };
}

async function init() {
  setupDefaults();
  drawRail();
  if (params.mock) {
    document.getElementById('badge-mock-slot').append(el('span', { class: 'badge badge--mock', role: 'alert' }, icon('warn', 16), 'MOCK FIXTURES - not real results'));
  }
  document.getElementById('reload').addEventListener('click', async () => { await load(); await showRoute(); });
  window.addEventListener('hashchange', showRoute);
  await load();
  await showRoute();
}

init().catch((e) => {
  console.error('FairShed failed to start', e);
  statusEl.textContent = 'Failed to start: ' + (e && e.message);
});
