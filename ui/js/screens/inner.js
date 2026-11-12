// Inner working pages (#/inner/...), reached from the Inner working button, not the main navigation.
// Written for judges and curious readers who are not quantum specialists: plain words first, the
// technical detail one click away. Every number is read from results/*.json through facts().
//   story      How FairShed works: the whole project in six steps, mapped to the judging criteria
//   questions  Questions judges ask, with short answers built from the results
//   algorithms Every method, quantum and classical, in five short parts
//   glossary   Every technical word
import { el, fmt, fmtSmart, clock, fmtBytesMb, fullStateMb } from '../util.js';
import { icon } from '../icons.js';
import { kindTag } from '../components/common.js';
import { explainPanel, pageHeader } from '../explain.js';
import { term, TERMS, TERM_KEYS, glossaryCard } from '../glossary.js';
import { pct } from '../metrics.js';
import { facts } from '../facts.js';
import { methodTable, decisionCards, verdictSentence } from '../components/evidence.js';
import { RULES } from '../rules.js';

const P = (r) => `${fmt(r * 100, 0)}%`;
const N0 = (v) => Number(v).toLocaleString('en-US');
const na = 'not available (results file missing)';

/** Bring a section into view without changing the route (the hash is the router). */
function jumpTo(id) {
  const n = document.getElementById(id);
  if (!n) return;
  n.scrollIntoView({ block: 'start' });
  const h = n.querySelector('h2');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

const spec = (summary, ...kids) => el('details', { class: 'disc spec' }, el('summary', null, `For specialists: ${summary}`), el('div', { class: 'spec-b stack-s' }, ...kids));
const link = (href, text) => el('a', { class: 'go', href }, text, icon('arrowr', 18));

function chapter(n, id, title, kicker, ...body) {
  return el('section', { class: 'chapter', id, 'aria-labelledby': `${id}-h` },
    el('div', { class: 'ch-head' }, el('span', { class: 'ch-n', 'aria-hidden': 'true' }, String(n)),
      el('div', null, el('div', { class: 'ch-kicker' }, kicker), el('h2', { id: `${id}-h` }, title))),
    el('div', { class: 'ch-body stack' }, ...body));
}

/** The test evening as a switchboard: one cell per feeder and hour; protected feeders have no switch. */
function switchboard(F) {
  const inst = F.inst;
  let k = 0;
  const short = (f) => inst.feeders[f].name.replace(/^F\d+\s*/, '');
  const head = el('div', { class: 'sb-row sb-head' }, el('span', { class: 'sb-rowh' }, 'Hour'),
    inst.feeders.map((fd) => el('span', { class: `sb-colh${fd.protected ? ' sb-colh--prot' : ''}` }, short(fd.id))), el('span', { class: 'sb-q' }, 'Must be off'));
  const rows = inst.quotas.map((q, t) => el('div', { class: 'sb-row' },
    el('span', { class: 'sb-rowh' }, clock(inst.start_hour, t)),
    inst.feeders.map((fd) => (fd.protected
      ? el('span', { class: 'sb-cell sb-cell--prot', title: `${fd.name}: protected, no switch` }, icon('protected', 18), el('span', { class: 'sr-only' }, 'protected, no qubit'))
      : el('span', { class: 'sb-cell', title: `${fd.name} at ${clock(inst.start_hour, t)}: qubit ${k + 1}` }, icon('atom', 16), el('span', null, String(++k))))),
    el('span', { class: 'sb-q' }, `${q} of ${inst.n_feeders}`)));
  return el('figure', { class: 'switchboard' },
    el('div', { class: 'sb-grid', style: `--cols:${inst.n_feeders}`, role: 'img', 'aria-label': `${inst.n_hours} hours by ${inst.n_feeders} feeders. ${F.nProtected} protected feeders have no switch, leaving ${F.nQubits} qubits.` }, head, rows),
    el('figcaption', { class: 'sb-legend' },
      el('span', null, el('span', { class: 'sb-cell sb-cell--key' }, icon('atom', 16)), 'One qubit: 1 means off, 0 means on'),
      el('span', null, el('span', { class: 'sb-cell sb-cell--prot sb-cell--key' }, icon('protected', 16)), 'Protected: no qubit, can never be cut')));
}

/** Big numbers with arrows: possible patterns, valid plans, tied best plans. */
function funnel(F) {
  const steps = [
    [N0(F.nPatterns), 'possible on/off patterns', `2 to the power ${F.nQubits}`],
    [N0(F.exact.n_valid), 'follow the quota and protect every hospital and pump', 'the valid plans'],
    [N0(F.exact.n_optimal), `tie for the best score (${fmt(F.exact.cost_min, 2)})`, 'the plans we want'],
  ];
  return el('ol', { class: 'funnel', 'aria-label': 'How many plans there are' }, steps.map(([v, l, s], i) => el('li', null,
    el('div', { class: 'fn-v' }, v), el('div', { class: 'fn-l' }, l), el('div', { class: 'fn-s' }, s), i < steps.length - 1 ? el('span', { class: 'fn-arrow', 'aria-hidden': 'true' }, icon('arrowr', 24)) : null)));
}

/** The planner as a pipeline of five boxes, each tagged quantum or classical. */
function pipeline(F) {
  const d = F.delivered;
  const boxes = [
    ['quantum', 'Start among valid plans', [term('dicke', 'Dicke state'), ': an equal blend of every plan with exactly the quota off in each hour.']],
    ['quantum', 'Score step', ['Each plan is marked by its score, like a tick on a wave. Better plans are marked differently from worse ones.']],
    ['quantum', 'Mix step', ['The ', term('grover', 'Grover mixer'), ' moves probability between valid plans. It only "sees" a plan through its score.']],
    ['classical', 'Tune', ['A normal optimiser sets how strong each step is. Score and mix repeat a few times; each repeat is one round.']],
    ['classical', 'Measure, keep the best, check', [`Run the circuit ${d && d.tries ? `${d.tries} times` : 'many times'}: each run (`, term('shot', 'try'), ') gives one plan. Keep the best, then audit it.']],
  ];
  return el('ol', { class: 'pipe' }, boxes.map(([k, t, body], i) => el('li', { class: `pipe-box pipe-box--${k}` },
    el('div', { class: 'pipe-top' }, el('span', { class: 'pipe-n' }, String(i + 1)), kindTag(k)), el('h3', null, t), el('p', null, ...body))));
}

function tile(v, l, href, text) {
  return el('div', { class: 'ev-tile' }, el('div', { class: 'ev-v' }, v), el('div', { class: 'ev-l' }, l), href ? link(href, text) : null);
}

function limitsAndNext(F) {
  const lim = [
    'Simulator only: every quantum result comes from Qiskit Aer on a laptop, not a real quantum computer.',
    `Synthetic data: feeders, demand and outage history are made up; only the weather snapshot is real.`,
    'No speed-up: at this size a normal computer checks every plan quickly, and we claim no advantage.',
  ];
  if (F.bestP && F.abl.guess) lim.push(`One try is rarely the best plan (${pct(F.bestP.p_optimal)}), so the planner relies on keeping the best of many tries.`);
  if (F.delivered && !F.delivered.matches) lim.push(`Tonight's default plan is close but not exact: ${fmt(F.delivered.cost, 2)} against the best ${fmt(F.delivered.exactCost, 2)}.`);
  if (F.replay && F.replay.matched < F.replay.n) lim.push(`${F.replay.n - F.replay.matched} of ${F.replay.n} replayed hours were valid but not the best plan.`);
  if (F.scale && F.scale.topRatio !== null) lim.push(`On the biggest simulated city (${F.scale.maxQ} qubits) quality falls to ${P(F.scale.topRatio)}, because the circuit settings were tuned on small cities and reused unchanged.`);
  const gr = F.abl && (F.abl.by('grover_qaoa_p3') || F.abl.by('grover_qaoa_p1'));
  const xy = F.abl && (F.abl.by('xy_qaoa_p3') || F.abl.by('xy_qaoa_p1'));
  if (gr && xy && F.depth(gr) && F.depth(xy)) lim.push(`The Grover mixer makes a deep circuit (${F.depth(gr)} steps after compiling, against ${F.depth(xy)} for the XY mixer), which is hard for today's noisy hardware.`);
  const next = [
    'Run the small block on real IBM quantum hardware with error mitigation, and report the gap to the simulator.',
    'Re-tune the circuit at each city size (warm-started from the smaller one) instead of reusing small-city settings.',
    'Use a real feeder map and outage ledger with a utility partner, and real demand instead of synthetic.',
    'Compare against strong classical heuristics (for example simulated annealing) on cities too big for exact search.',
  ];
  return el('div', { class: 'grid-2' },
    el('div', { class: 'panel panel--soft' }, el('div', { class: 'panel-b stack-s' }, el('h3', null, 'What it does not do (yet)'), el('ul', { class: 'plain-list' }, lim.map((x) => el('li', null, x))))),
    el('div', { class: 'panel panel--soft' }, el('div', { class: 'panel-b stack-s' }, el('h3', null, 'What we would do next'), el('ul', { class: 'plain-list' }, next.map((x) => el('li', null, x))))));
}

function judgingTable(F) {
  const rows = [
    ['A. Problem validity', 'Step 1, and the Schedule screen', `Load-shedding: decide which feeders are off each hour, under ${RULES.length} rules, at the lowest harm and unevenness.`, 'ch-1'],
    ['B. Meaningful quantum use', 'Steps 2, 3 and 5', `${F.nQubits || 'One'} qubits, one per switch. A Dicke start and Grover mixer keep every try valid and every tie fair. Amplitude estimation counts plans and measures risk.`, 'ch-2'],
    ['C. Implementation and validation', 'Step 4, and Results > Compare methods', `Working Qiskit code, an exact classical reference for every result, ${F.checks ? `${F.checks.passed} of ${F.checks.total}` : 'automated'} checks passing, one command to reproduce.`, 'ch-4'],
    ['D. Innovation', 'Steps 3 and 5', 'Fairness is built into the circuit itself: tied plans get provably equal chances. Plus an audit anyone can run, and hour-by-hour re-planning.', 'ch-3'],
    ['E. Presentation and defence', 'This page, Questions judges ask, the Tour', 'Every screen explains itself behind the Inner working button; limits are stated where the numbers are.', 'ch-6'],
  ];
  return el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
    el('thead', null, el('tr', null, ['What judges look for', 'Where to see it', 'In one line'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', null, rows.map(([c, w, l, id]) => {
      const b = el('button', { type: 'button', class: 'linkish' }, w);
      b.addEventListener('click', () => jumpTo(id));
      return el('tr', null, el('th', { scope: 'row' }, c), el('td', null, b), el('td', null, l));
    }))));
}

