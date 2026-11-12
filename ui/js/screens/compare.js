// Screen 2: Compare and proof. Ablation table + bar charts, the fair-lottery panel and the proof checklist.
import { el, svgEl, fmt, fmtPct, fmtSec, fmtSmart, clock, matrixFromBits } from '../util.js';
import { iconSvg } from '../icons.js';
import { naPanel, panel, pageHead, table, kindTag, passChip } from '../components/common.js';
import { makeChart, axis, COLORS, valueLabels } from '../charts.js';

const bestOf = (rows, key, dir) => {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return dir === 'min' ? Math.min(...vals) : Math.max(...vals);
};

function ablationTable(abl) {
  const rows = abl.rows;
  const best = {
    feasibility_pct: bestOf(rows, 'feasibility_pct', 'max'), p_optimal: bestOf(rows, 'p_optimal', 'max'),
    approx_ratio: bestOf(rows, 'approx_ratio', 'max'), fairness_entropy: bestOf(rows, 'fairness_entropy', 'max'),
    runtime_s: bestOf(rows, 'runtime_s', 'min'),
  };
  const isBest = (k) => (r) => r[k] !== null && r[k] !== undefined && Math.abs(r[k] - best[k]) < 1e-12;
  const setup = (r) => [r.n_qubits !== null ? `${r.n_qubits} qubits` : null, r.layers !== null ? `${r.layers} layers` : null, r.shots !== null ? `${r.shots} shots` : null].filter(Boolean).join(', ');
  return table([
    { label: 'Method', render: (r) => el('div', null, el('div', { class: 'm-name' }, r.label), setup(r) ? el('div', { class: 'subtle' }, setup(r)) : null) },
    { label: 'Kind', render: (r) => kindTag(r.kind) },
    { label: 'Feasibility', num: true, render: (r) => fmtPct(r.feasibility_pct, 1), best: isBest('feasibility_pct') },
    { label: 'P(optimal)', num: true, render: (r) => fmt(r.p_optimal, 3), best: isBest('p_optimal') },
    { label: 'Approx. ratio', num: true, render: (r) => fmt(r.approx_ratio, 3), best: isBest('approx_ratio') },
    { label: 'Fairness entropy', num: true, render: (r) => fmt(r.fairness_entropy, 3), best: isBest('fairness_entropy') },
    { label: 'Runtime', num: true, render: (r) => fmtSec(r.runtime_s), best: isBest('runtime_s') },
    { label: 'Notes', cls: 'note', render: (r) => r.notes },
  ], rows);
}

function barChart(host, abl, key, title, max, format, aria) {
  const rows = abl.rows;
  const canvas = el('canvas', { role: 'img', 'aria-label': aria });
  host.append(el('div', { class: 'chart-box' }, canvas));
  makeChart(canvas, {
    type: 'bar',
    data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r[key]), backgroundColor: rows.map((r) => (r.kind === 'quantum' ? COLORS.accent : COLORS.seriesB)), borderWidth: 0, barThickness: 16 }] },
    options: {
      indexAxis: 'y', layout: { padding: { right: 56 } },
      scales: { x: axis({ min: 0, max, ticks: { color: COLORS.muted, font: { family: '"IBM Plex Mono"', size: 11 } } }), y: axis({ grid: { display: false }, ticks: { color: COLORS.dim, font: { family: '"IBM Plex Sans"', size: 12 } } }) },
      plugins: { tooltip: { callbacks: { label: (c) => `${title}: ${format(c.parsed.x)}` } } },
    },
    plugins: [valueLabels(format)],
  });
}

function heatColor(p, maxP) {
  const a = maxP > 0 ? 0.06 + 0.44 * (p / maxP) : 0.06;
  return `rgba(169, 156, 255, ${a.toFixed(3)})`;
}

