// Screen 5: Risk and counting. Quantum counting of valid plans (counting.json) and tail risk by
// amplitude estimation (risk.json), each next to the exact classical value.
import { el, fmt, fmtSmart } from '../util.js';
import { naPanel, panel, pageHead, table, kpi, passChip } from '../components/common.js';
import { makeChart, axis, COLORS, valueLabels } from '../charts.js';

function countingPanel(c) {
  const inst = c.instance;
  return panel('How many valid plans are there?',
    `Quantum counting by iterative amplitude estimation on a ${inst.n_feeders} feeder x ${inst.n_hours} hour block (quotas ${inst.quotas.join(', ')}, protected ${inst.protected.length ? inst.protected.join(', ') : 'none'}).`,
    el('div', { class: 'stack' },
      el('div', { class: 'kpis' },
        kpi('Exact count (enumeration)', String(c.exact_count), `of ${c.search_space} on/off patterns`),
        kpi('Quantum estimate', fmt(c.estimated_count, 2), `rounds to ${c.estimated_count_rounded}`),
        kpi('95% interval', `${fmt(c.ci[0], 2)} to ${fmt(c.ci[1], 2)}`, `tolerance ${fmt(c.tolerance, 2)}`),
        kpi('Check', null, `${c.oracle_queries} oracle queries`, passChip(c.within_tolerance, 'Within tolerance', 'Outside tolerance')),
        kpi('Flexibility', `${fmt(c.flexibility_bits, 2)} bits`, 'log2 of the number of valid plans')),
      el('p', { class: 'subtle' }, `${c.n_qubits_search} search qubits, ${c.n_qubits_total} qubits in total including the validity check.`),
      el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, c.notes))));
}

function riskPanel(r, host) {
  const ex = r.exact, es = r.estimated;
  const rows = [
    { name: 'Expected loss', unit: 'MW', e: ex.expected_loss, q: es.expected_loss, ci: es.expected_loss_ci },
    { name: 'Probability of an unplanned cut, P(loss > 0)', unit: '', e: ex.tail_prob, q: es.tail_prob, ci: es.tail_prob_ci },
    { name: `Value at risk (${fmt(r.alpha * 100, 0)}%)`, unit: 'MW', e: ex.var, q: es.var, ci: null },
    { name: `Conditional value at risk (${fmt(r.alpha * 100, 0)}%)`, unit: 'MW', e: ex.cvar, q: es.cvar, ci: es.cvar_ci },
  ];
  const tbl = table([
    { label: 'Measure', render: (x) => x.name },
    { label: 'Exact', num: true, render: (x) => `${fmt(x.e, 4)}${x.unit ? ' ' + x.unit : ''}` },
    { label: 'Amplitude estimation', num: true, render: (x) => `${fmt(x.q, 4)}${x.unit ? ' ' + x.unit : ''}` },
    { label: '95% interval', num: true, render: (x) => (x.ci ? `${fmt(x.ci[0], 4)} to ${fmt(x.ci[1], 4)}` : 'found by search') },
  ], rows);
  const canvas = el('canvas', { role: 'img', 'aria-label': 'Probability of each residual scenario' });
  const box = el('div', { class: 'chart-box' }, canvas);
  host.append(panel('Tail risk of the peak hour', r.block.description,
    el('div', { class: 'stack' },
      el('div', { class: 'row' }, passChip(r.within_tolerance, 'All estimates within tolerance of exact', 'Some estimates outside tolerance'),
        el('span', { class: 'subtle' }, `${r.n_qubits} qubits, ${r.oracle_queries} oracle queries, loss unit: ${r.loss_unit}.`)),
      tbl,
      el('div', null, el('h3', { class: 'sec-h' }, 'Scenario distribution'), el('p', { class: 'subtle' }, `${r.residual_source}. Amber bars are scenarios with a non-zero loss.`), box),
      el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, r.notes)))));
  makeChart(canvas, {
    type: 'bar',
    data: {
      labels: r.scenarios.map((s) => `${s.shortfall_extra_mw >= 0 ? '+' : ''}${fmt(s.shortfall_extra_mw, 2)} MW`),
      datasets: [{ data: r.scenarios.map((s) => s.prob), backgroundColor: r.scenarios.map((s) => (s.loss > 0 ? COLORS.off : COLORS.seriesB)), borderWidth: 0 }],
    },
    options: {
      layout: { padding: { top: 18 } },
      scales: { x: axis({ title: { display: true, text: 'Residual scenario (actual minus forecast)', color: COLORS.muted } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Probability', color: COLORS.muted } }) },
      plugins: { tooltip: { callbacks: { label: (c) => `p = ${fmt(c.parsed.y, 3)}, loss ${fmtSmart(r.scenarios[c.dataIndex].loss, 3)} MW` } } },
    },
    plugins: [{
      id: 'topLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          ctx.save(); ctx.fillStyle = COLORS.text; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
          ctx.fillText(fmt(r.scenarios[i].prob, 3), bar.x, bar.y - 6); ctx.restore();
        });
      },
    }],
  });
}

export default {
  id: 'risk',
  title: 'Risk and counting',
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHead('Risk and counting', 'Two amplitude-estimation results, each checked against the exact classical answer.'),
      el('div', { class: 'callout' }, 'Simulator only. Both problems are small enough to solve exactly in a fraction of a second; these panels show that the quantum estimators give the right numbers, not that they are faster.'));
    root.append(page);
    const c = results.ok('counting');
    page.append(c ? countingPanel(c) : panel('How many valid plans are there?', null, naPanel(results.get('counting'))));
    const r = results.ok('risk');
    if (r) riskPanel(r, page); else page.append(panel('Tail risk of the peak hour', null, naPanel(results.get('risk'))));
    return { destroy() {} };
  },
};
