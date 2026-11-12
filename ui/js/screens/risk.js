// Results > Uncertainty and counting (was Risk and counting). Amplitude-estimation results next to the
// exact values, drawn as a ruler: interval band, estimate dot, exact tick. Reads counting.json and risk.json.
import { el, fmt } from '../util.js';
import { naPanel, panel, table, passChip } from '../components/common.js';
import { makeChart, axis, COLORS, valueLabelsTop } from '../charts.js';
import { explainPanel, pageHeader, chartBlock, rawJson, lookAt } from '../explain.js';
import { term } from '../glossary.js';
import { pct } from '../metrics.js';

/** Ruler: lo..hi is the visible range; ci is [a, b]; est and exact are values. */
function ruler({ label, est, ci, exact, unit, digits = 2 }) {
  const lo0 = Math.min(ci ? ci[0] : est, est, exact), hi0 = Math.max(ci ? ci[1] : est, est, exact);
  const pad = Math.max((hi0 - lo0) * 0.6, Math.abs(exact) * 0.02, 1e-6);
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (v) => `${(100 * (v - lo)) / (hi - lo)}%`;
  const u = unit ? ` ${unit}` : '';
  return el('div', { class: 'stack-s' },
    el('div', { class: 'row' }, el('b', null, label)),
    el('div', { class: 'target', role: 'img', 'aria-label': `${label}: estimate ${fmt(est, digits)}${u}${ci ? `, 95% interval ${fmt(ci[0], digits)} to ${fmt(ci[1], digits)}` : ''}, exact ${fmt(exact, digits)}${u}` },
      el('div', { class: 'target-axis' }),
      ci ? el('div', { class: 'target-band', style: `left:${x(ci[0])};width:calc(${x(ci[1])} - ${x(ci[0])})` }) : null,
      el('div', { class: 'target-exact', style: `left:${x(exact)}` }),
      el('div', { class: 'target-est', style: `left:${x(est)}` }),
      el('span', { class: 'target-lab target-lab--top', style: `left:${x(exact)}` }, `exact ${fmt(exact, digits)}${u}`),
      el('span', { class: 'target-lab target-lab--bot', style: `left:${x(est)}` }, `estimate ${fmt(est, digits)}${u}`)),
    ci ? el('p', { class: 'subtle' }, `The shaded band is the 95% interval: ${fmt(ci[0], digits)} to ${fmt(ci[1], digits)}${u}. The exact value ${ci[0] <= exact && exact <= ci[1] ? 'falls inside it' : 'falls outside it'}.`) : null);
}

function countingPanel(c) {
  const i = c.instance;
  const block = `${i.n_feeders} feeder by ${i.n_hours} hour block`;
  return panel(`How many valid plans are there? (small ${block})`,
    `Shown on a small ${block}, quotas ${i.quotas.join(', ')}, because the counting circuit needs extra qubits. There are ${c.search_space} possible switch settings in this block.`,
    el('div', { class: 'stack' },
      el('h3', { class: 'takeaway' }, `The quantum estimate is ${fmt(c.estimated_count, 2)} valid plans; the exact count is ${c.exact_count}.`),
      ruler({ label: 'Number of valid plans', est: c.estimated_count, ci: c.ci, exact: c.exact_count, digits: 2 }),
      lookAt('whether the blue dot (quantum estimate) sits next to the black tick (exact answer), inside the shaded band. When it is, the quantum estimate agrees with the exact answer.'),
      el('div', { class: 'row' }, passChip(c.within_tolerance, 'Within tolerance of the exact count', 'Outside tolerance')),
      el('ul', { class: 'plain-list' },
        el('li', null, `A valid plan has exactly the right number of feeders off each hour and no protected feeder cut. ${c.exact_count} of the ${c.search_space} settings are valid.`),
        el('li', null, 'The count says how much freedom the planner has: more valid plans means more ways to be fair.'),
        null),
      el('div', { class: 'expert-only stack-s' }, el('h3', null, 'Counting circuit size'),
        el('p', null, `${c.n_qubits_search} search qubits, ${c.n_qubits_total} qubits in total, ${c.oracle_queries} oracle queries, ${fmt(c.flexibility_bits, 2)} bits of flexibility.`)),
      rawJson('results/counting.json', c)));
}

