// Results > Compare methods. The classical methods against FairShed's planner on the same evening
// (four rows), then why the planner combines its quantum parts the way it does (the separate runs
// that back each choice), then the proof checklist. The full table of every quantum variant is
// technical detail: it is marked .expert-only, so it appears in the Inner working drawer.
import { el, fmt, fmtSec } from '../util.js';
import { naPanel, panel, passChip } from '../components/common.js';
import { explainPanel, pageHeader, lookAt, rawJson } from '../explain.js';
import { term } from '../glossary.js';
import { pct, pctOf } from '../metrics.js';
import { facts } from '../facts.js';
import { methodTable, verdictSentence, decisionCards } from '../components/evidence.js';

const GROUPS = [
  { name: 'The maths matches', ids: ['C01', 'C02', 'C03', 'C08', 'C09', 'Q01', 'Q02', 'Q03', 'Q06', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12'],
    what: 'The quantum score equals the classical score on every plan; counts and estimates match exact answers.' },
  { name: 'Every plan is valid', ids: ['C04', 'C05', 'C07', 'C12', 'C13', 'Q04', 'Q05'],
    what: 'Quantum samples never break the quota or cut a protected feeder; the rule checker catches broken plans.' },
  { name: 'Results repeat', ids: ['C06', 'C10', 'C14', 'Q07'], what: 'The same seed gives the same results.' },
  { name: 'Files and screens load', ids: ['S01', 'S02', 'S03', 'C11', 'U01', 'U02', 'U03'], what: 'Every results file matches its schema, every screen loads without errors, text is readable and colours have enough contrast.' },
];

export function checksPanel(chk) {
  const byId = Object.fromEntries(chk.checks.map((c) => [c.id, c]));
  const used = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = [...GROUPS, { name: 'Other checks', ids: chk.checks.map((c) => c.id).filter((id) => !used.has(id)), what: 'Checks not in a group above.' }]
    .map((g) => ({ ...g, list: g.ids.map((id) => byId[id]).filter(Boolean) })).filter((g) => g.list.length);
  return panel('Proof checklist', `Written by the automated test run. ${chk.summary.passed} of ${chk.summary.total} checks pass. Open a group to see each check.`,
    el('div', null, groups.map((g) => {
      const n = g.list.filter((c) => c.passed).length;
      return el('details', { class: 'check-group' },
        el('summary', null, passChip(n === g.list.length, `${n} of ${g.list.length} pass`, `${g.list.length - n} failing`), g.name),
        el('p', { class: 'subtle' }, g.what),
        el('ul', { class: 'plain-list', style: 'margin:12px 0 16px' }, g.list.map((c) => el('li', null, c.passed ? 'Passes: ' : 'FAILS: ', c.name,
          el('span', { class: 'subtle' }, ` (${c.id})`)))));
    })), { label: 'Proof checklist' });
}

/** Every run in ablation.json, for specialists (shown in the Inner working drawer): one expandable row per run. */
function allRunsList(abl) {
  const dash = (x) => (x === null || x === undefined ? '-' : String(x));
  return el('div', { class: 'qa-list runs' }, abl.rows.map((r) => el('details', { class: 'qa' },
    el('summary', null, el('span', null, r.label,
      el('span', { class: 'run-s' }, `${r.kind === 'quantum' ? 'Quantum' : 'Classical'}, ${r.instance}: ${pctOf(r.feasibility_pct)} valid, average try ${fmt(r.approx_ratio * 100, 0)}% of the way to the best`))),
    el('div', { class: 'qa-a' }, el('dl', { class: 'run-dl' },
      el('dt', null, 'P(optimal) per try'), el('dd', null, pct(r.p_optimal)),
      el('dt', null, 'Qubits / rounds / tries'), el('dd', { class: 'mono' }, [r.n_qubits, r.layers, r.shots].map(dash).join(' / ')),
      el('dt', null, 'Run time'), el('dd', null, fmtSec(r.runtime_s)),
      el('dt', null, 'Notes'), el('dd', null, r.notes))))));
}

export default {
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHeader('How does FairShed compare with normal methods?', null,
      'The same evening, the same rules and the same score for every method. A lower score means less harm and a fairer spread of outage hours.'));
    root.append(page);
    const F = facts(results);
    const abl = results.ok('ablation');

    const verdict = verdictSentence(F);
    if (verdict) page.append(el('div', { class: 'callout callout--verdict', 'data-tour': 'scoreboard' }, el('p', null, verdict)));

    page.append(explainPanel('scoreboard', {
      say: 'The classical methods a utility could use, side by side with FairShed\'s planner, all scored against the exact best plan on the same evening.',
      what: [el('span', null, 'Four ways to choose who loses power on the same synthetic evening: the exact search, round-robin, a random valid plan, and FairShed.'),
        el('span', null, 'Below them, four design choices of FairShed\'s quantum circuit, each backed by a pair of runs.')],
      how: [el('span', null, el('b', null, 'Score: '), 'harm plus unevenness plus back-to-back cuts (lower is better). The bar shows the ', term('ratio', 'approximation ratio'), ': 0% is the worst valid plan, 100% the best.'),
        el('span', null, el('b', null, 'Follows every rule: '), 'checked by the same ', term('audit'), ' anyone can run on the Rule checker.'),
        el('span', null, el('b', null, 'Fair when plans tie: '), 'whether equally good plans get an equal chance, or one is always picked.')],
      made: [{ kind: 'classical', text: 'Exact search checks every rule-following plan; round-robin and random plans come from the same classical code.' },
        { kind: 'quantum', text: F.delivered ? `FairShed: ${F.delivered.method}, simulated with Qiskit Aer, best valid plan of ${F.delivered.tries || 'many'} tries.` : 'FairShed: a QAOA circuit simulated with Qiskit Aer, best valid plan of many tries.' },
        { kind: 'classical', text: 'Every plan is re-scored and re-audited outside the circuit, so the circuit cannot mark its own homework.' }],
      notice: verdict ? [verdict, F.heatwave && F.heatwave.rrBroken ? `In the heatwave scenario round-robin breaks ${F.heatwave.rrBroken} rules, because it ignores who was cut in the hour before.` : null].filter(Boolean) : null,
      not: ['Speed. At this size the exact search is easy for a normal computer, and no speed-up is claimed.', 'Real feeders: the problem is synthetic.',
        `FairShed on the heatwave scenario: its rule-following is shown on the ${F.replay ? `${F.replay.n}-hour ` : ''}replay instead.`],
      qa: [
        { q: 'If the exact search wins, why use a quantum circuit?', a: 'At this size you would not need one, and we say so. The number of possible plans doubles with every extra switch, so exact search stops being practical for a whole city. FairShed shows the quantum formulation is correct, keeps every try valid, and makes tie-breaks provably fair, checked against the exact answer while that is still possible.' },
        { q: 'Why is round-robin so close tonight?', a: () => [`On a calm evening taking turns is a decent rule of thumb${F.rr ? ` (${fmt(F.rr.approx_ratio * 100, 0)}% of the way to the best)` : ''}. It ignores who is hurt most and who was cut in the hour before, so it breaks the rules in the heatwave scenario${F.heatwave && F.heatwave.rrBroken ? ` (${F.heatwave.rrBroken} broken rules)` : ''}. Try it on the Rule checker.`] },
        { q: 'What does "fair when plans tie" mean?', a: () => [F.exact ? `Tonight ${F.exact.n_optimal} different plans share the best score. ` : '', 'The exact search always returns the first one in its list, so the same neighbourhoods would lose out every time. FairShed\'s ', term('grover', 'Grover mixer'), ' gives each tied plan exactly the same chance, so the choice is a fair lottery.'] },
        { q: 'Why are the separate quantum runs shown?', a: 'Each card tests one design choice by changing only that part: the valid-only start, the tuning, the mixer, and keeping the best of many tries. Together they show why FairShed uses this combination and not the textbook recipe.' },
      ],
    }));

    if (!F.exact || !abl) {
      page.append(naPanel([results.get('plans/base'), results.get('ablation'), results.get('pareto')].filter((e) => e.status !== 'ok')));
    } else {
      page.append(panel('Classical methods against FairShed', `One synthetic evening: ${F.N} feeders over ${F.T} hours, ${F.exact.n_valid.toLocaleString('en-US')} plans follow the quota, ${F.exact.n_optimal} tie for the best score.`,
        el('div', { class: 'stack' }, methodTable(F),
          lookAt('the highlighted FairShed row. It is the only one with a tick in every column except "Finds the very best plan", where it is close.'),
          el('ul', { class: 'plain-list' },
            el('li', null, 'Score: harm of each cut, plus how unevenly outage hours are spread (counting hours already served), plus back-to-back cuts. All methods use the same score.'),
            F.heatwave ? el('li', null, `Heatwave test: a hotter afternoon where two feeders were cut the hour before. Round-robin breaks ${F.heatwave.rrBroken} rules, ${fmt(F.heatwave.randomCapPct, 1)}% of random plans break the back-to-back limit, and the exact plan ${F.heatwave.exactPassed ? 'passes' : 'fails'}. FairShed's rule-following is shown on the ${F.replay ? `${F.replay.n}-hour` : ''} replay instead.`) : null,
            F.randomStats ? el('li', null, `Random valid plan: the average over ${F.randomStats.n_samples.toLocaleString('en-US')} draws.`) : null))));

      const cards = decisionCards(F);
      if (cards) {
        page.append(panel('Why this combination of quantum parts?', 'Each card changes one part of the circuit and keeps everything else the same. The highlighted bar is what FairShed uses.',
          el('div', { class: 'stack' }, cards, lookAt('the gap between the two bars in each card. Every choice FairShed makes is the longer bar.')), { label: 'Why this combination' }));
      }

      page.append(el('div', { class: 'expert-only stack' },
        panel('Every quantum and classical run', `All ${abl.rows.length} runs in results/ablation.json, including the textbook penalty QAOA and Grover Adaptive Search on the small ${F.abl.block.length ? F.abl.block[0].instance : ''} block. Approximation ratios are averages over all tries, invalid tries scored 0.`, allRunsList(abl)),
        rawJson('results/ablation.json', abl)));
    }
    const chk = results.ok('checks');
    page.append(chk ? checksPanel(chk) : panel('Proof checklist', null, naPanel(results.get('checks'))));
    return { destroy() {} };
  },
};
