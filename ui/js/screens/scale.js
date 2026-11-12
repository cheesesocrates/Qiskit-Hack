// Results > Bigger problems (was Scale). Quality vs MPS bond dimension vs size, from results/scaling.json.
import { el, fmt, fmtSec } from '../util.js';
import { naPanel, panel, table } from '../components/common.js';
import { makeChart, axis, COLORS, endLabelsPlugin } from '../charts.js';
import { explainPanel, pageHeader, chartBlock, rawJson } from '../explain.js';
import { term } from '../glossary.js';

export default {
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHeader('What happens on bigger problems?', 'Results: bigger problems (was Scale, MPS simulator)',
      'The same kind of circuit on larger cities, run with a simulator that keeps only part of the links between qubits.'));
    root.append(page);
    page.append(el('div', { class: 'callout callout--honest' }, el('b', null, 'This is not a quantum advantage. '),
      'The MPS simulator is a normal computer program. These curves show how the circuit behaves as it grows and how much memory a faithful simulation needs, not that quantum is faster.'));
    const sc = results.ok('scaling');
    if (!sc) {
      page.append(explainPanel('scale', { what: 'Quality against simulator memory.', how: 'Not available.', notice: null, not: 'Not available.' }), naPanel(results.get('scaling')));
      return { destroy() {} };
    }
    const pts = sc.points;
    const sizes = [...new Set(pts.map((p) => p.n_qubits))].sort((a, b) => a - b);
    const dims = [...new Set(pts.filter((p) => p.bond_dim !== null).map((p) => p.bond_dim))].sort((a, b) => a - b);
    const at = (n, d) => pts.find((p) => p.n_qubits === n && p.bond_dim === d);
    const name = (n) => { const p = pts.find((q) => q.n_qubits === n); return `${p.n_feeders} feeders (${n} qubits)`; };
    const ok = pts.filter((p) => p.status === 'ok');
    const big = sizes[sizes.length - 1];
    const bigLo = at(big, dims[0]), bigHi = at(big, dims[dims.length - 1]);
    const takeaway = bigLo && bigHi && bigLo.status === 'ok' && bigHi.status === 'ok'
      ? `Bigger problems need more simulator memory: the ${big}-qubit problem gets ${fmt(bigLo.approx_ratio * 100, 0)}% of the way to the best plan at bond dimension ${dims[0]}, and ${fmt(bigHi.approx_ratio * 100, 0)}% at ${dims[dims.length - 1]}.`
      : 'How close each size gets to the best plan as the simulator keeps more links between qubits.';

    page.append(explainPanel('scale', {
      what: [el('span', null, 'How close the circuit gets to the best plan (the ', term('ratio', 'approximation ratio'), ') on problems from ', name(sizes[0]), ' to ', name(big), '.')],
      how: [el('span', null, 'Left to right: more ', term('bond', 'bond dimension'), ', meaning the simulator remembers more and is more accurate, but slower.'),
        'Up is better: 100% would be the best plan every try. Each line is one problem size; darker lines are bigger problems.'],
      notice: [`${ok.length} of ${pts.length} points ran; points that crashed or ran out of time are listed at the bottom with no numbers.`, takeaway],
      not: ['A speed-up or advantage: this is a classical simulation.', 'Re-tuned circuits: the step sizes were tuned on the small problems and reused unchanged on the big ones.'],
    }));

    const canvas = el('canvas', { role: 'img', 'aria-label': `Approximation ratio against bond dimension. ${sizes.map((n) => `${name(n)}: ${dims.map((d) => { const p = at(n, d); return p && p.status === 'ok' ? `${d}: ${fmt(p.approx_ratio * 100, 0)}%` : `${d}: no result`; }).join(', ')}`).join('. ')}` });
    const shades = COLORS.series ? [COLORS.series[5], COLORS.series[0], COLORS.series[2], COLORS.series[3], COLORS.series[1], COLORS.series[6]] : [];
    page.append(panel(null, null, chartBlock({ takeaway, chart: el('div', { class: 'chart-box chart-box--tall' }, canvas),
      howto: 'Each line is one problem size, labelled at its right end. Higher is closer to the best plan. A line that only rises at the right needs more simulator memory before the circuit works well.',
      plain: ['Bond dimension: how much connection between qubits the simulator remembers. Higher means more accurate and slower.',
        `Every point uses ${sc.shots} tries; a try that breaks the rules scores 0.`] })));
    makeChart(canvas, {
      type: 'line',
      data: { labels: dims.map(String), datasets: sizes.map((n, k) => ({ label: `${n} qubits`,
        data: dims.map((d) => { const p = at(n, d); return p && p.status === 'ok' ? p.approx_ratio * 100 : null; }),
        borderColor: shades[k % shades.length], backgroundColor: shades[k % shades.length], pointRadius: 4, borderWidth: 3, spanGaps: false, tension: 0 })) },
      options: { layout: { padding: { right: 96 } },
        scales: { x: axis({ title: { display: true, text: 'Bond dimension (simulator memory), more to the right' } }), y: axis({ min: 0, max: 100, title: { display: true, text: 'How close to the best plan (%)' } }) },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 0)}%` } } } },
      plugins: [endLabelsPlugin],
    });

    const cell = (p) => {
      if (!p) return 'not run';
      if (p.status !== 'ok') return el('span', { class: 'chip chip--danger', title: p.notes }, p.status);
      return el('span', { title: p.notes }, `${fmt(p.approx_ratio * 100, 0)}%`, el('span', { class: 'subtle' }, ` (${fmt(p.feasibility_pct, 0)}% valid)`));
    };
    page.append(el('div', { class: 'expert-only stack' },
      panel('All points (Expert)', 'Each cell: how close to the best plan, and the share of valid tries. Hover for the simulator notes.', table([
        { label: 'Problem', render: (r) => name(r.n) },
        { label: 'Exact best score', num: true, render: (r) => { const p = pts.find((q) => q.n_qubits === r.n); return `${fmt(p.exact_cost_min, 2)} (${p.exact_method})`; } },
        { label: 'Full simulation', num: true, render: (r) => cell(at(r.n, null)) },
        ...dims.map((d) => ({ label: `chi ${d}`, num: true, render: (r) => cell(at(r.n, d)) })),
        { label: 'Slowest point', num: true, render: (r) => fmtSec(Math.max(...pts.filter((p) => p.n_qubits === r.n && p.runtime_s !== null).map((p) => p.runtime_s))) },
      ], sizes.map((n) => ({ n })))),
      el('details', { class: 'disc' }, el('summary', null, 'Where the circuit settings come from'), el('p', { class: 'subtle' }, sc.parameter_source), el('p', { class: 'subtle' }, sc.notes)),
      rawJson('results/scaling.json', sc)));
    const failed = pts.filter((p) => p.status !== 'ok');
    if (failed.length) {
      page.append(panel('Points with no result', 'These runs crashed or ran out of time. They carry no numbers.', table([
        { label: 'Problem', render: (p) => name(p.n_qubits) },
        { label: 'Bond dimension', num: true, render: (p) => (p.bond_dim === null ? 'full simulation' : String(p.bond_dim)) },
        { label: 'Status', render: (p) => p.status },
        { label: 'Reason', cls: 'note', render: (p) => (params.expert ? p.notes : p.notes.split(':').slice(0, 2).join(':')) },
      ], failed)));
    }
    return { destroy() {} };
  },
};