function riskPanel(r, host) {
  const ex = r.exact, es = r.estimated;
  const a = fmt(r.alpha * 100, 0);
  const canvas = el('canvas', { role: 'img', 'aria-label': `Chance of each forecast-error scenario: ${r.scenarios.map((s) => `${fmt(s.shortfall_extra_mw, 2)} MW: ${fmt(s.prob, 3)}`).join('; ')}` });
  host.append(panel(`Tail risk at the peak hour (${r.block.n_feeders}-feeder replay cluster)`, r.block.description,
    el('div', { class: 'stack' },
      el('h3', { class: 'takeaway' }, `In the worst ${fmt(100 - r.alpha * 100, 0)}% of cases the peak-hour plan misses ${fmt(ex.cvar, 2)} MW on average (estimate ${fmt(es.cvar, 2)} MW). In ${pct(1 - ex.tail_prob)} of cases it misses nothing.`),
      el('div', { class: 'row' }, passChip(r.within_tolerance, 'Every estimate is within tolerance of the exact value', 'Some estimates are outside tolerance')),
      ruler({ label: 'Average shortfall the plan misses (expected loss)', est: es.expected_loss, ci: es.expected_loss_ci, exact: ex.expected_loss, unit: 'MW', digits: 3 }),
      ruler({ label: 'Chance the plan falls short (needs an unplanned cut)', est: es.tail_prob, ci: es.tail_prob_ci, exact: ex.tail_prob, digits: 3 }),
      ruler({ label: `CVaR ${a}: average miss in the worst ${fmt(100 - r.alpha * 100, 0)}%`, est: es.cvar, ci: es.cvar_ci, exact: ex.cvar, unit: 'MW', digits: 3 }),
      el('ul', { class: 'plain-list' },
        el('li', null, el('span', null, term('var', `VaR ${a}`), `: the miss that is exceeded only in the worst ${fmt(100 - r.alpha * 100, 0)}% of cases. Exact ${fmt(ex.var, 3)} MW, estimate ${fmt(es.var, 3)} MW.`)),
        el('li', null, el('span', null, term('cvar', `CVaR ${a}`), `: the average miss inside that worst ${fmt(100 - r.alpha * 100, 0)}%.`)),
        el('li', null, `Loss is ${r.loss_unit}.`)),
      chartBlock({ takeaway: `${r.scenarios.filter((s) => s.loss > 0).length} of ${r.scenarios.length} forecast-error scenarios leave part of the shortage uncovered; together they have a ${pct(ex.tail_prob)} chance.`,
        chart: el('div', { class: 'chart-box' }, canvas),
        look: 'the orange bars on the right. They are the evenings when the real shortage is bigger than forecast and the plan does not cut enough; the risk numbers above measure exactly those.',
        howto: 'Each bar is one forecast-error scenario, from "real shortage lower than forecast" on the left to "higher" on the right. Bar height is how likely it is. Orange bars leave part of the shortage uncovered.',
        plain: [`${r.scenarios.filter((s) => s.loss > 0).length} of ${r.scenarios.length} scenarios leave a shortfall uncovered.`] }),
      el('div', { class: 'expert-only' }, table([
        { label: 'Measure', render: (x) => x[0] }, { label: 'Exact', num: true, render: (x) => fmt(x[1], 4) },
        { label: 'Estimate', num: true, render: (x) => fmt(x[2], 4) }, { label: '95% interval', num: true, render: (x) => (x[3] ? `${fmt(x[3][0], 4)} to ${fmt(x[3][1], 4)}` : 'found by search') },
      ], [['Expected loss (MW)', ex.expected_loss, es.expected_loss, es.expected_loss_ci], ['P(loss > 0)', ex.tail_prob, es.tail_prob, es.tail_prob_ci],
        [`VaR ${a} (MW)`, ex.var, es.var, null], [`CVaR ${a} (MW)`, ex.cvar, es.cvar, es.cvar_ci]]),
      el('p', { class: 'subtle' }, `${r.n_qubits} qubits, ${r.oracle_queries} oracle queries. ${r.notes}`)),
      rawJson('results/risk.json', r))));
  makeChart(canvas, {
    type: 'bar',
    data: { labels: r.scenarios.map((s) => `${s.shortfall_extra_mw >= 0 ? '+' : ''}${fmt(s.shortfall_extra_mw, 1)}`),
      datasets: [{ data: r.scenarios.map((s) => s.prob), backgroundColor: r.scenarios.map((s) => (s.loss > 0 ? COLORS.classical : COLORS.quantum)), borderWidth: 0 }] },
    options: { layout: { padding: { top: 24 } },
      scales: { x: axis({ title: { display: true, text: 'Real shortage minus forecast (MW): left = smaller than forecast, right = bigger' } }),
        y: axis({ beginAtZero: true, title: { display: true, text: 'Chance of this scenario' }, ticks: { color: COLORS.text, font: { size: 14 }, callback: (v) => `${fmt(v * 100, 0)}%` } }) },
      plugins: { tooltip: { callbacks: { label: (c) => `chance ${fmt(c.parsed.y * 100, 1)}%, uncovered ${fmt(r.scenarios[c.dataIndex].loss, 2)} MW` } } } },
    plugins: [valueLabelsTop((v) => `${fmt(v * 100, 0)}%`)],
  });
}

