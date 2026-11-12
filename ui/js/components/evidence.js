// Evidence blocks shared by Results > Compare methods and Inner working > How FairShed works:
// the four-row "classical methods against FairShed" table and the "why this combination" decision
// cards built from the separate quantum runs. Every value comes from facts(results).
import { el, fmt, svgEl } from '../util.js';
import { icon, iconSvg } from '../icons.js';
import { kindTag } from './common.js';
import { pct } from '../metrics.js';

const P = (r) => `${fmt(r * 100, 0)}%`;

/** "Quantum + classical" tag for FairShed itself. */
export function hybridTag() {
  return el('span', { class: 'chip chip--hybrid', title: 'A quantum circuit (simulated) proposes plans; classical code tunes it, keeps the best plan and checks it' },
    svgEl(iconSvg('atom', 14)), 'Quantum + classical');
}

const yes = (text) => el('div', { class: 'cell-yes' }, icon('pass', 18), el('span', null, text));
const no = (text) => el('div', { class: 'cell-no' }, icon('fail', 18), el('span', null, text));
const meh = (text) => el('div', { class: 'cell-meh' }, icon('info', 18), el('span', null, text));

/** One row per method, from the facts. Rows whose data is missing are left out. */
export function methodRows(F) {
  const rows = [];
  const E = F.exact;
  if (F.delivered && E) {
    const d = F.delivered;
    rows.push({
      key: 'fairshed', name: 'FairShed (our planner)', tag: hybridTag(), ours: true,
      how: `A quantum circuit that can only produce rule-following plans proposes ${d.tries || 'many'} plans; the best one is kept and checked.`,
      cost: d.cost, ratio: d.ratio,
      best: F.pareto ? (d.matches ? yes(`Yes tonight; ${F.pareto.matched} of ${F.pareto.n} fairness settings`) : meh(`Close tonight (${fmt(d.cost, 2)} against ${fmt(d.exactCost, 2)}); exact at ${F.pareto.matched} of ${F.pareto.n} fairness settings`))
        : meh('See the fairness sweep'),
      rules: el('div', { class: 'stack-xs' }, d.audit.passed ? yes('Every rule tonight') : no(`${d.audit.violations.length} broken tonight`),
        F.replay ? (F.replay.passed === F.replay.n ? yes(`${F.replay.passed} of ${F.replay.n} replayed hours`) : no(`${F.replay.n - F.replay.passed} of ${F.replay.n} replayed hours broke a rule`)) : null),
      harm: yes('Yes'),
      ties: F.tie ? yes(`Yes: each of the ${F.tie.n} tied best plans gets the same chance`) : yes('Yes, by design (Grover mixer)'),
    });
  }
  if (E && F.exactPlan) {
    rows.push({
      key: 'exact', name: 'Exact search', tag: kindTag('classical'),
      how: `Checks every one of the ${E.n_valid.toLocaleString('en-US')} rule-following plans and keeps the best.`,
      cost: E.cost_min, ratio: 1,
      best: yes('Always'),
      rules: el('div', { class: 'stack-xs' }, F.exactPlan.audit_passed ? yes('Every rule tonight') : no('Breaks a rule tonight'),
        F.heatwave && F.heatwave.exactPassed !== null ? (F.heatwave.exactPassed ? yes('Every rule in the heatwave') : no('Breaks a rule in the heatwave')) : null),
      harm: yes('Yes'),
      ties: E.n_optimal > 1 && F.exactTieRule ? no(`No: always takes the first of the ${E.n_optimal} tied plans in its list`) : meh('Only one best plan tonight'),
    });
  }
  if (F.rr) {
    rows.push({
      key: 'rr', name: 'Round-robin (take turns)', tag: kindTag('classical'),
      how: 'Switches feeders off in a fixed rotating order. Ignores who is hurt most.',
      cost: F.rr.cost, ratio: F.rr.approx_ratio,
      best: no('No: one fixed rota'),
      rules: el('div', { class: 'stack-xs' }, F.rr.audit_passed ? yes('Every rule tonight') : no(`${F.rr.n_violations} broken tonight`),
        F.heatwave && F.heatwave.rrBroken !== null ? (F.heatwave.rrBroken ? no(`${F.heatwave.rrBroken} broken in the heatwave`) : yes('Every rule in the heatwave')) : null),
      harm: no('No'),
      ties: meh('No choice to make: one fixed rota'),
    });
  }
  if (F.randomStats && E) {
    const rs = F.randomStats;
    rows.push({
      key: 'random', name: 'Random valid plan', tag: kindTag('classical'),
      how: `Draws any plan that meets the quota, at random (average of ${rs.n_samples.toLocaleString('en-US')} draws).`,
      cost: rs.mean_cost, ratio: rs.mean_approx_ratio,
      best: F.abl && F.abl.guess ? no(`Rarely: ${pct(F.abl.guess)} chance per draw`) : no('Rarely'),
      rules: rs.cap_violation_pct > 0 ? no(`${fmt(rs.cap_violation_pct, 0)}% of draws break the back-to-back limit tonight`) : yes('Every rule tonight'),
      harm: no('No'),
      ties: meh('Every plan equally likely, good or bad'),
    });
  }
  return rows;
}

