// Every screen describes itself with explainPanel(id, parts), but nothing is drawn on the page: the
// app is for the people who use the schedule. The parts are kept here and shown on demand in the
// Inner working drawer (drawer.js), which judges and curious readers open with one button.
import { el } from './util.js';
import { icon } from './icons.js';

let current = null;

/**
 * Register the explanation of the screen being mounted. Returns an empty comment node, so screens can
 * keep calling page.append(explainPanel(...)).
 * parts: {
 *   say:    one sentence: what this screen is, in plain words
 *   what:   what is on the screen (node, string or array of them)
 *   how:    how to read it
 *   notice: what to notice, built from the JSON by the screen (null when the data is missing)
 *   made:   [{ kind: 'quantum' | 'classical', text }] how the numbers were made, in order
 *   not:    what the screen does not show (the honest limits)
 *   qa:     [{ q, a }] questions a judge is likely to ask; `a` may be a function returning nodes
 * }
 */
export function explainPanel(id, parts) {
  current = { id, ...parts };
  return document.createComment(`inner working: ${id}`);
}

/** The explanation registered by the screen on show, or null. */
export const takeExplain = () => current;
export function resetExplain() { current = null; }

/** Page header: the question the screen answers, an optional small kicker, a lede. */
export function pageHeader(question, technical, lede) {
  return el('header', { class: 'page-head' },
    technical ? el('div', { class: 'kicker' }, technical) : null,
    el('h1', null, question),
    lede ? el('p', { class: 'lede' }, lede) : null);
}

/** "Look at: ..." pointer under a chart: the one thing to look at first. */
export function lookAt(text) {
  return el('p', { class: 'look' }, icon('pin', 20), el('span', null, el('b', null, 'Look at: '), text));
}

/** A chart block: takeaway title (a sentence from the data), the chart, what to look at, how to read it, plain translations. */
export function chartBlock({ takeaway, chart, look, howto, plain }) {
  return el('figure', { class: 'chart-fig' },
    el('figcaption', { class: 'takeaway' }, takeaway),
    chart,
    look ? lookAt(look) : null,
    howto ? el('p', { class: 'howto' }, el('b', null, 'How to read this chart: '), howto) : null,
    plain && plain.length ? el('ul', { class: 'plain-list' }, plain.map((p) => el('li', null, p))) : null);
}

/** Raw JSON viewer. Marked .expert-only, so it is shown in the drawer's "For specialists" section. */
export function rawJson(label, data) {
  return el('details', { class: 'disc expert-only' }, el('summary', null, `Raw JSON: ${label}`),
    el('pre', { class: 'raw-json' }, JSON.stringify(data, null, 2).slice(0, 20000)));
}
