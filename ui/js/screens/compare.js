// Results > Scoreboard (was Compare and proof). Did the quantum part work? Plain columns, verdicts
// computed from results/ablation.json, a sorted bar chart with a takeaway title, and grouped proof checks.
import { el, fmt, fmtSec } from '../util.js';
import { icon } from '../icons.js';
import { naPanel, panel, table, kindTag, passChip } from '../components/common.js';
import { makeChart, axis, COLORS, valueLabels } from '../charts.js';
import { explainPanel, pageHeader, chartBlock, rawJson } from '../explain.js';
import { term } from '../glossary.js';
import { pct, pctOf, ratioPlain, poptPlain, guessChance } from '../metrics.js';

const WHAT = {
  exact: 'Checks every valid plan and returns the best one (classical).',
  round_robin: 'Takes turns in a fixed order, ignoring harm (classical).',
  random_valid: 'Picks any valid plan at random (classical).',
  dicke_uniform: 'The quantum starting blend with no tuning: the same as guessing among valid plans.',
  xy_qaoa_p1: 'Quantum circuit that only visits valid plans (XY mixer), 1 round.',
  xy_qaoa_p3: 'Quantum circuit that only visits valid plans (XY mixer), 3 rounds.',
  grover_qaoa_p1: 'Quantum circuit with the fair-lottery mixer (Grover), 1 round.',
  grover_qaoa_p2: 'Quantum circuit with the fair-lottery mixer (Grover), 2 rounds.',
  grover_qaoa_p3: 'Quantum circuit with the fair-lottery mixer (Grover), 3 rounds.',
  penalty_qaoa_p1: 'Quantum circuit with an ordinary mixer; broken rules only cost extra. 1 round.',
  penalty_qaoa_p3: 'Quantum circuit with an ordinary mixer; broken rules only cost extra. 3 rounds.',
  grover_adaptive_search: 'Quantum search that keeps asking for a better plan than the best so far.',
};
const SHORT = { exact: 'Exact search', round_robin: 'Round-robin (take turns)', random_valid: 'Random valid plan', dicke_uniform: 'Quantum start, no tuning' };

/** Verdict chips for one row, computed from the data. */
function verdicts(r, guess, best) {
  const v = [];
  const chip = (cls, text) => el('span', { class: `verdict verdict--${cls}` }, icon(cls === 'good' ? 'pass' : cls === 'bad' ? 'fail' : 'info', 16), text);
  if (r.method === 'exact') return [chip('good', 'Always finds the best plan')];
  if (r.feasibility_pct < 99.95) v.push(chip('bad', `${pctOf(100 - r.feasibility_pct)} of tries break the rules`));
  if (r.kind === 'classical') {
    if (best && r.approx_ratio > best.approx_ratio) v.push(chip('mid', 'Beats the average quantum try'));
    else if (best) v.push(chip('mid', 'Below the average quantum try'));
  } else if (guess && r.method !== 'dicke_uniform') {
    if (r.p_optimal >= guess * 1.05) v.push(chip('good', `Better than guessing (${fmt(r.p_optimal / guess, 1)} times)`));
    else v.push(chip('bad', 'No better than guessing'));
  } else if (r.method === 'dicke_uniform') v.push(chip('mid', 'Same as guessing'));
  if (r.kind === 'quantum' && r.p_optimal < 1) v.push(chip('bad', 'Worse than the exact answer'));
  return v;
}

function scoreTable(rows, guess, best, expert) {
  const sorted = [...rows].sort((a, b) => b.approx_ratio - a.approx_ratio);
  const cols = [
    { label: 'Method', render: (r) => el('div', null, el('div', { class: 'm-name' }, SHORT[r.method] || r.label), kindTag(r.kind)) },
    { label: 'What it is', cls: 'note', render: (r) => WHAT[r.method] || r.label },
    { label: 'Valid tries', num: true, render: (r) => el('div', { class: 'metric' }, el('span', { class: 'metric-v' }, pctOf(r.feasibility_pct)), el('span', { class: 'metric-p' }, 'right count, nothing protected cut')) },
    { label: 'Chance one try finds the best plan', num: true, render: (r) => el('div', { class: 'metric' }, el('span', { class: 'metric-v' }, pct(r.p_optimal)),
      guess && r.kind === 'quantum' ? el('span', { class: 'metric-p' }, `guessing: ${pct(guess)}`) : null) },
    { label: 'How close to best', num: true, render: (r) => el('div', { class: 'bar-cell' }, el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `display:block;width:${Math.max(0, Math.min(1, r.approx_ratio)) * 100}%;background:${r.kind === 'quantum' ? COLORS.quantum : COLORS.classical}` })), el('b', null, `${fmt(r.approx_ratio * 100, 0)}%`)) },
    { label: 'Verdict', render: (r) => el('div', { class: 'stack-s' }, verdicts(r, guess, best)) },
  ];
  if (expert) {
    cols.push({ label: 'Qubits, rounds, tries', render: (r) => el('span', { class: 'mono' }, [r.n_qubits, r.layers, r.shots].map((x) => (x === null ? '-' : x)).join(' / ')) },
      { label: 'Run time', num: true, render: (r) => fmtSec(r.runtime_s) },
      { label: 'Notes', cls: 'note', render: (r) => r.notes });
  }
  return table(cols, sorted);
}

