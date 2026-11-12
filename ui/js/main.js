// Entry point: load results, draw the shell (top bar, breadcrumb, banner), route between sections.
// The top bar holds the four sections people use. Explanations live behind one "Inner working" button:
// a drawer that explains the screen behind it, and four Inner working pages (#/inner/...) that are not
// in the main navigation. Old routes (#/plan, #/compare, #/learn/..., ...) still work.
import { params, SCENARIOS } from './config.js';
import { loadResults } from './data.js';
import { renderBanner } from './banner.js';
import { el, clear } from './util.js';
import { icon } from './icons.js';
import * as motion from './motion.js';
import { setupDefaults, refreshColors, destroyAll as destroyCharts } from './charts.js';
import { when } from './metrics.js';
import { startTour } from './tour.js';
import { setupDrawer, screenChanged } from './drawer.js';
import { resetExplain } from './explain.js';
import home from './screens/home.js';
import plan from './screens/plan.js';
import replay from './screens/replay.js';
import audit from './screens/audit.js';
import scoreboard from './screens/compare.js';
import lottery from './screens/lottery.js';
import risk from './screens/risk.js';
import scale from './screens/scale.js';
import forecast from './screens/forecast.js';
import { story, questions, algorithms, glossaryPage } from './screens/inner.js';

export const SECTIONS = [
  { id: 'home', label: 'Start here', icon: 'home', screen: home },
  { id: 'schedule', label: 'Schedule', icon: 'pin', screen: plan },
  { id: 'replay', label: 'Replay and rules', icon: 'replay', tabs: [
    { id: 'watch', label: 'Watch it hour by hour', screen: replay },
    { id: 'rules', label: 'Rule checker', screen: audit },
  ] },
  { id: 'results', label: 'Results', icon: 'compare', tabs: [
    { id: 'scoreboard', label: 'Compare methods', screen: scoreboard },
    { id: 'lottery', label: 'Fair tie-breaks', screen: lottery },
    { id: 'uncertainty', label: 'Risk and counting', screen: risk },
    { id: 'scale', label: 'Bigger cities', screen: scale },
    { id: 'forecast', label: 'Shortage forecast', screen: forecast },
  ] },
  // Not in the navigation: reached from the Inner working button (drawer links) and from Home.
  { id: 'inner', label: 'Inner working', icon: 'learn', hidden: true, tabs: [
    { id: 'story', label: 'How FairShed works', screen: story },
    { id: 'questions', label: 'Questions judges ask', screen: questions },
    { id: 'algorithms', label: 'The methods', screen: algorithms },
    { id: 'glossary', label: 'Glossary', screen: glossaryPage },
  ] },
];
const LEGACY = { plan: 'schedule', compare: 'results/scoreboard', audit: 'replay/rules', replay: 'replay/watch',
  risk: 'results/uncertainty', scale: 'results/scale', forecast: 'results/forecast', learn: 'inner/story' };
const LEGACY_TABS = { learn: { how: 'story', algorithms: 'algorithms', glossary: 'glossary' } };

const mainEl = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const statusEl = document.getElementById('status');
const crumbList = document.getElementById('crumb-list');

let results = null;
let current = null;
let routeToken = 0;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

/** Parse "#/section/tab?x=y" into { section, tab, query }. Unknown routes fall back to Home. */
export function parseRoute(hash = window.location.hash) {
  let path = hash.replace(/^#\/?/, '');
  let query = '';
  if (path.includes('?')) [path, query] = path.split('?');
  let [sec, tab] = path.split('/');
  if (LEGACY[sec] && !SECTIONS.some((s) => s.id === sec)) {
    const legacyTab = LEGACY_TABS[sec] && LEGACY_TABS[sec][tab];
    [sec, tab] = LEGACY[sec].split('/');
    if (legacyTab) tab = legacyTab;
  }
  const section = SECTIONS.find((s) => s.id === sec) || SECTIONS[0];
  const t = section.tabs ? (section.tabs.find((x) => x.id === tab) || section.tabs[0]) : null;
  return { section, tab: t, query: new URLSearchParams(query) };
}
export const hrefOf = (sec, tab) => `#/${sec}${tab ? '/' + tab : ''}`;

function drawNav() {
  document.getElementById('brand-icon').append(icon('bolt', 26));
  const nav = document.getElementById('nav');
  for (const s of SECTIONS.filter((x) => !x.hidden)) {
    nav.append(el('a', { class: 'nav-item', href: hrefOf(s.id), dataset: { route: s.id } }, icon(s.icon, 22), el('span', null, s.label)));
  }
  const controls = document.getElementById('tb-controls');
  const themeBtn = el('button', { type: 'button', class: 'btn', id: 'theme-btn' });
  const paintTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon', 20), el('span', { class: 'btn-label' }, dark ? 'Light' : 'Dark'));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  };
  paintTheme();
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    store.set('fairshed-theme', dark ? 'light' : 'dark');
    paintTheme();
    refreshColors();
    setupDefaults();
    showRoute();
  });
  const innerBtn = el('button', { type: 'button', class: 'btn btn--inner', id: 'inner-btn', 'aria-expanded': 'false', 'aria-controls': 'inner-drawer',
    'aria-keyshortcuts': 'i', title: 'How this screen works, the questions judges ask, and the technical detail (shortcut: i)' },
  icon('learn', 22), el('span', { class: 'btn-label' }, 'Inner working'));
  setupDrawer(innerBtn);
  const tourBtn = el('button', { type: 'button', class: 'btn', id: 'tour-btn' }, icon('tour', 20), el('span', { class: 'btn-label' }, 'Tour'));
  tourBtn.addEventListener('click', () => startTour());
  const reload = el('button', { type: 'button', class: 'btn', id: 'reload', title: 'Read the results files again' }, icon('reload', 20), el('span', { class: 'btn-label' }, 'Reload'));
  reload.addEventListener('click', async () => { await load(); await showRoute(); });
  controls.prepend(innerBtn, tourBtn);
  document.getElementById('crumbs').append(el('div', { class: 'row', style: 'gap:8px' }, reload, themeBtn));
  if (params.mock) {
    document.getElementById('badge-mock-slot').append(el('span', { class: 'badge badge--mock', role: 'alert' }, icon('warn', 18), 'Mock fixtures, not real results'));
  }
  document.getElementById('badge-sim').prepend(icon('info', 18));
}