function lotteryPanel(results, lot) {
  const inst = results.ok('instance') || (results.ok('plans/base') || {}).instance;
  const feeders = inst ? inst.feeders : null;
  const N = lot.marginals[0].length;
  const maxP = Math.max(...lot.marginals.flat());
  const head = el('tr', null, el('th', { class: 'rowh' }, 'Hour'),
    Array.from({ length: N }, (_, f) => el('th', { scope: 'col', title: feeders ? feeders[f].name : `feeder ${f}` }, feeders ? feeders[f].name.split(' ')[0] : `F${f}`)));
  const body = lot.marginals.map((row, t) => el('tr', null,
    el('th', { class: 'rowh', scope: 'row' }, inst ? clock(inst.start_hour, t) : `Hour ${t + 1}`),
    row.map((p) => el('td', { style: `background:${heatColor(p, maxP)}` }, fmt(p, 2)))));
  const total = el('tr', null, el('th', { class: 'rowh' }, 'Expected hours'), lot.expected_hours.map((h) => el('td', { class: 'dim' }, fmt(h, 2))));
  const heat = el('div', { class: 'tbl-wrap' }, el('table', { class: 'heat', 'aria-label': 'Probability that each feeder is off in each hour' }, el('thead', null, head), el('tbody', null, body, total)));

  const maxSpread = lot.tie_groups.length ? Math.max(...lot.tie_groups.map((g) => g.prob_spread)) : null;
  const ties = lot.tie_groups.length
    ? table([
      { label: 'Plan cost', num: true, render: (g) => fmt(g.cost, 2) },
      { label: 'Plans with this cost', num: true, render: (g) => String(g.n_plans) },
      { label: 'Least likely plan', num: true, render: (g) => fmtSmart(g.prob_min, 6) },
      { label: 'Most likely plan', num: true, render: (g) => fmtSmart(g.prob_max, 6) },
      { label: 'Spread', num: true, render: (g) => fmtSmart(g.prob_spread, 6) },
    ], lot.tie_groups)
    : el('p', { class: 'subtle' }, 'No groups of equal-cost plans in this instance.');

  const nPerHour = inst ? inst.n_feeders : N;
  const bitsFmt = (b) => matrixFromBits(b, nPerHour).map((r) => r.join('')).join(' ');
  const top = [...lot.samples].sort((a, b) => b.prob - a.prob).slice(0, 10);
  const samples = table([
    { label: '#', num: true, render: (_r, ) => '' },
    { label: 'Plan (hours separated)', render: (r) => el('span', { class: 'bits' }, bitsFmt(r.bits)) },
    { label: 'Shots', num: true, render: (r) => String(r.count) },
    { label: 'Probability', num: true, render: (r) => fmt(r.prob, 4) },
    { label: 'Cost', num: true, render: (r) => fmt(r.cost, 2) },
    { label: 'Valid', render: (r) => passChip(r.feasible, 'Valid', 'Invalid') },
    { label: 'Optimal', render: (r) => (r.is_optimal ? el('span', { class: 'chip' }, 'Optimal') : '') },
  ], top);
  samples.querySelectorAll('tbody tr').forEach((tr, i) => { tr.firstElementChild.textContent = String(i + 1); });

  const eqCheck = (results.ok('checks') || { checks: [] }).checks.find((c) => /equal-cost|equal cost|tie/i.test(c.name));
  return panel('Fair lottery', `${lot.method}, ${lot.n_qubits} qubits, ${lot.layers} layers, ${lot.shots} shots. ${lot.all_feasible ? 'Every sampled plan satisfies quota and protected rules.' : 'Some sampled plans are invalid.'}`,
    el('div', { class: 'stack' },
      el('div', null, el('h3', { class: 'sec-h' }, 'Who is likely to be off, hour by hour'), el('p', { class: 'subtle' }, 'Probability that each feeder is off in each hour, over the sampled plans. Every cell prints its value.'), heat),
      el('div', null,
        el('h3', { class: 'sec-h' }, 'Equal-cost plans get equal probability'),
        el('p', { class: 'subtle' }, maxSpread === null ? 'Tie groups are not reported.' : `Largest spread between the most and least likely plan inside any equal-cost group: ${fmtSmart(maxSpread, 6)}.`, eqCheck ? ' ' : '', eqCheck ? passChip(eqCheck.passed, `Check ${eqCheck.id} passes`, `Check ${eqCheck.id} fails`) : null),
        ties),
      el('details', { class: 'disc' }, el('summary', null, `Most probable sampled plans (top ${top.length})`), samples)));
}