const GROUPS = [
  { name: 'The maths matches', ids: ['C01', 'C02', 'C03', 'C08', 'C09', 'Q01', 'Q02', 'Q03', 'Q06', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12'],
    what: 'The quantum score equals the classical score on every plan; counts and estimates match exact answers.' },
  { name: 'Every plan is valid', ids: ['C04', 'C05', 'C07', 'C12', 'C13', 'Q04', 'Q05'],
    what: 'Quantum samples never break the quota or cut a protected feeder; the rule checker catches broken plans.' },
  { name: 'Results repeat', ids: ['C06', 'C10', 'C14', 'Q07'], what: 'The same seed gives the same results.' },
  { name: 'Files and screens load', ids: ['S01', 'S02', 'S03', 'C11', 'U01'], what: 'Every results file matches its schema and every screen loads without errors.' },
];

function checksPanel(chk, expert) {
  const byId = Object.fromEntries(chk.checks.map((c) => [c.id, c]));
  const used = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = [...GROUPS, { name: 'Other checks', ids: chk.checks.map((c) => c.id).filter((id) => !used.has(id)), what: 'Checks not in a group above.' }]
    .map((g) => ({ ...g, list: g.ids.map((id) => byId[id]).filter(Boolean) })).filter((g) => g.list.length);
  return panel('Proof checklist', `Written by the automated test run. ${chk.summary.passed} of ${chk.summary.total} checks pass.`,
    el('div', null, groups.map((g) => {
      const n = g.list.filter((c) => c.passed).length;
      return el('details', { class: 'check-group' },
        el('summary', null, passChip(n === g.list.length, `${n} of ${g.list.length} pass`, `${g.list.length - n} failing`), g.name),
        el('p', { class: 'subtle' }, g.what),
        el('ul', { class: 'plain-list', style: 'margin:12px 0 16px' }, g.list.map((c) => el('li', null, c.passed ? 'Passes: ' : 'FAILS: ', c.name,
          expert ? el('span', { class: 'subtle' }, ` (${c.id}) ${c.detail || ''}`) : null))));
    })), { label: 'Proof checklist' });
}

export default {
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHeader('Did the quantum part work?', 'Results: scoreboard (was Compare and proof)',
      'Every method on the same problem, scored against the exact best plan.'));
    root.append(page);
    const abl = results.ok('ablation');
    if (!abl) {
      page.append(explainPanel('scoreboard', { what: 'Every method on the same problem.', how: 'Read the table row by row.', notice: null, not: 'Not available without results/ablation.json.' }), naPanel(results.get('ablation')));
    } else {
      const ref = abl.reference;
      const guess = guessChance(ref);
      const rows = abl.rows.filter((r) => r.instance === abl.instance_name);
      const q = rows.filter((r) => r.kind === 'quantum' && r.method !== 'dicke_uniform');
      const best = q.length ? q.reduce((a, b) => (b.approx_ratio > a.approx_ratio ? b : a)) : null;
      const bestP = q.length ? q.reduce((a, b) => (b.p_optimal > a.p_optimal ? b : a)) : null;
      const rr = rows.find((r) => r.method === 'round_robin');
      const pen = q.filter((r) => r.method.startsWith('penalty'));

      const summary = [];
      summary.push(`On this problem there are ${ref.n_valid} valid plans and ${ref.n_optimal} of them tie for best. The exact search finds a best plan every time.`);
      if (bestP && guess) summary.push(`The best quantum circuit lands on a best plan in ${pct(bestP.p_optimal)} of single tries, ${fmt(bestP.p_optimal / guess, 1)} times the ${pct(guess)} chance of a random guess${pen.length ? `, while the ordinary-mixer version wastes ${pctOf(100 - Math.max(...pen.map((r) => r.feasibility_pct)))} or more of its tries on invalid plans` : ''}.`);
      if (best) summary.push(`No quantum method beats the exact answer, and ${rr && rr.approx_ratio > best.approx_ratio ? `the simple round-robin plan (${fmt(rr.approx_ratio * 100, 0)}%) scores higher than the average quantum try (${fmt(best.approx_ratio * 100, 0)}%)` : `the average quantum try reaches ${fmt(best.approx_ratio * 100, 0)}% of the way to the best plan`}. That is why the planner keeps the best valid plan of many tries.`);

      page.append(el('div', { class: 'callout', 'data-tour': 'scoreboard' }, el('p', { style: 'font-weight:700' }, summary.join(' '))));
      page.append(explainPanel('scoreboard', {
        what: ['Each row is one method run on the same synthetic 8-feeder, 3-hour problem.', 'Quantum rows come from the simulator; classical rows from a normal computer.'],
        how: [el('span', null, el('b', null, 'Valid tries: '), 'share of ', term('shot', 'tries'), ' that are allowed plans (', term('feasibility'), ').'),
          el('span', null, el('b', null, 'Chance one try finds the best plan: '), term('popt', 'P(optimal)'), ', next to the chance of a lucky guess.'),
          el('span', null, el('b', null, 'How close to best: '), 'the ', term('ratio', 'approximation ratio'), '. 0% is as bad as the worst valid plan, 100% is the best plan.')],
        notice: [bestP && guess ? poptPlain(bestP.p_optimal, guess) : 'n/a', best ? `Best average quantum try: ${ratioPlain(best.approx_ratio)}.` : 'n/a',
          rr ? `Round-robin, a single fixed plan: ${fmt(rr.approx_ratio * 100, 0)}% of the way to the best.` : 'n/a'],
        not: ['Speed. At this size the exact search is easy for a normal computer.', 'Real feeders: the problem is synthetic.'],
      }));

      const canvas = el('canvas', { role: 'img', 'aria-label': `How close to the best plan each method gets: ${[...rows].sort((a, b) => b.approx_ratio - a.approx_ratio).map((r) => `${SHORT[r.method] || r.label} ${fmt(r.approx_ratio * 100, 0)}%`).join('; ')}` });
      const sorted = [...rows].sort((a, b) => b.approx_ratio - a.approx_ratio);
      const takeaway = best ? `The exact search reaches 100%. The best quantum circuit's average try reaches ${fmt(best.approx_ratio * 100, 0)}%${rr ? `, round-robin ${fmt(rr.approx_ratio * 100, 0)}%` : ''}.` : 'How close each method gets to the best plan.';
      page.append(panel(null, null, el('div', { class: 'stack' },
        el('h2', null, 'Scoreboard'),
        scoreTable(rows, guess, best, params.expert),
        chartBlock({ takeaway, chart: el('div', { class: 'chart-box chart-box--tall' }, canvas),
          howto: 'Each bar is one method. Longer is better. Blue bars are quantum (simulated), orange bars are classical. The value at the end of each bar is how close the average try gets to the best plan.',
          plain: [best ? `${best.label}: ${ratioPlain(best.approx_ratio)}.` : null, rr ? `Round-robin: ${ratioPlain(rr.approx_ratio)}.` : null].filter(Boolean) }))));
      makeChart(canvas, {
        type: 'bar',
        data: { labels: sorted.map((r) => SHORT[r.method] || r.label), datasets: [{ data: sorted.map((r) => r.approx_ratio * 100), backgroundColor: sorted.map((r) => (r.kind === 'quantum' ? COLORS.quantum : COLORS.classical)), borderWidth: 0, barThickness: 22 }] },
        options: { indexAxis: 'y', layout: { padding: { right: 64 } },
          scales: { x: axis({ min: 0, max: 100, title: { display: true, text: 'How close to the best plan (%)' } }), y: axis({ grid: { display: false } }) },
          plugins: { tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.x, 0)}% of the way to the best plan` } } } },
        plugins: [valueLabels((v) => `${fmt(v, 0)}%`)],
      });

      const block = abl.rows.filter((r) => r.instance !== abl.instance_name);
      if (block.length) {
        const bref = results.ok(`plans/${block[0].instance}`);
        const bguess = bref ? guessChance(bref.exact) : null;
        const bbest = block.filter((r) => r.kind === 'quantum').reduce((a, b) => (!a || b.approx_ratio > a.approx_ratio ? b : a), null);
        page.append(panel('Small block (for Grover Adaptive Search)', `A smaller ${block[0].instance.replace('block_', '').replace('x', ' feeder by ')} hour block, because ${''}Grover Adaptive Search needs extra qubits to hold the score.`,
          scoreTable(block, bguess, bbest, params.expert)));
      }
      page.append(rawJson('results/ablation.json', abl));
    }
    const chk = results.ok('checks');
    page.append(chk ? checksPanel(chk, params.expert) : panel('Proof checklist', null, naPanel(results.get('checks'))));
    return { destroy() {} };
  },
};