export const story = {
  async mount({ root, results }) {
    const F = facts(results);
    const page = el('div', { class: 'page page--story' }, pageHeader('How FairShed works', 'Inner working',
      'The whole project in six steps, for judges and curious readers. Plain words first; technical detail is one click away under each step. Every number on this page is read from the results files.'));
    root.append(page);
    page.append(explainPanel('inner-story', {
      say: 'The whole project on one page: the problem, how it becomes qubits, the circuit and why, how it is checked, what else quantum does here, and the honest limits.',
      what: 'Six numbered steps, each with a plain explanation, a picture or the evidence, and a "For specialists" section you can open.',
      how: ['Read top to bottom, or jump to a step with the buttons under the summary.', el('span', null, 'Dotted-underlined words such as ', term('qubit'), ' open a short explanation.')],
      notice: F.delivered ? verdictSentence(F) : null,
      not: ['Live re-optimisation: every result was computed in advance by the Python code and saved to results/.', 'A speed-up claim: there is none.'],
      qa: [{ q: 'Where should a judge start?', a: 'Here, then "Questions judges ask". To see the product, go to the Schedule and press Play; to see the evidence, open Results > Compare methods.' }],
    }));

    // the 30-second version
    const d = F.delivered;
    const tl = (ic, k, t) => el('div', { class: 'tl-item' }, el('span', { class: 'tl-ic' }, icon(ic, 26)), el('div', null, el('div', { class: 'tl-k' }, k), el('p', null, t)));
    page.append(el('section', { class: 'tldr', 'aria-label': 'The 30-second version' }, el('h2', null, 'The 30-second version'),
      el('div', { class: 'tl-grid' },
        tl('bolt', 'The problem', F.inst ? `When there is not enough power, a utility must switch whole neighbourhoods off, hour by hour. Which ones? Tonight's test: ${F.N} feeders over ${F.T} hours, ${F.nProtected} of which must never be cut.` : na),
        tl('atom', 'Our approach', F.inst ? `Each on/off switch becomes a qubit (${F.nQubits} in all). A quantum circuit built so it can only produce rule-following plans proposes many plans; the best one is kept and audited.` : na),
        tl('pass', 'The result', d ? `Score ${fmt(d.cost, 2)} against the exact best ${fmt(d.exactCost, 2)} (${P(d.ratio)} of the way), every rule followed, and tied plans get an equal chance.` : na),
        tl('warn', 'The honest limit', 'Simulator only, synthetic data. At this size a normal computer finds the exact answer faster, and we claim no speed-up.'))));

    const jumps = [['ch-1', '1. The problem'], ['ch-2', '2. Into qubits'], ['ch-3', '3. The circuit'], ['ch-4', '4. Checked'], ['ch-5', '5. More quantum'], ['ch-6', '6. Limits'], ['ch-judge', 'Judging checklist']];
    page.append(el('nav', { class: 'jumps', 'aria-label': 'Steps on this page' }, jumps.map(([id, t]) => {
      const b = el('button', { type: 'button', class: 'btn' }, t);
      b.addEventListener('click', () => jumpTo(id));
      return b;
    })));

    // 1. the problem
    if (F.inst) {
      const r = F.rules || {};
      const kinds = F.protectedFeeders.map((f) => `${f.name} (${f.kind.replace('_', ' ')})`).join(' and ');
      page.append(chapter(1, 'ch-1', 'The problem: who loses power?', 'Problem and formulation',
        el('p', null, 'When demand is higher than supply, a utility switches whole neighbourhood power lines (', term('feeder', 'feeders'), ') off, one hour at a time: load-shedding. Often this is a fixed rota. It ignores who suffers most, can hit the same area hour after hour, and nobody outside can check it.'),
        el('p', null, el('b', null, 'Who it is for: '), 'the control room that drafts tonight\'s hour-by-hour schedule, and the residents and regulators who want to check it.'),
        el('div', { class: 'grid-3' },
          el('div', { class: 'card' }, el('h3', null, 'What we decide'), el('p', null, `Which feeders are off in each hour. Tonight that is ${F.nQubits} yes-or-no switches.`)),
          el('div', { class: 'card' }, el('h3', null, 'Rules that must hold'), el('ul', { class: 'plain-list' },
            el('li', null, `Exactly ${F.quotas.join(', ')} feeders off in the ${F.T} hours (the `, term('quota'), ', set by the forecast).'),
            el('li', null, `${kinds} are never cut.`),
            r.max_consecutive ? el('li', null, `No feeder off more than ${r.max_consecutive} hours in a row.`) : null,
            r.max_daily_hours ? el('li', null, `No feeder off more than ${r.max_daily_hours} hours a day, counting hours already served (the `, term('ledger'), ').') : null)),
          el('div', { class: 'card' }, el('h3', null, 'The goal: the lowest score'), el('p', null, 'Score = ', term('hardship', 'harm'), ' of each cut + how unevenly outage hours are spread + ',
            F.weights ? `${fmt(F.weights.consecutive, 0)} × ` : '', term('backtoback', 'back-to-back cuts'), '. Harm is higher in crowded, hotter areas, for homes in the evening and shops in the day.'))),
        el('h3', null, 'How big is tonight\'s puzzle?'),
        F.exact ? funnel(F) : el('p', null, na),
        el('p', { class: 'subtle' }, 'The number of patterns doubles with every switch you add. A real city has hundreds of feeders, which is why this kind of puzzle is a candidate for quantum methods at all.'),
        spec('the formulation',
          el('p', null, 'Decision variables, objective and constraints, as optimised and audited:'),
          el('pre', { class: 'formula' }, 'x[t,f] = 1 if feeder f is off in hour t (0 = on). Protected f: no variable (fixed 0).\n'
            + 'minimise  C(x) = w_h * sum_t,f hardship[t][f] * x[t,f]\n'
            + '                + w_f * sum_f (ledger[f] + sum_t x[t,f] - mean)^2\n'
            + '                + w_c * sum_f sum_t x[t,f] * x[t+1,f]          (t = -1 is the hour before)\n'
            + 'subject to  sum_f x[t,f] = quota[t]   for every hour t           (hard: built into the circuit)\n'
            + '            consecutive and daily caps                              (checked by the audit)'),
          F.weights ? el('p', null, `Weights tonight: w_h ${F.weights.hardship}, w_f ${F.weights.fairness}, w_c ${F.weights.consecutive}. Quotas ${F.quotas.join(', ')}. ${F.exact ? `Exact range of valid-plan scores: ${fmt(F.exact.cost_min, 2)} to ${fmt(F.exact.cost_max, 2)}.` : ''}`) : null)));
    }

    // 2. into qubits
    if (F.inst) {
      page.append(chapter(2, 'ch-2', 'Turning the puzzle into qubits', 'Quantum representation',
        el('p', null, 'Each feeder-hour that may be cut becomes one ', term('qubit'), ': 1 means off, 0 means on. Protected feeders get no qubit at all, so no outcome of the circuit can cut a hospital or a water pump. The rule is enforced by construction, not by hoping.'),
        switchboard(F),
        el('p', null, `${F.N} feeders × ${F.T} hours, minus ${F.nProtected} protected feeders × ${F.T} hours = ${F.nQubits} qubits.`),
        el('p', null, 'The score becomes the circuit\'s "energy". Each part (harm, unevenness, back-to-back) turns into small one- and two-qubit rotations, so the circuit can tell better plans from worse ones. Writing the score as a sum over single switches and pairs of switches is called a ', term('qubo', 'QUBO'), '.'),
        spec('the mapping',
          el('ul', { class: 'plain-list' },
            el('li', null, 'Results store plans index-ordered: bits[t*N + f] over all feeder-hours, protected ones fixed to 0 (docs/CONTRACT.md). Qiskit count keys are the reverse order.'),
            el('li', null, 'QUBO to Ising: x = (1 - Z) / 2. Linear terms become single-qubit Z rotations, products become ZZ rotations in the cost step.'),
            el('li', null, 'The quota is not in the cost: the Dicke start and the mixer conserve the number of 1s in each hour block, so it holds exactly.'),
            el('li', null, 'An automated check confirms the circuit\'s cost equals the classical score on every plan.')))));
    }

    // 3. the circuit
    page.append(chapter(3, 'ch-3', 'The quantum circuit, and why this combination', 'Algorithm and justification',
      el('p', null, el('b', null, 'QAOA in one sentence: '), 'start from a blend of candidate plans, then repeat a score step (mark each plan by how good it is) and a mix step (move probability between plans); a normal optimiser tunes both steps so that good plans come out more often when the circuit is measured. FairShed changes the textbook ', term('qaoa', 'QAOA'), ' in two ways: where it starts, and how it mixes.'),
      pipeline(F),
      el('h3', null, 'Each choice is backed by a run'),
      el('p', null, 'Each card changes one part of the circuit and keeps everything else the same. The highlighted bar is what FairShed uses.'),
      decisionCards(F) || el('p', null, na),
      F.abl ? spec('circuit settings', (() => {
        const rows = ['dicke_uniform', 'xy_qaoa_p1', 'xy_qaoa_p3', 'grover_qaoa_p1', 'grover_qaoa_p3', 'penalty_qaoa_p1', 'penalty_qaoa_p3'].map((m) => F.abl.by(m)).filter(Boolean);
        return el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
          el('thead', null, el('tr', null, ['Circuit', 'Qubits', 'Rounds', 'Depth after compiling', 'Optimiser evaluations', 'Tries'].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', null, rows.map((r) => el('tr', null, el('td', null, r.label), el('td', { class: 'num' }, String(r.n_qubits)), el('td', { class: 'num' }, String(r.layers)),
            el('td', { class: 'num' }, String(F.depth(r) ?? 'n/a')), el('td', { class: 'num' }, String(F.evals(r) ?? 'n/a')), el('td', { class: 'num' }, String(r.shots)))))));
      })(), el('p', null, 'Exact simulated probabilities are recorded alongside the sampled ones in results/ablation.json, so sampling noise can be told apart from the circuit.')) : null));

    // 4. checked against the exact answer
    page.append(chapter(4, 'ch-4', 'Is the answer right? Checked against the exact answer', 'Validation',
      el('p', null, 'At this size a normal computer can still check every plan. We use that: every quantum result is compared with the exact best answer, so we know exactly how good it is and how far from perfect.'),
      methodTable(F) || el('p', null, na),
      el('div', { class: 'grid-3' },
        F.checks ? tile(`${F.checks.passed} of ${F.checks.total}`, 'automated checks pass: maths matches, every plan valid, results repeat, screens load', '#/results/scoreboard', 'Proof checklist') : null,
        F.replay ? tile(`${F.replay.passed} of ${F.replay.n}`, `replayed hours passed every rule; ${F.replay.matched} matched the exact best plan`, '#/replay/watch', 'Watch the replay') : null,
        F.tie ? tile(`${F.tie.n} tied plans`, `each gets ${pct(F.tie.prob)} per try; largest difference ${fmtSmart(F.tie.spread, 6)}`, '#/results/lottery', 'Fair tie-breaks') : null)));

    // 5. more quantum
    const cards5 = [];
    if (F.counting) cards5.push(['How many valid plans are there?', 'Quantum counting (amplitude estimation)', `Estimate ${fmt(F.counting.est, 2)}, exact ${F.counting.exact}`, `95% interval ${fmt(F.counting.ci[0], 2)} to ${fmt(F.counting.ci[1], 2)}, on a ${F.counting.block.n_feeders} feeder by ${F.counting.block.n_hours} hour block. More valid plans means more room to be fair.`, '#/results/uncertainty']);
    if (F.risk) cards5.push(['How bad could the worst evenings be?', 'Tail risk (amplitude estimation)', `CVaR estimate ${fmt(F.risk.cvarEst, 3)} MW, exact ${fmt(F.risk.cvarExact, 3)} MW`, `The average shortage the peak-hour plan would miss in the worst ${fmt(100 - F.risk.alpha * 100, 0)}% of forecast errors.`, '#/results/uncertainty']);
    if (F.scale && F.scale.mpsMb !== null) cards5.push(['What happens in a bigger city?', 'MPS simulator', `Up to ${F.scale.maxQ} qubits in ${fmtBytesMb(F.scale.mpsMb)}`, `A full simulation of ${F.scale.maxQ} qubits would need ${fmtBytesMb(fullStateMb(F.scale.maxQ))}. The shortcut keeps only the strongest links between qubits. It is a classical simulation, not an advantage.`, '#/results/scale']);
    if (F.tie) cards5.push(['Is the tie-break really fair?', 'Grover mixer, exact probabilities', `${F.tie.n} tied plans, ${pct(F.tie.prob)} each`, `Largest difference ${fmtSmart(F.tie.spread, 6)}: rounding error. The same holds for all ${F.tie.groups} groups of equal-score plans.`, '#/results/lottery']);
    page.append(chapter(5, 'ch-5', 'More quantum tools around the plan', 'Quantum beyond the planner',
      el('p', null, 'Planning is not the only quantum part. ', term('ae', 'Amplitude estimation'), ' measures how much choice there is and how risky the plan is, and a shortcut simulator shows how the circuit behaves on bigger cities. Each one is checked against an exact answer where one exists.'),
      cards5.length ? el('div', { class: 'grid-2' }, cards5.map(([q, m, big, s, href]) => el('div', { class: 'card card--q' },
        el('div', { class: 'card-k' }, kindTag('quantum'), el('span', null, m)), el('h3', null, q), el('div', { class: 'card-big' }, big), el('p', null, s), link(href, 'See the screen')))) : el('p', null, na)));

    // 6. limits
    page.append(chapter(6, 'ch-6', 'Honest limits, and what comes next', 'Reflection',
      el('p', null, 'These limits are also stated on the screens where the numbers appear, so nothing on the dashboard over-claims.'),
      limitsAndNext(F),
      el('section', { class: 'card card--repro', 'aria-label': 'Reproduce every number' },
        el('h3', null, 'Reproduce every number'),
        el('pre', { class: 'formula' }, 'python scripts/tasks.py setup    # Python 3.11 venv with pinned versions\n'
          + 'python scripts/tasks.py demo     # regenerate every results file, run the tests, rebuild the report\n'
          + 'python scripts/tasks.py ui       # this dashboard at http://localhost:8000/ui/'),
        el('p', null, `Fixed random seed${results.ok('ablation') ? ` (${results.ok('ablation').seed})` : ''}: the same commands give the same files. The dashboard only reads results/*.json; it computes nothing new.`))));

    page.append(el('section', { class: 'chapter', id: 'ch-judge', 'aria-labelledby': 'ch-judge-h' },
      el('div', { class: 'ch-head' }, el('span', { class: 'ch-n', 'aria-hidden': 'true' }, icon('pass', 22)), el('div', null, el('div', { class: 'ch-kicker' }, 'For judges'), el('h2', { id: 'ch-judge-h' }, 'Judging checklist'))),
      el('div', { class: 'ch-body stack' }, judgingTable(F),
        el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/inner/questions' }, 'Next: questions judges ask', icon('arrowr', 20)), el('a', { class: 'btn', href: '#/schedule' }, icon('pin', 20), 'See the product: tonight\'s schedule')))));
    return { destroy() {} };
  },
};

/** Questions a judge who is not a quantum specialist is likely to ask, answered from the results. */
function questionGroups(F, results) {
  const d = F.delivered;
  const gr = F.abl && (F.abl.by('grover_qaoa_p3') || F.abl.by('grover_qaoa_p1'));
  const xy = F.abl && (F.abl.by('xy_qaoa_p3') || F.abl.by('xy_qaoa_p1'));
  const fc = results.ok('forecast');
  const seed = results.ok('ablation') ? results.ok('ablation').seed : null;
  return [
    { name: 'The problem', qs: [
      { q: 'What problem does FairShed solve?', a: 'When supply falls short, a utility must switch some neighbourhood power lines (feeders) off each hour. FairShed decides which ones: it meets the hourly quota, never cuts protected sites, spreads outage hours fairly, avoids back-to-back cuts, and publishes a schedule anyone can check.' },
      { q: 'Who would use it?', a: 'A utility control room drafting the evening\'s schedule and re-planning each hour as the real shortage arrives. Residents and regulators can check the published schedule with the rule checker.' },
      { q: 'What exactly is decided, and what are the rules?', a: F.inst ? `For each hour, which feeders are off: ${F.nQubits} yes-or-no decisions on the test evening. The rules: exactly the quota off each hour, protected feeders never, at most ${F.rules.max_consecutive} hours in a row and ${F.rules.max_daily_hours} hours a day per feeder. Among plans that follow them, the one with the lowest score wins.` : na },
      { q: 'What does "fair" mean here?', a: () => ['Three things. Outage hours are spread evenly, counting hours already served earlier (the ', term('ledger'), '). No feeder is cut hour after hour. And when several plans are equally good, each gets an equal chance, instead of the same area always losing the tie.'] },
      { q: 'How do you guarantee a hospital is never cut?', a: 'Protected feeders get no qubit. The circuit has no switch for them, so no outcome can cut them. The audit checks it again anyway.' },
      { q: 'Is the data real?', a: `The feeders, demand and outage history are synthetic, placed on illustrative Karachi zones.${fc ? ` The weather behind the forecast is ${fc.weather_provenance} (${fc.weather_source}).` : ''} Every screen carries a "Simulator - synthetic data" badge.` },
    ] },
    { name: 'The quantum part', qs: [
      { q: 'What runs on a quantum computer?', a: F.inst ? `Three things, all on the Qiskit Aer simulator: the planner circuit that proposes schedules (QAOA, ${F.nQubits} qubits), quantum counting of how many valid plans exist, and a tail-risk estimate. The forecast, the audit and the exact reference are classical.` : na },
      { q: 'What is QAOA, in plain words?', a: 'A circuit that starts from a blend of candidate plans and repeats two steps: a score step that marks each plan by how good it is, and a mixing step that moves probability between plans. A normal optimiser tunes how strong each step is, so good plans come out more often when the circuit is measured.' },
      { q: 'How is the problem turned into qubits?', a: F.inst ? `One qubit per feeder-hour that may be cut: ${F.N} feeders × ${F.T} hours, minus ${F.nProtected} protected feeders, gives ${F.nQubits}. The score is written as a QUBO (a sum over single switches and pairs of switches), which becomes the circuit's score step. The quota is kept exactly by the start state and the mixer, not by a penalty.` : na },
      { q: 'Why not the textbook QAOA?', a: F.penaltyBest ? `The textbook version can wander into plans that break the quota and only fines them. In our run, ${P(1 - F.penaltyBest.feasibility_pct / 100)} of its tries broke the quota. FairShed starts in a Dicke state (only plans with the right number of cuts) and uses a mixer that never leaves them: every try is a valid plan.` : na },
      { q: 'Why the Grover mixer?', a: gr && xy ? `It gave the best plans of the mixers we tried (${P(gr.approx_ratio)} of the way to the best on an average try, against ${P(xy.approx_ratio)} for the XY mixer), and it treats plans with the same score identically, so tied plans get exactly the same chance${F.tie ? ` (largest difference ${fmtSmart(F.tie.spread, 6)})` : ''}. Fairness is built into the circuit, not added afterwards.` : na },
      { q: 'How many qubits, and would it run on IBM hardware?', a: gr && xy ? `The planner uses ${gr.n_qubits} qubits, which fits on today's IBM machines. But the Grover-mixer circuit is deep (${F.depth(gr)} steps after compiling, against ${F.depth(xy)} for the XY mixer), so today's noisy hardware would need error mitigation. Running it on hardware is our next step; we have not done it.` : na },
      { q: 'What do counting and risk add?', a: F.counting && F.risk ? `They answer "how much choice is there?" (estimate ${fmt(F.counting.est, 2)} valid plans against an exact ${F.counting.exact}, on a small block) and "how bad could the worst evenings be?" (CVaR estimate ${fmt(F.risk.cvarEst, 3)} MW against exact ${fmt(F.risk.cvarExact, 3)} MW). Both use amplitude estimation and are checked against exact answers.` : na },
    ] },
    { name: 'Results and checking', qs: [
      { q: 'Does it find the best plan?', a: d ? `Tonight it scores ${fmt(d.cost, 2)} against the exact best ${fmt(d.exactCost, 2)} (${P(d.ratio)} of the way).${F.pareto ? ` Across the ${F.pareto.n} fairness settings it matches the exact best in ${F.pareto.matched}.` : ''}${F.replay ? ` In the ${F.replay.n}-hour replay it matched in ${F.replay.matched} hours, and ${F.replay.passed} hours passed every rule.` : ''}` : na },
      { q: 'How do you know the quantum results are right?', a: `Every result is compared with an exact classical answer: brute force over every valid plan on small problems, a mixed-integer solver on bigger ones.${F.checks ? ` ${F.checks.passed} of ${F.checks.total} automated checks pass; among them, the circuit's score equals the classical score on every plan, and every quantum sample is a valid plan.` : ''}` },
      { q: 'How often is a single try the best plan?', a: F.bestP && F.abl.guess ? `${pct(F.bestP.p_optimal)} of the time with the best circuit, against ${pct(F.abl.guess)} for a random valid plan: ${fmt(F.bestP.p_optimal / F.abl.guess, 1)} times as likely. That is why the planner keeps the best of ${d && d.tries ? d.tries : 'many'} tries.` : na },
      { q: 'Round-robin scores well. Why not just use it?', a: F.rr ? `On a calm evening taking turns is a decent rule of thumb (${P(F.rr.approx_ratio)} of the way to the best). It ignores who is hurt most and who was cut in the hour before${F.heatwave && F.heatwave.rrBroken ? `, so in the heatwave scenario it breaks ${F.heatwave.rrBroken} rules` : ''}.` : na },
      { q: 'What happens on a bigger city?', a: F.scale && F.scale.mpsMb !== null ? `We simulated the same circuit up to ${F.scale.maxQ} qubits with an MPS simulator, which stored ${fmtBytesMb(F.scale.mpsMb)} where a full simulation would need ${fmtBytesMb(fullStateMb(F.scale.maxQ))}. Quality falls as the city grows (${P(F.scale.topRatio)} at ${F.scale.maxQ} qubits) because the circuit settings were tuned on small cities and reused. It shows behaviour, not a speed-up.` : na },
      { q: 'Can I reproduce the results?', a: `Yes. "python scripts/tasks.py demo" regenerates every results file${seed !== null ? ` from seed ${seed}` : ''}, runs the tests and rebuilds the report. The dashboard only reads those files.` },
    ] },
    { name: 'Limits and next steps', qs: [
      { q: 'Is there a quantum speed-up?', a: 'No, and we do not claim one. At this size a normal computer checks every plan quickly. What the project shows is a correct, fair quantum formulation, checked against exact answers, that is ready to test as hardware grows.' },
      { q: 'Why use quantum at all, then?', a: 'The number of possible plans doubles with every switch, and a real city has hundreds of feeders, so exact search stops being practical. Constrained scheduling like this is one of the problem types QAOA-style methods are being studied for. We built the formulation so that every try is valid and ties are fair, and proved it correct while exact answers still exist.' },
      { q: 'Why should a utility trust the schedule?', a: 'It does not have to trust the circuit. Every schedule is re-scored and audited against the rules by ordinary code, and anyone can run the same checker on the Rule checker screen.' },
      { q: 'What would you do next?', a: 'Run the small block on real IBM hardware with error mitigation; re-tune the circuit at each city size; use a real feeder map and outage ledger with a utility partner; and compare against strong classical heuristics on cities too big for exact search.' },
    ] },
  ];
}

export const questions = {
  async mount({ root, results }) {
    const F = facts(results);
    const page = el('div', { class: 'page' }, pageHeader('Questions judges ask', 'Inner working',
      'Short, honest answers for readers who are not quantum specialists. Numbers are read from the results files.'));
    root.append(page);
    page.append(explainPanel('inner-questions', {
      say: 'The questions a judge is most likely to ask, grouped by topic, each with a short answer built from the results.',
      what: 'Four groups of questions: the problem, the quantum part, results and checking, limits and next steps.',
      how: 'Click a question to open its answer. "Open all" opens every answer at once.',
      notice: 'Each screen\'s own questions are also in the Inner working drawer on that screen.',
      not: 'Anything not backed by a results file: answers whose data is missing say so.',
    }));
    const groups = questionGroups(F, results);
    const all = () => [...page.querySelectorAll('details.qa')];
    const openAll = el('button', { type: 'button', class: 'btn' }, 'Open all');
    const closeAll = el('button', { type: 'button', class: 'btn' }, 'Close all');
    openAll.addEventListener('click', () => all().forEach((x) => { x.open = true; }));
    closeAll.addEventListener('click', () => all().forEach((x) => { x.open = false; }));
    page.append(el('div', { class: 'row' }, openAll, closeAll, el('span', { class: 'subtle' }, `${groups.reduce((a, g) => a + g.qs.length, 0)} questions`)));
    for (const g of groups) {
      page.append(el('section', { class: 'panel', 'aria-label': g.name }, el('div', { class: 'panel-b stack-s' },
        el('h2', null, g.name),
        el('div', { class: 'qa-list' }, g.qs.map((x) => el('details', { class: 'qa' }, el('summary', null, x.q),
          el('div', { class: 'qa-a' }, typeof x.a === 'function' ? x.a() : x.a)))))));
    }
    page.append(el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/inner/algorithms' }, 'Next: the methods', icon('arrowr', 20)), el('a', { class: 'btn', href: '#/inner/story' }, icon('arrowl', 20), 'Back to how FairShed works')));
    return { destroy() {} };
  },
};

const ALGOS = [
  { name: 'QAOA with a Dicke start and the Grover mixer', kind: 'quantum', inPlan: true,
    idea: 'Start in an equal blend of plans that have exactly the right number of cuts each hour, then alternate a score step and a mixing step that reflects around that start.',
    analogy: 'A raffle where only valid tickets are printed, and tickets with the same number always have the same chance.',
    role: 'The planner. Every try is a valid plan, and tied plans get exactly equal chances.',
    look: [['#/results/scoreboard', 'Results > Compare methods: the FairShed row and the "Pick the mixer" card'], ['#/results/lottery', 'Results > Fair tie-breaks: equal bars for tied plans']],
    limit: 'One try rarely lands on the best plan, so the planner keeps the best of many. The reflection makes a deep circuit, which is hard on today\'s hardware.' },
  { name: 'QAOA with the XY mixer', kind: 'quantum', inPlan: false,
    idea: 'Same valid-only start, but the mixer swaps a cut from one feeder to another in the same hour.',
    analogy: 'Passing a "you are off" token between neighbours, so the number of people off never changes.',
    role: 'The comparison mixer, and the circuit used on bigger cities (it is shallower).',
    look: [['#/results/scoreboard', 'Results > Compare methods: the "Pick the mixer" card'], ['#/results/scale', 'Results > Bigger cities']],
    limit: 'Slightly worse plans than the Grover mixer here, and no guarantee that ties are fair.' },
  { name: 'Penalty QAOA (the textbook version)', kind: 'quantum', inPlan: false,
    idea: 'Use an ordinary mixer and only discourage broken rules with an extra cost.',
    analogy: 'A fine for parking in the wrong place: people still do it sometimes.',
    role: 'A baseline that shows why the valid-only start matters.',
    look: [['#/results/scoreboard', 'Results > Compare methods: the "Stay inside the rules" card']],
    limit: 'Wastes most tries on plans that break the quota.' },
  { name: 'Quantum counting (amplitude estimation)', kind: 'quantum', inPlan: false,
    idea: 'Estimate what share of all switch settings are valid plans, using interference instead of checking each one.',
    analogy: 'Estimating how many marbles in a jar are red from a few clever samples.',
    role: 'Tells how much freedom the planner has. Shown on a small block.',
    look: [['#/results/uncertainty', 'Results > Risk and counting: estimate, interval and exact count']],
    limit: 'At this size the exact count is easy, so this shows the method is correct, not faster.' },
  { name: 'Tail risk (amplitude estimation)', kind: 'quantum', inPlan: false,
    idea: 'Turn forecast errors into scenarios and estimate the expected miss, VaR and CVaR.',
    analogy: 'Planning for a bad storm: how bad is a 1-in-20 day, and how bad on average are those days?',
    role: 'Measures the shortage the peak-hour plan may miss.',
    look: [['#/results/uncertainty', 'Results > Risk and counting: the three rulers']],
    limit: 'Only a few scenarios, so a normal computer computes the exact values directly.' },
  { name: 'Grover Adaptive Search', kind: 'quantum', inPlan: false,
    idea: 'Repeatedly ask for any plan better than the best found so far.',
    analogy: '"Is there anything cheaper than this?" until the answer is no.',
    role: 'A second quantum comparator on a small block. Not used in the planner.',
    look: [['#/results/scoreboard', 'Inner working drawer on Compare methods: "Every quantum and classical run"']],
    limit: 'Needs extra qubits to hold the score, so it only fits small blocks, and it did worse than QAOA there.' },
  { name: 'MPS simulator', kind: 'classical', inPlan: false,
    idea: 'Simulate the circuit on bigger cities by keeping only the strongest links between qubits.',
    analogy: 'Summarising a long book by keeping only the main threads.',
    role: 'Shows how quality and memory behave as the city grows.',
    look: [['#/results/scale', 'Results > Bigger cities']],
    limit: 'A classical simulation: it shows behaviour, not a quantum advantage.' },
  { name: 'Exact search (brute force and MILP)', kind: 'classical', inPlan: false,
    idea: 'Check every valid plan, or use a solver that proves it found the best one.',
    analogy: 'Trying every key on the ring, with a list of which keys could possibly fit.',
    role: 'The referee: every other method is scored against it.',
    look: [['#/results/scoreboard', 'Results > Compare methods: the "Exact search" row']],
    limit: 'Easy at this size. The number of plans explodes as the city grows, which is the long-term reason to study other methods.' },
  { name: 'Round-robin and random plans', kind: 'classical', inPlan: false,
    idea: 'Take turns in a fixed order, or draw any valid plan at random.',
    analogy: 'A rota pinned on the fridge, or names drawn from a hat.',
    role: 'Show what a simple rule achieves without optimising.',
    look: [['#/results/scoreboard', 'Results > Compare methods'], ['#/replay/rules', 'Replay and rules > Rule checker: the heatwave example']],
    limit: 'They ignore harm, so they break the back-to-back limit in a heatwave.' },
  { name: 'Ridge forecast', kind: 'classical', inPlan: true,
    idea: 'A straight-line model predicts the hourly shortage from weather, hour and weekday.',
    analogy: 'Fitting a ruler through dots without letting one dot pull it too far.',
    role: 'Sets how many feeders must be off each hour (the quota).',
    look: [['#/results/forecast', 'Results > Shortage forecast']],
    limit: 'Demand is synthetic; only the weather snapshot is real.' },
  { name: 'Rule checker (audit)', kind: 'classical', inPlan: true,
    idea: 'Check a schedule against the four rules, cell by cell, and list every broken rule in plain words.',
    analogy: 'A referee who checks the whole match, not only the final score.',
    role: 'Every plan the planner proposes is audited before it is used.',
    look: [['#/replay/rules', 'Replay and rules > Rule checker']],
    limit: 'It checks rules, not how good a plan is: a plan can pass every rule and still score badly.' },
  { name: 'Receding-horizon re-planning', kind: 'classical', inPlan: true,
    idea: 'Plan a few hours ahead, commit only the next hour, then plan again with what has been learned.',
    analogy: 'A sat-nav that re-plans at every junction.',
    role: 'Turns the planner into something a control room could run hour by hour.',
    look: [['#/replay/watch', 'Replay and rules > Watch it hour by hour']],
    limit: 'The replay covers one synthetic afternoon and evening.' },
];

export const algorithms = {
  async mount({ root }) {
    const page = el('div', { class: 'page' }, pageHeader('The methods, in plain words', 'Inner working',
      'Every quantum and classical method in the project, in five short parts. "Part of the plan" marks the ones FairShed uses to make tonight\'s schedule; the rest check it or compare with it.'));
    root.append(page);
    page.append(explainPanel('inner-algorithms', {
      say: 'Every method in the project, what it does here, where to see its results, and its honest limit.',
      what: 'One block per method, tagged quantum or classical, and marked when it is part of the plan.',
      how: 'Each block has the same five parts. The links in "Where to see it" open the screen with its results.',
      notice: 'Every quantum method is checked against an exact classical answer.',
      not: 'The results themselves: follow the links to see them.',
    }));
    page.append(el('div', { class: 'algos' }, ALGOS.map((a) => el('section', { class: `algo card${a.inPlan ? ' algo--plan' : ''}` },
      el('div', { class: 'row' }, kindTag(a.kind), a.inPlan ? el('span', { class: 'chip chip--pass' }, icon('pass', 14), 'Part of the plan') : el('span', { class: 'chip chip--neutral' }, 'Check or comparison')),
      el('h3', null, a.name),
      el('dl', null,
        el('dt', null, 'The idea'), el('dd', null, a.idea),
        el('dt', null, 'Everyday example'), el('dd', null, a.analogy),
        el('dt', null, 'What it does here'), el('dd', null, a.role),
        el('dt', null, 'Where to see it'), el('dd', null, el('ul', { class: 'plain-list' }, a.look.map(([h, t]) => el('li', null, el('a', { href: h }, t))))),
        el('dt', null, 'Honest limit'), el('dd', null, a.limit))))));
    page.append(el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/inner/glossary' }, 'Next: the glossary', icon('arrowr', 20))));
    return { destroy() {} };
  },
};

export const glossaryPage = {
  async mount({ root, route }) {
    const page = el('div', { class: 'page' }, pageHeader('What do these words mean?', 'Inner working',
      'Every technical word used in the dashboard: what it means, an everyday example, and what it means in FairShed.'));
    root.append(page);
    page.append(explainPanel('inner-glossary', {
      say: `All ${TERM_KEYS.length} technical words in the dashboard, each with a plain meaning, an everyday example, and what it means here.`,
      what: `All ${TERM_KEYS.length} terms, in the order a newcomer meets them.`,
      how: 'Anywhere in the dashboard, a dotted-underlined word opens the same card.',
      notice: 'Each card says what the word means in this project, not only in general.',
      not: 'Results. The cards explain words, not numbers.',
    }));
    page.append(el('div', { class: 'panel' }, el('div', { class: 'panel-b gloss-list' }, TERM_KEYS.map((k) => el('section', { class: 'gloss-item', id: `gl-${k}` },
      el('h3', null, TERMS[k].term), glossaryCard(k))))));
    const want = route.query.get('term');
    if (want) requestAnimationFrame(() => { const n = document.getElementById(`gl-${want}`); if (n) { n.scrollIntoView({ block: 'start' }); n.querySelector('h3').setAttribute('tabindex', '-1'); n.querySelector('h3').focus(); } });
    return { destroy() {} };
  },
};
