// Results > Fair lottery: plans that tie for best get exactly equal probability under the Grover mixer.
// Reads results/lottery.json (exact tie groups) and results/plans/base.json (the tied plans themselves).
import { el, fmt, fmtSmart, clock, matrixFromBits } from '../util.js';
import { naPanel, panel, table, passChip } from '../components/common.js';
import { explainPanel, pageHeader, rawJson } from '../explain.js';
import { term } from '../glossary.js';
import { pct } from '../metrics.js';
import { STATE, stateChip } from '../icons.js';

function heat(results, lot) {
  const inst = results.ok('instance') || (results.ok('plans/base') || {}).instance;
  const N = lot.marginals[0].length;
  const maxP = Math.max(...lot.marginals.flat());
  const head = el('tr', null, el('th', { class: 'rowh' }, 'Hour'), Array.from({ length: N }, (_, f) => el('th', { scope: 'col' }, inst ? inst.feeders[f].name.split(' ')[0] : `F${f}`)));
  const body = lot.marginals.map((row, t) => el('tr', null, el('th', { class: 'rowh', scope: 'row' }, inst ? clock(inst.start_hour, t) : `Hour ${t + 1}`),
    row.map((p) => el('td', { style: `background:color-mix(in srgb, var(--c1) ${Math.round(8 + 50 * (p / (maxP || 1)))}%, var(--panel))` }, fmt(p, 2)))));
  return el('div', { class: 'tbl-wrap' }, el('table', { class: 'heat', 'aria-label': 'Chance each feeder is off in each hour' }, el('thead', null, head), el('tbody', null, body)));
}

export default {
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHeader('When plans tie, is the choice fair?', null,
      'Several plans can be exactly as good as each other. FairShed should not quietly favour one neighbourhood among them.'));
    root.append(page);
    const lot = results.ok('lottery');
    const base = results.ok('plans/base');
    if (!lot) {
      page.append(explainPanel('lottery', { what: 'How the quantum circuit treats plans that tie for best.', how: 'Compare the bars.', notice: null, not: 'Not available without results/lottery.json.' }), naPanel(results.get('lottery')));
      return { destroy() {} };
    }
    const g = lot.tie_groups[0];
    const inst = base ? base.instance : results.ok('instance');
    const optimal = base && g && Math.abs(g.cost - base.exact.cost_min) < 1e-9 ? base.exact.optimal_bits : null;
    page.append(explainPanel('lottery', {
      say: 'When several plans are exactly as good, the circuit gives each the same chance, so breaking a tie is a fair lottery and not an accident of the circuit.',
      made: [{ kind: 'quantum', text: `A ${lot.method} circuit (${lot.layers} rounds, ${lot.n_qubits} qubits) is simulated exactly.` },
        { kind: 'classical', text: 'The probability of every plan is read from the simulated state and grouped by score. We compare the probabilities within each group.' }],
      qa: [{ q: 'Why does a fair tie-break matter?', a: 'Several plans can be exactly as good. If the method quietly favoured one, the same neighbourhood could lose out for no reason anyone could defend.' },
        { q: 'Is it luck that the bars are equal?', a: 'No. The Grover mixer only "sees" a plan through its score, so equal scores must give equal probability. An automated check confirms the differences are rounding error.' }],
      what: [el('span', null, 'The plans that tie for the best score, and the chance the ', term('grover', 'Grover mixer'), ' circuit gives each of them in one try.')],
      how: ['Each bar is one tied plan. Equal bars mean an equal chance.', 'The small table under each plan shows which feeders are off in each hour.'],
      notice: g ? [`${g.n_plans} plans tie at score ${fmt(g.cost, 2)}.`, `Each gets a ${pct(g.prob_min)} chance per try; the largest difference between them is ${fmtSmart(g.prob_spread, 6)}, which is rounding error.`] : null,
      not: ['That the circuit finds these plans often: one try lands on any of them only a small fraction of the time (see the Scoreboard).', 'Real feeders: the plans are synthetic.'],
    }));
    if (!g) { page.append(naPanel([{ status: 'missing', path: 'tie groups in results/lottery.json', errors: [] }])); return { destroy() {} }; }

    const maxP = g.prob_max || 1;
    const plans = optimal || Array.from({ length: g.n_plans }, () => null);
    page.append(panel(null, null, el('div', { class: 'stack', 'data-tour': 'lottery' },
      el('h2', { class: 'takeaway' }, `All ${g.n_plans} tied best plans get the same chance per try: ${pct(g.prob_min)} each.`),
      el('div', null, plans.map((bits, i) => el('div', { class: 'tie-row' },
        el('div', null, el('b', null, `Tied plan ${i + 1}`),
          bits && inst ? el('div', { class: 'subtle' }, matrixFromBits(bits, inst.n_feeders).map((row, t) => `${clock(inst.start_hour, t)}: off ${row.map((v, f) => (v ? inst.feeders[f].name.split(' ')[0] : null)).filter(Boolean).join(', ')}`).join('; ')) : null),
        el('div', { class: 'tie-bar', style: `width:${(100 * g.prob_min) / maxP}%`, role: 'img', 'aria-label': `chance ${pct(g.prob_min)}` }),
        el('b', { class: 'num' }, pct(g.prob_min))))),
      el('p', { class: 'howto' }, el('b', null, 'Why equal: '), 'the Grover mixer only "sees" a plan through its score, so plans with the same score are treated identically and get exactly the same chance. Choosing among them is a fair lottery.'),
      el('div', { class: 'row' }, stateChip(STATE.off), el('span', { class: 'subtle' }, 'feeders named after "off" are switched off in that hour.')),
      lot.all_feasible !== undefined ? el('div', { class: 'row' }, passChip(lot.all_feasible, 'Every sampled plan was valid', 'Some sampled plans were invalid')) : null)));

    if (lot.tie_groups.length > 1) {
      page.append(panel('Other groups of equal plans', 'The same holds for every score, not only the best one.', table([
        { label: 'Score', num: true, render: (x) => fmt(x.cost, 2) },
        { label: 'Plans with this score', num: true, render: (x) => String(x.n_plans) },
        { label: 'Chance per plan', num: true, render: (x) => pct(x.prob_min) },
        { label: 'Largest difference', num: true, render: (x) => fmtSmart(x.prob_spread, 6) },
      ], lot.tie_groups)));
    }
    page.append(el('div', { class: 'expert-only stack' },
      panel('Who is likely to be off, hour by hour', `${lot.method}, ${lot.n_qubits} qubits, ${lot.layers} rounds, ${lot.shots} tries. Each cell is the chance that feeder is off in that hour.`, heat(results, lot)),
      rawJson('results/lottery.json', lot)));
    void params;
    return { destroy() {} };
  },
};
