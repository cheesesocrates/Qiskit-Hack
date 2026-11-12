// "What am I looking at?" panel and the page header used by every screen.
// The panel is open on the first visit to a screen and remembers when the reader collapses it.
import { el } from './util.js';
import { icon } from './icons.js';

const KEY = 'fairshed-explain-closed';
function readClosed() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
function writeClosed(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode: ignore */ } }

/**
 * id: screen id. parts: { what, how, notice, not } where each is a node, string, or array of those.
 * `notice` should be built from the JSON by the screen; pass null when the data is not available
 * and the panel says so instead.
 */
export function explainPanel(id, parts) {
  const closed = readClosed().includes(id);
  const list = (x) => (Array.isArray(x) ? el('ul', null, x.map((i) => el('li', null, i))) : el('p', null, x));
  const d = el('details', { class: 'explain', 'data-explain': id }, el('summary', null, icon('info', 22), 'What am I looking at?',
    el('span', { class: 'ex-state' }, 'Show or hide')),
  el('div', { class: 'explain-b' },
    el('section', null, el('h3', null, 'What this shows'), list(parts.what)),
    el('section', null, el('h3', null, 'How to read it'), list(parts.how)),
    el('section', null, el('h3', null, 'What to notice'), parts.notice ? list(parts.notice) : el('p', null, 'Not available: the results file this screen needs is missing.')),
    el('section', null, el('h3', null, 'What it does not show'), list(parts.not))));
  if (!closed) d.open = true;
  d.addEventListener('toggle', () => {
    const set = new Set(readClosed());
    if (d.open) set.delete(id); else set.add(id);
    writeClosed([...set]);
  });
  return d;
}

/** Page header: the question the screen answers, the technical name as a small subtitle, a lede. */
export function pageHeader(question, technical, lede) {
  return el('header', { class: 'page-head' },
    technical ? el('div', { class: 'kicker' }, technical) : null,
    el('h1', null, question),
    lede ? el('p', { class: 'lede' }, lede) : null);
}

/** A chart block: takeaway title (a sentence from the data), the chart, how to read it, plain translations. */
export function chartBlock({ takeaway, chart, howto, plain }) {
  return el('figure', { class: 'chart-fig' },
    el('figcaption', { class: 'takeaway' }, takeaway),
    chart,
    howto ? el('p', { class: 'howto' }, el('b', null, 'How to read this chart: '), howto) : null,
    plain && plain.length ? el('ul', { class: 'plain-list' }, plain.map((p) => el('li', null, p))) : null);
}

/** Raw JSON viewer for Expert mode. */
export function rawJson(label, data) {
  return el('details', { class: 'disc expert-only' }, el('summary', null, `Raw JSON: ${label}`),
    el('pre', { class: 'raw-json' }, JSON.stringify(data, null, 2).slice(0, 20000)));
}