export default {
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHeader('How sure are we, and how much choice is there?', null,
      'Two uses of amplitude estimation, each checked against the exact answer from a normal computer.'));
    root.append(page);
    const c = results.ok('counting');
    const r = results.ok('risk');
    page.append(explainPanel('uncertainty', {
      say: 'Two uses of amplitude estimation, a quantum way to estimate a probability, each checked against the exact answer from a normal computer.',
      made: [{ kind: 'quantum', text: 'Counting: an amplitude-estimation circuit estimates the share of switch settings that are valid plans, on a small block.' },
        { kind: 'quantum', text: 'Risk: forecast errors become scenarios, and amplitude estimation estimates expected loss, VaR and CVaR for the peak-hour plan.' },
        { kind: 'classical', text: 'The exact values are computed by enumeration and drawn as the black tick on each ruler.' }],
      qa: [{ q: 'Why count valid plans?', a: 'The count says how much freedom the planner has: more valid plans means more ways to be fair.' },
        { q: 'Is this faster than counting directly?', a: 'No, not at this size. Both problems are small enough to enumerate. It shows that the quantum estimate is correct, which is the first thing to establish.' }],
      what: [el('span', null, 'Two quantum estimates made with ', term('ae', 'amplitude estimation'), ': how many valid plans exist (', term('counting'), '), and how much shortage the peak-hour plan may miss (risk).')],
      how: ['On each ruler the black tick is the exact value, the blue dot is the quantum estimate and the shaded band is its 95% interval.', 'The closer the dot to the tick, the better the estimate.'],
      notice: c || r ? [c ? `Counting: estimate ${fmt(c.estimated_count, 2)} against an exact ${c.exact_count}, on a small ${c.instance.n_feeders} feeder by ${c.instance.n_hours} hour block.` : 'Counting: not available.',
        r ? `Risk: estimates ${r.within_tolerance ? 'all within' : 'not all within'} tolerance of the exact values, on the ${r.block.n_feeders}-feeder replay cluster.` : 'Risk: not available.'] : null,
      not: ['A speed-up: both problems are small enough to solve exactly by enumeration.', 'Real outages: demand and shortfall are synthetic.'],
    }));
    page.append(c ? countingPanel(c) : panel('How many valid plans are there?', null, naPanel(results.get('counting'))));
    if (r) riskPanel(r, page); else page.append(panel('Tail risk at the peak hour', null, naPanel(results.get('risk'))));
    return { destroy() {} };
  },
};