function checksPanel(chk) {
  const rows = [...chk.checks].sort((a, b) => Number(a.passed) - Number(b.passed) || a.id.localeCompare(b.id));
  const s = chk.summary;
  const list = table([
    { label: 'Result', render: (c) => passChip(c.passed, 'Pass', 'Fail') },
    { label: 'ID', render: (c) => el('span', { class: 'mono' }, c.id) },
    { label: 'Check', render: (c) => c.name },
    { label: 'Area', render: (c) => el('span', { class: 'subtle' }, c.area) },
    { label: 'Detail', cls: 'note', render: (c) => c.detail },
  ], rows);
  const allPass = s.failed === 0;
  return panel('Proof checklist', 'Written by the test run. Failing checks are listed first.',
    el('div', { class: 'stack' },
      el('div', { class: 'row' }, el('div', { class: 'check-sum' }, el('span', { class: 'num cs-n' }, String(s.passed)), el('span', { class: 'cs-of' }, ` of ${s.total} checks pass`)), allPass ? passChip(true, 'All pass') : passChip(false, `${s.failed} failing`)),
      list));
}

export default {
  id: 'compare',
  title: 'Compare and proof',
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHead('Compare and proof', 'How each method does on the same problem, what the lottery looks like, and which checks pass.'),
      el('div', { class: 'callout' }, 'Simulator only. No speed-up is claimed; at this size classical brute force gives the exact answer.'));
    root.append(page);

    const abl = results.ok('ablation');
    if (!abl) page.append(naPanel(results.get('ablation')));
    else {
      const best = bestOf(abl.rows, 'approx_ratio', 'max');
      const ref = abl.reference;
      page.append(
        panel('Methods on one instance', `${abl.instance_name}. Reference: ${ref.n_valid} valid plans, cost from ${fmt(ref.cost_min, 2)} to ${fmt(ref.cost_max, 2)}${ref.n_optimal !== null ? `, ${ref.n_optimal} optimal` : ''}.`,
          el('div', { class: 'stack' }, ablationTable(abl), el('p', { class: 'subtle' }, el('span', { class: 'legend-best' }, 'Best value in each column'), '. Approximation ratio 1.0 is the exact optimum; an invalid sample scores 0.', abl.notes ? ` ${abl.notes}` : ''))));
      const charts = el('div', { class: 'grid-2' });
      const ratioBox = el('div'); const feasBox = el('div');
      charts.append(panel('Approximation ratio', 'Higher is better, 1 is optimal.', ratioBox), panel('Feasibility', 'Share of samples that satisfy quota and protected rules.', feasBox));
      page.append(el('div', { class: 'legend' }, el('span', null, svgEl(iconSvg('atom', 14)), ' ', el('i', { class: 'sq', style: `color:${COLORS.accent}` }), ' Quantum'), el('span', null, svgEl(iconSvg('chip', 14)), ' ', el('i', { class: 'sq', style: `color:${COLORS.seriesB}` }), ' Classical')), charts);
      barChart(ratioBox, abl, 'approx_ratio', 'Approximation ratio', 1, (v) => fmt(v, 3), `Approximation ratio by method; best ${fmt(best, 3)}`);
      barChart(feasBox, abl, 'feasibility_pct', 'Feasibility', 100, (v) => `${fmt(v, 1)}%`, 'Feasibility by method');
    }

    const lot = results.ok('lottery');
    page.append(lot ? lotteryPanel(results, lot) : panel('Fair lottery', null, naPanel(results.get('lottery'))));
    const chk = results.ok('checks');
    page.append(chk ? checksPanel(chk) : panel('Proof checklist', null, naPanel(results.get('checks'))));
    return { destroy() {} };
  },
};