/** The comparison table. */
export function methodTable(F) {
  const rows = methodRows(F);
  if (!rows.length) return null;
  const head = ['Method', 'Score tonight (lower is better)', 'Finds the very best plan?', 'Follows every rule?', 'Weighs harm and history?', 'Fair when plans tie?'];
  const t = el('table', { class: 'tbl tbl--methods' },
    el('thead', null, el('tr', null, head.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', null, rows.map((r) => el('tr', { class: r.ours ? 'row-ours' : null },
      el('th', { scope: 'row', class: 'm-cell' }, el('div', { class: 'm-name' }, r.name), r.tag, el('p', { class: 'm-how' }, r.how)),
      el('td', { 'data-label': head[1] }, el('div', null, el('div', { class: 'score-v' }, fmt(r.cost, 2)),
        el('div', { class: 'bar-cell' }, el('span', { class: 'bar-track' }, el('span', { class: `bar-fill${r.ours ? ' bar-fill--ours' : ''}`, style: `width:${Math.max(0, Math.min(1, r.ratio)) * 100}%` })), el('b', null, P(r.ratio))),
        el('div', { class: 'score-s' }, 'of the way to the best'))),
      el('td', { 'data-label': head[2] }, r.best), el('td', { 'data-label': head[3] }, r.rules),
      el('td', { 'data-label': head[4] }, r.harm), el('td', { 'data-label': head[5] }, r.ties)))));
  return el('div', { class: 'tbl-wrap' }, t);
}

/** One sentence that says where FairShed stands, from the data. */
export function verdictSentence(F) {
  if (!F.delivered || !F.exact) return null;
  const d = F.delivered;
  const parts = [];
  parts.push(d.matches
    ? `FairShed's plan scores ${fmt(d.cost, 2)}, the same as the exact best plan.`
    : `FairShed's plan scores ${fmt(d.cost, 2)}, ${P(d.ratio)} of the way to the exact best (${fmt(d.exactCost, 2)}).`);
  const extras = [];
  if (d.audit.passed) extras.push('follows every rule');
  extras.push('weighs harm and outage history');
  if (F.tie) extras.push('is the only method here that gives tied plans an equal chance');
  parts.push(`It ${extras.slice(0, -1).join(', ')}${extras.length > 1 ? ' and ' : ''}${extras[extras.length - 1]}.`);
  if (F.rr && F.rr.cost > d.cost) parts.push(`It beats round-robin (${fmt(F.rr.cost, 2)}).`);
  parts.push('The exact search still wins on score: at this size a normal computer can check every plan.');
  return parts.join(' ');
}

