// Screen 6: Scale. Approximation ratio vs MPS bond dimension vs instance size (results/scaling.json).
import { el, fmt, fmtSec } from '../util.js';
import { naPanel, panel, pageHead, table } from '../components/common.js';
import { makeChart, axis, COLORS } from '../charts.js';

// one hue (the accent) in steps of lightness, light = small instance, deep = large instance
const SHADES = ['#E2DCFF', '#C9BEFF', '#A99CFF', '#8C7BF0', '#6F5DD6', '#5543B5', '#3F3194'];

export default {
  id: 'scale',
  title: 'Scale',
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHead('Scale', 'How well the circuit does when it is simulated with a limited bond dimension, as the problem grows.'),
      el('div', { class: 'callout' }, 'Simulator only. A matrix product state is a classical simulation: this curve shows how far a truncated classical simulation of the circuit can go. It is not a quantum advantage claim.'));
    root.append(page);
    const sc = results.ok('scaling');
    if (!sc) { page.append(naPanel(results.get('scaling'))); return { destroy() {} }; }

    const pts = sc.points;
    const sizes = [...new Set(pts.map((p) => p.n_qubits))].sort((a, b) => a - b);
    const dims = [...new Set(pts.filter((p) => p.bond_dim !== null).map((p) => p.bond_dim))].sort((a, b) => a - b);
    const at = (n, d) => pts.find((p) => p.n_qubits === n && p.bond_dim === d);
    const label = (n) => { const p = pts.find((q) => q.n_qubits === n); return `${p.n_feeders} x ${p.n_hours} (${n} qubits)`; };

    const canvas = el('canvas', { role: 'img', 'aria-label': 'Approximation ratio against bond dimension, one line per instance size' });
    const ok = pts.filter((p) => p.status === 'ok');
    const failed = pts.filter((p) => p.status !== 'ok');
    page.append(panel('Approximation ratio vs bond dimension', `${sc.method}. ${sc.shots} shots per point; invalid samples score 0; 1.0 is the exact optimum.`,
      el('div', { class: 'stack' }, el('div', { class: 'chart-box chart-box--tall' }, canvas),
        el('p', { class: 'subtle' }, `${ok.length} of ${pts.length} points ran. Missing points are listed below with the reason; they carry no numbers.`))));
    makeChart(canvas, {
      type: 'line',
      data: {
        labels: dims.map(String),
        datasets: sizes.map((n, k) => ({
          label: label(n),
          data: dims.map((d) => { const p = at(n, d); return p && p.status === 'ok' ? p.approx_ratio : null; }),
          borderColor: SHADES[k % SHADES.length], backgroundColor: SHADES[k % SHADES.length], pointRadius: 3, spanGaps: false, tension: 0,
        })),
      },
      options: {
        plugins: { legend: { display: true, position: 'right', labels: { color: COLORS.dim, boxWidth: 14 } } },
        scales: { x: axis({ title: { display: true, text: 'Maximum bond dimension (chi)', color: COLORS.muted } }), y: axis({ min: 0, max: 1, title: { display: true, text: 'Approximation ratio', color: COLORS.muted } }) },
      },
    });

    const cell = (p) => {
      if (!p) return el('span', { class: 'subtle' }, 'not run');
      if (p.status !== 'ok') return el('span', { class: 'chip chip--danger', title: p.notes }, p.status);
      return el('span', { title: p.notes }, fmt(p.approx_ratio, 3), el('span', { class: 'subtle' }, ` ${fmt(p.feasibility_pct, 0)}% valid`));
    };
    const rows = sizes.map((n) => ({ n }));
    page.append(panel('All points', 'Each cell: approximation ratio and share of valid samples. Hover a cell for the simulator notes.',
      table([
        { label: 'Instance', render: (r) => label(r.n) },
        { label: 'Exact optimum', num: true, render: (r) => { const p = pts.find((q) => q.n_qubits === r.n); return `${fmt(p.exact_cost_min, 2)} (${p.exact_method})`; } },
        { label: 'Statevector', num: true, render: (r) => cell(at(r.n, null)) },
        ...dims.map((d) => ({ label: `chi ${d}`, num: true, render: (r) => cell(at(r.n, d)) })),
        { label: 'Slowest point', num: true, render: (r) => fmtSec(Math.max(...pts.filter((p) => p.n_qubits === r.n && p.runtime_s !== null).map((p) => p.runtime_s))) },
      ], rows)));

    if (failed.length) {
      page.append(panel('Points that did not run', null, table([
        { label: 'Instance', render: (p) => label(p.n_qubits) },
        { label: 'Bond dimension', num: true, render: (p) => (p.bond_dim === null ? 'statevector' : String(p.bond_dim)) },
        { label: 'Status', render: (p) => p.status },
        { label: 'Reason', cls: 'note', render: (p) => p.notes },
      ], failed)));
    }
    page.append(el('details', { class: 'disc' }, el('summary', null, 'Where the angles come from'), el('p', { class: 'subtle' }, sc.parameter_source), el('p', { class: 'subtle' }, sc.notes)));
    return { destroy() {} };
  },
};
