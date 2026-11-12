// Results > Bigger problems (was Scale). Quality vs MPS bond dimension vs size, from results/scaling.json.
// A "Show" switch moves between plan quality, the memory the MPS simulator saves against a full
// simulation, and accuracy (fidelity). The memory and accuracy views appear only when the file has
// the optional fields mps_memory_mb and fidelity (docs/CONTRACT.md), so older files render as before.
import { el, fmt, fmtSec } from '../util.js';
import { naPanel, panel, segmented, table } from '../components/common.js';
import { makeChart, axis, COLORS, endLabelsPlugin } from '../charts.js';
import { explainPanel, pageHeader, rawJson } from '../explain.js';
import { term } from '../glossary.js';

/** Bytes, given megabytes (MB = 2^20 bytes), in the largest unit that keeps the number readable. */
function fmtBytesMb(mb) {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return 'n/a';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let v = mb * 2 ** 20;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${fmt(v, v < 10 ? 1 : 0)} ${units[i]}`;
}
const fullMb = (n) => (2 ** n) * 16 / 2 ** 20; // a full simulation stores one complex number (16 bytes) per basis state
/** Axis label for a power of 1000 bytes (decimal units: 1 KB = 1000 bytes), or null between them. */
function decimalBytesTick(bytes) {
  const e = Math.log10(bytes);
  if (Math.abs(e - Math.round(e)) > 1e-6 || Math.round(e) % 3 !== 0) return null;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.min(Math.round(e) / 3, units.length - 1);
  return `1 ${units[i]}`;
}

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
    const name = (n) => { const p = pts.find((q) => q.n_qubits === n); return `${p.n_feeders} feeders x ${p.n_hours} hours (${n} qubits)`; };
    const ok = pts.filter((p) => p.status === 'ok');
    const big = sizes[sizes.length - 1];
    const bigLo = at(big, dims[0]), bigHi = at(big, dims[dims.length - 1]);
    const takeaway = bigLo && bigHi && bigLo.status === 'ok' && bigHi.status === 'ok'
      ? `Bigger problems need more simulator memory: the ${big}-qubit problem gets ${fmt(bigLo.approx_ratio * 100, 0)}% of the way to the best plan at bond dimension ${dims[0]}, and ${fmt(bigHi.approx_ratio * 100, 0)}% at ${dims[dims.length - 1]}.`
      : 'How close each size gets to the best plan as the simulator keeps more links between qubits.';
    /** The point with the largest bond dimension that ran, per size (the most accurate MPS run). */
    const topMps = (n) => [...dims].reverse().map((d) => at(n, d)).find((p) => p && p.status === 'ok') || null;
    const hasMem = pts.some((p) => typeof p.mps_memory_mb === 'number');
    const hasFid = pts.some((p) => p.bond_dim !== null && typeof p.fidelity === 'number');
    const fidSizes = sizes.filter((n) => dims.some((d) => { const p = at(n, d); return p && typeof p.fidelity === 'number'; }));

    page.append(explainPanel('scale', {
      what: [el('span', null, 'How close the circuit gets to the best plan (the ', term('ratio', 'approximation ratio'), ') on problems from ', name(sizes[0]), ' to ', name(big), '.')],
      how: [el('span', null, 'Left to right: more ', term('bond', 'bond dimension'), ', meaning the simulator remembers more and is more accurate, but slower.'),
        'Up is better: 100% would be the best plan every try. Each line is one problem size; darker lines are bigger problems.',
        hasMem ? 'The Show switch also gives the memory a full simulation would need against what the MPS used, and how faithful the MPS state is.' : null].filter(Boolean),
      notice: [`${ok.length} of ${pts.length} points ran; points that crashed or ran out of time are listed at the bottom with no numbers.`, takeaway],
      not: ['A speed-up or advantage: this is a classical simulation.', 'Re-tuned circuits: the step sizes were tuned on the small problems and reused unchanged on the big ones.'],
    }));

    // what the MPS simulator buys: one row per size, built only from the file
    if (hasMem) {
      const tops = sizes.map((n) => ({ n, p: topMps(n) })).filter((r) => r.p && typeof r.p.mps_memory_mb === 'number');
      const last = tops[tops.length - 1];
      const buyTake = last
        ? `At ${last.n} qubits a full simulation would store ${fmtBytesMb(fullMb(last.n))}; the MPS at bond dimension ${last.p.bond_dim} stored ${fmtBytesMb(last.p.mps_memory_mb)}, and ${fmt(last.p.feasibility_pct, 0)}% of its tries were valid plans.`
        : 'No MPS point ran.';
      page.append(panel('What the MPS simulator buys', 'A full simulation stores one number for every possible on/off pattern: 2 to the power of the qubit count. The MPS stores a small block per qubit, so its memory grows slowly. The price is accuracy, shown as fidelity: how much the simulated state overlaps the exact one (100% is exact).',
        el('div', { class: 'stack' },
          el('p', { class: 'takeaway' }, buyTake),
          table([
            { label: 'Problem', render: (r) => name(r.n) },
            { label: 'Full simulation would store', num: true, render: (r) => fmtBytesMb(fullMb(r.n)) },
            { label: 'MPS stored', num: true, render: (r) => el('span', null, fmtBytesMb(r.p.mps_memory_mb), el('span', { class: 'subtle' }, ` (bond dimension ${r.p.bond_dim})`)) },
            { label: 'Fidelity', num: true, render: (r) => (typeof r.p.fidelity === 'number' ? `${fmt(r.p.fidelity * 100, 1)}%` : el('span', { class: 'subtle', title: 'The exact state is too big to compare with at this size' }, 'not measured')) },
            { label: 'Valid tries', num: true, render: (r) => `${fmt(r.p.feasibility_pct, 0)}%` },
            { label: 'Way to the best plan', num: true, render: (r) => `${fmt(r.p.approx_ratio * 100, 0)}%` },
          ], tops))));
    }

    // chart: one of three views
    const canvas = el('canvas', { role: 'img' });
    const shades = COLORS.series ? [COLORS.series[5], COLORS.series[0], COLORS.series[2], COLORS.series[3], COLORS.series[1], COLORS.series[6], COLORS.series[4]] : [];
    const shade = (k) => shades[k % shades.length]; // after the 7 theme colours, lines repeat a colour but are dashed
    const take = el('figcaption', { class: 'takeaway' });
    const howto = el('p', { class: 'howto' });
    let chart = null;
    const VIEWS = {
      quality: () => {
        take.textContent = takeaway;
        howto.replaceChildren(el('b', null, 'How to read this chart: '), 'Each line is one problem size, labelled at its right end. Higher is closer to the best plan. A line that only rises at the right needs more simulator memory before the circuit works well.');
        canvas.setAttribute('aria-label', `Approximation ratio against bond dimension. ${sizes.map((n) => `${name(n)}: ${dims.map((d) => { const p = at(n, d); return p && p.status === 'ok' ? `${d}: ${fmt(p.approx_ratio * 100, 0)}%` : `${d}: no result`; }).join(', ')}`).join('. ')}`);
        return {
          type: 'line',
          data: { labels: dims.map(String), datasets: sizes.map((n, k) => ({ label: `${n} qubits`,
            data: dims.map((d) => { const p = at(n, d); return p && p.status === 'ok' ? p.approx_ratio * 100 : null; }),
            borderColor: shade(k), backgroundColor: shade(k), borderDash: k >= shades.length ? [6, 4] : [], pointRadius: 4, borderWidth: 3, spanGaps: false, tension: 0 })) },
          options: { layout: { padding: { right: 96 } },
            scales: { x: axis({ title: { display: true, text: 'Bond dimension (simulator memory), more to the right' } }), y: axis({ min: 0, max: 100, title: { display: true, text: 'How close to the best plan (%)' } }) },
            plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 0)}%` } } } },
          plugins: [endLabelsPlugin],
        };
      },
      memory: () => {
        const rows = sizes.map((n) => ({ n, p: topMps(n) }));
        const last = [...rows].reverse().find((r) => r.p && typeof r.p.mps_memory_mb === 'number');
        take.textContent = last
          ? `A full simulation doubles its memory with every qubit and would need ${fmtBytesMb(fullMb(last.n))} at ${last.n} qubits; the MPS used ${fmtBytesMb(last.p.mps_memory_mb)}.`
          : 'Memory per problem size.';
        howto.replaceChildren(el('b', null, 'How to read this chart: '), 'Problem size grows to the right. The vertical axis is logarithmic: each labelled line is a thousand times more memory than the one below. The full-simulation line is computed (16 bytes per possible pattern); the MPS line is measured from the largest bond dimension that ran.');
        canvas.setAttribute('aria-label', `Memory against problem size. ${rows.map((r) => `${name(r.n)}: full simulation ${fmtBytesMb(fullMb(r.n))}, MPS ${r.p && typeof r.p.mps_memory_mb === 'number' ? fmtBytesMb(r.p.mps_memory_mb) : 'no result'}`).join('. ')}`);
        return {
          type: 'line',
          data: { labels: sizes.map((n) => `${n} qubits`), datasets: [
            { label: 'Full simulation', data: sizes.map((n) => fullMb(n) * 2 ** 20), borderColor: COLORS.classical, backgroundColor: COLORS.classical, pointRadius: 4, borderWidth: 3, borderDash: [8, 4], tension: 0 },
            { label: 'MPS (measured)', data: rows.map((r) => (r.p && typeof r.p.mps_memory_mb === 'number' ? r.p.mps_memory_mb * 2 ** 20 : null)), borderColor: COLORS.quantum, backgroundColor: COLORS.quantum, pointRadius: 4, borderWidth: 3, tension: 0 },
          ] },
          options: { layout: { padding: { right: 140 } },
            scales: { x: axis({ title: { display: true, text: 'Problem size' } }),
              y: axis({ type: 'logarithmic', title: { display: true, text: 'Memory (logarithmic)' },
                ticks: { color: COLORS.text, font: { size: 14 }, autoSkip: false, callback: (v) => decimalBytesTick(v) } }) },
            plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtBytesMb(c.parsed.y / 2 ** 20)}` } } } },
          plugins: [endLabelsPlugin],
        };
      },
      accuracy: () => {
        const n = fidSizes[fidSizes.length - 1];
        const fp = (d) => at(n, d);
        const lo = dims.map(fp).find((p) => p && typeof p.fidelity === 'number');
        const hi = [...dims].reverse().map(fp).find((p) => p && typeof p.fidelity === 'number');
        take.textContent = lo && hi
          ? `At ${n} qubits, bond dimension ${hi.bond_dim} keeps ${fmt(hi.fidelity * 100, 1)}% fidelity; bond dimension ${lo.bond_dim} keeps ${fmt(lo.fidelity * 100, 1)}%.`
          : 'Fidelity against bond dimension.';
        howto.replaceChildren(el('b', null, 'How to read this chart: '), 'Fidelity is how much the simulated state overlaps the exact one: 100% is exact. It is measured only where the exact state fits in memory. Each line is one problem size; higher is more faithful.');
        canvas.setAttribute('aria-label', `Fidelity against bond dimension. ${fidSizes.map((m) => `${name(m)}: ${dims.map((d) => { const p = at(m, d); return p && typeof p.fidelity === 'number' ? `${d}: ${fmt(p.fidelity * 100, 1)}%` : `${d}: no result`; }).join(', ')}`).join('. ')}`);
        return {
          type: 'line',
          data: { labels: dims.map(String), datasets: fidSizes.map((m, k) => ({ label: `${m} qubits`,
            data: dims.map((d) => { const p = at(m, d); return p && typeof p.fidelity === 'number' ? p.fidelity * 100 : null; }),
            borderColor: shade(k), backgroundColor: shade(k), borderDash: k >= shades.length ? [6, 4] : [], pointRadius: 4, borderWidth: 3, spanGaps: false, tension: 0 })) },
          options: { layout: { padding: { right: 96 } },
            scales: { x: axis({ title: { display: true, text: 'Bond dimension (simulator memory), more to the right' } }), y: axis({ min: 0, max: 100, title: { display: true, text: 'Fidelity (%)' } }) },
            plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y, 1)}%` } } } },
          plugins: [endLabelsPlugin],
        };
      },
    };
    const draw = (view) => {
      if (chart) { chart.destroy(); chart = null; }
      chart = makeChart(canvas, (VIEWS[view] || VIEWS.quality)());
    };
    const options = [{ value: 'quality', label: 'Plan quality' }];
    if (hasMem) options.push({ value: 'memory', label: 'Memory needed' });
    if (hasFid) options.push({ value: 'accuracy', label: 'Accuracy' });
    const fig = el('figure', { class: 'chart-fig' }, take, el('div', { class: 'chart-box chart-box--tall' }, canvas), howto,
      el('ul', { class: 'plain-list' }, el('li', null, 'Bond dimension: how much connection between qubits the simulator remembers. Higher means more accurate and slower.'),
        el('li', null, `Every point uses ${sc.shots} tries; a try that breaks the rules scores 0.`)));
    if (options.length > 1) {
      const seg = segmented({ label: 'Show', options, value: 'quality', onChange: draw });
      page.append(panel(null, null, el('div', { class: 'stack' }, el('div', null, el('span', { class: 'field-label' }, 'Show'), seg.root), fig)));
    } else {
      page.append(panel(null, null, fig));      // older files: plan quality only, no switch
    }
    draw('quality');

    const cell = (p) => {
      if (!p) return 'not run';
      if (p.status !== 'ok') return el('span', { class: 'chip chip--danger', title: p.notes }, p.status);
      return el('span', { title: p.notes }, `${fmt(p.approx_ratio * 100, 0)}%`, el('span', { class: 'subtle' }, ` (${fmt(p.feasibility_pct, 0)}% valid${typeof p.fidelity === 'number' && p.bond_dim !== null ? `, fidelity ${fmt(p.fidelity, 2)}` : ''})`));
    };
    page.append(el('div', { class: 'expert-only stack' },
      panel('All points (Expert)', `Each cell: how close to the best plan, the share of valid tries${hasFid ? ' and, up to 20 qubits, the fidelity of the final state' : ''}. Hover for the simulator notes.`, table([
        { label: 'Problem', render: (r) => name(r.n) },
        { label: 'Exact best score', num: true, render: (r) => { const p = pts.find((q) => q.n_qubits === r.n); return `${fmt(p.exact_cost_min, 2)} (${p.exact_method})`; } },
        { label: 'Full simulation', num: true, render: (r) => cell(at(r.n, null)) },
        ...dims.map((d) => ({ label: `chi ${d}`, num: true, render: (r) => cell(at(r.n, d)) })),
        { label: 'Slowest point', num: true, render: (r) => fmtSec(Math.max(...pts.filter((p) => p.n_qubits === r.n && p.runtime_s !== null).map((p) => p.runtime_s))) },
      ], sizes.map((n) => ({ n })))),
      el('details', { class: 'disc' }, el('summary', null, 'Where the circuit settings come from'), el('p', { class: 'subtle' }, sc.method), el('p', { class: 'subtle' }, sc.parameter_source), el('p', { class: 'subtle' }, sc.notes)),
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
    return { destroy() { if (chart) chart.destroy(); } };
  },
};