/** The design choices behind FairShed's circuit, each backed by a pair of runs. */
export function decisions(F) {
  if (!F.abl) return [];
  const by = F.abl.by;
  const out = [];
  const pen = F.penaltyBest;
  const dicke = by('dicke_uniform');
  const xy = by('xy_qaoa_p3') || by('xy_qaoa_p1');
  const gr = by('grover_qaoa_p3') || by('grover_qaoa_p1');
  if (pen && (gr || dicke)) {
    out.push({ n: 1, q: 'Stay inside the rules', metric: 'tries that are valid plans',
      a: { label: 'Usual recipe: fine broken rules (penalty QAOA)', v: pen.feasibility_pct / 100 },
      b: { label: 'Start only among valid plans (Dicke state)', v: (gr || dicke).feasibility_pct / 100 },
      why: `With a fine, ${P(1 - pen.feasibility_pct / 100)} of tries still break the quota. Starting among valid plans and mixing only between them wastes none.` });
  }
  if (dicke && gr) {
    out.push({ n: 2, q: 'Tune the circuit', metric: 'average try, % of the way to the best plan',
      a: { label: 'Valid start only, no tuning', v: dicke.approx_ratio },
      b: { label: `Tuned, ${gr.layers} rounds`, v: gr.approx_ratio },
      why: F.randomStats ? `Untuned, the circuit is no better than drawing a random valid plan (${P(F.randomStats.mean_approx_ratio)}). Tuning moves probability toward better plans.` : 'Tuning moves probability toward better plans.' });
  }
  if (xy && gr) {
    const dx = F.depth(xy), dg = F.depth(gr);
    out.push({ n: 3, q: 'Pick the mixer', metric: 'average try, % of the way to the best plan',
      a: { label: `XY mixer, ${xy.layers} rounds`, v: xy.approx_ratio },
      b: { label: `Grover mixer, ${gr.layers} rounds`, v: gr.approx_ratio },
      why: `Better plans, and tied plans get exactly equal chances: a fair lottery.${dx && dg ? ` The price is a deeper circuit (${dg} steps against ${dx} after compiling).` : ''}` });
  }
  if (gr && F.delivered) {
    out.push({ n: 4, q: 'Keep the best of many tries', metric: '% of the way to the best plan',
      a: { label: 'One try (average)', v: gr.approx_ratio },
      b: { label: `Best of ${F.delivered.tries || 'many'} tries: the plan we deliver`, v: F.delivered.ratio },
      why: F.abl.guess ? `One try is a best plan only ${pct(F.bestP.p_optimal)} of the time (${fmt(F.bestP.p_optimal / F.abl.guess, 1)} times a random guess), so the planner keeps the best of many and checks it.` : 'The planner keeps the best of many tries and checks it.',
      note: `Delivered plan: ${F.delivered.method}, from the fairness sweep. Single-try figures: ${gr.label}, ${gr.shots} tries.` });
  }
  return out;
}

export function decisionCards(F) {
  const ds = decisions(F);
  if (!ds.length) return null;
  const bar = (x, ours) => el('div', { class: `dc-opt${ours ? ' dc-opt--ours' : ''}` },
    el('div', { class: 'dc-lab' }, ours ? el('span', { class: 'dc-pick' }, icon('pass', 16), 'FairShed') : null, el('span', null, x.label)),
    el('div', { class: 'dc-row' }, el('span', { class: 'dc-track' }, el('span', { class: 'dc-fill', style: `width:${Math.max(0, Math.min(1, x.v)) * 100}%` })), el('b', { class: 'dc-v' }, P(x.v))));
  return el('ol', { class: 'decisions' }, ds.map((d) => el('li', { class: 'dc' },
    el('div', { class: 'dc-head' }, el('span', { class: 'dc-n' }, String(d.n)), el('h3', null, d.q)),
    el('div', { class: 'dc-metric' }, `Measured: ${d.metric}`),
    bar(d.a, false), bar(d.b, true),
    el('p', { class: 'dc-why' }, d.why),
    d.note ? el('p', { class: 'dc-note' }, d.note) : null)));
}