function markActive(r) {
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.route === r.section.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const ib = document.getElementById('inner-btn');
  if (ib) ib.classList.toggle('is-here', r.section.id === 'inner');
  const items = [el('li', null, el('a', { href: '#/home' }, 'FairShed'))];
  if (r.section.id !== 'home') {
    items.push(el('li', null, r.tab ? el('a', { href: hrefOf(r.section.id) }, r.section.label) : el('span', { 'aria-current': 'page' }, r.section.label)));
    if (r.tab) items.push(el('li', null, el('span', { 'aria-current': 'page' }, r.tab.label)));
  } else items[0] = el('li', null, el('span', { 'aria-current': 'page' }, 'Start here'));
  crumbList.replaceChildren(...items);
}

function updateStatus() {
  if (!results) { statusEl.textContent = 'Loading results...'; return; }
  const all = Object.values(results.files);
  const ok = all.filter((f) => f.status === 'ok');
  const stamps = ok.map((f) => f.data && f.data.generated_at).filter(Boolean).sort();
  const newest = stamps.length ? when(stamps[stamps.length - 1]) : 'unknown time';
  statusEl.textContent = `${ok.length} of ${all.length} results files loaded. Newest result: ${newest}.`;
}

async function showRoute() {
  const token = ++routeToken;
  const r = parseRoute();
  if (current) {
    try { current.controller && current.controller.destroy && current.controller.destroy(); } catch (e) { console.error('destroy failed', e); }
    destroyCharts();
    motion.killAll();
    current = null;
  }
  clear(mainEl);
  resetExplain();
  markActive(r);
  const screen = (r.tab || r.section).screen;
  const title = r.tab ? `${r.tab.label} - ${r.section.label}` : r.section.label;
  document.title = `${title} - FairShed`;
  if (!results) return;
  let host = mainEl;
  if (r.section.tabs) {
    const tabs = el('nav', { class: 'subtabs', 'aria-label': `${r.section.label} tabs` },
      r.section.tabs.map((t) => el('a', { class: 'subtab', href: hrefOf(r.section.id, t.id), 'aria-current': t === r.tab ? 'page' : null }, t.label)));
    mainEl.append(el('div', { class: 'page', style: 'padding-bottom:0' }, tabs));
    host = el('div');
    mainEl.append(host);
  }
  const ctx = { root: host, results, params: { ...params, expert: false }, route: r, go: (h) => { window.location.hash = h; } };
  try {
    const controller = await screen.mount(ctx);
    if (token !== routeToken) { controller && controller.destroy && controller.destroy(); return; }
    current = { controller };
  } catch (e) {
    console.error(`Screen "${title}" failed to render`, e);
    clear(host);
    host.append(el('div', { class: 'page' }, el('div', { class: 'na na--invalid', role: 'alert' }, icon('fail', 22),
      el('div', null, el('div', { class: 'na-title' }, 'This screen failed to render'), el('p', { class: 'mono' }, String((e && e.message) || e))))));
  }
  if (token === routeToken) {
    screenChanged(r.tab ? r.tab.label : r.section.label);
    motion.fadeIn(mainEl.firstElementChild, 0.15);
    if (!r.query.get('term')) window.scrollTo(0, 0);
  }
}

async function load() {
  statusEl.textContent = 'Loading results...';
  results = await loadResults({ base: params.base, schemasBase: params.schemas, scenarios: SCENARIOS });
  renderBanner(bannerEl, results);
  updateStatus();
  window.__fairshed = { results, params, parseRoute };
}

async function init() {
  setupDefaults();
  drawNav();
  window.addEventListener('hashchange', showRoute);
  await load();
  await showRoute();
}

init().catch((e) => {
  console.error('FairShed failed to start', e);
  statusEl.textContent = 'Failed to start: ' + (e && e.message);
});
