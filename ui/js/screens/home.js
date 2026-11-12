// Start here: what FairShed is, the problem at a glance, how it works, three findings from the JSON,
// and big links to each question. Every number is read from results/*.json at runtime.
import { el, fmt } from '../util.js';
import { icon } from '../icons.js';
import { explainPanel } from '../explain.js';
import { term } from '../glossary.js';
import { pct, guessChance } from '../metrics.js';
import { startTour } from '../tour.js';

export function findings(results) {
  const out = [];
  const abl = results.ok('ablation');
  const rep = results.ok('replay');
  if (abl) {
    const rows = abl.rows.filter((r) => r.instance === abl.instance_name);
    const q = rows.filter((r) => r.kind === 'quantum' && r.method !== 'dicke_uniform');
    const guess = guessChance(abl.reference);
    if (q.length && guess) {
      const best = q.reduce((a, b) => (b.p_optimal > a.p_optimal ? b : a));
      const m = best.p_optimal / guess;
      out.push({ kind: m >= 1 ? 'win' : 'loss', k: 'Better than guessing?',
        t: `One try of the best quantum circuit lands on a best plan ${pct(best.p_optimal)} of the time. Guessing a valid plan at random gets ${pct(guess)}, so the circuit is ${m >= 1 ? `${fmt(m, 1)} times as likely` : 'less likely'} to hit the best plan.` });
    }
    const rr = rows.find((r) => r.method === 'round_robin');
    if (q.length) {
      const bestR = q.reduce((a, b) => (b.approx_ratio > a.approx_ratio ? b : a));
      const ref = abl.reference;
      let t = `A normal computer checks all ${ref.n_valid} valid plans and finds the best one exactly. A typical quantum try gets ${fmt(bestR.approx_ratio * 100, 0)}% of the way from the worst plan to the best.`;
      if (rr && rr.approx_ratio > bestR.approx_ratio) t += ` Even the simple take-turns plan (round-robin) scores higher, at ${fmt(rr.approx_ratio * 100, 0)}%.`;
      out.push({ kind: 'loss', k: 'Where quantum loses', t });
    }
  }
  if (rep) {
    const s = rep.summary;
    const nq = rep.frames.filter((f) => /quantum/i.test(f.solver_used)).length;
    const nAudit = rep.frames.filter((f) => f.audit_passed).length;
    out.push({ kind: s.matches_exact_count === s.n_frames ? 'win' : 'mixed', k: 'Hour by hour',
      t: `In the ${s.n_frames}-hour replay the quantum planner picked ${nq} of ${s.n_frames} hours. Its plan matched the exact best plan in ${s.matches_exact_count} of them, and ${nAudit} of ${s.n_frames} plans passed every rule.` });
  }
  return out;
}

export default {
  id: 'home',
  async mount({ root, results }) {
    const inst = results.ok('instance');
    const page = el('div', { class: 'page' });
    root.append(page);

    const tourBtn = el('button', { type: 'button', class: 'btn btn--primary btn--big', id: 'home-tour' }, icon('tour', 22), 'Take the 2-minute tour');
    tourBtn.addEventListener('click', () => startTour());
    page.append(el('section', { class: 'hero' },
      el('h1', null, 'Who should lose power when there is not enough to go around?'),
      el('p', null, 'FairShed decides which neighbourhoods lose power in each hour of a shortage. It never cuts hospitals, water pumps or telecom towers, spreads the outage hours fairly, and avoids cutting the same area twice in a row. Its quantum part runs on a ', term('simulator'), ' and every result is checked against the exact answer from a normal computer.'),
      el('div', { class: 'row' }, tourBtn, el('a', { class: 'btn btn--big', href: '#/schedule' }, icon('pin', 22), 'Go straight to the schedule'))));

    page.append(explainPanel('home', {
      what: 'The starting point: the problem, how FairShed works, and three findings taken from the latest results files.',
      how: 'Read the four boxes left to right, then the findings. Each big link at the bottom opens one question.',
      notice: findings(results).length ? 'The findings are written from the results files when the page loads. Blue edge: the quantum part helps. Orange edge: where it loses or falls short.' : null,
      not: ['A real power network: every feeder and demand number is synthetic.', 'A speed-up: at this size a normal computer finds the exact answer.'],
    }));

    const q = inst ? inst.quotas : null;
    const prot = inst ? inst.feeders.filter((f) => f.protected) : null;
    page.append(el('section', { 'aria-label': 'The problem' }, el('h2', { class: 'sec-h' }, 'The problem at a glance'),
      el('div', { class: 'problem' },
        el('div', { class: 'problem-step' }, el('div', { class: 'ps-k' }, '1. Shortfall'), el('div', { class: 'ps-t' }, 'Not enough power'),
          el('p', null, inst ? `Forecast shortage in each of the ${inst.n_hours} hours: ${inst.shortfall_mw.map((v) => `${fmt(v, 1)} MW`).join(', ')}.` : 'The forecast says how many megawatts are missing each hour.')),
        el('div', { class: 'problem-step' }, el('div', { class: 'ps-k' }, '2. Quota'), el('div', { class: 'ps-t' }, 'How many go off'),
          el('p', null, 'Each hour, exactly this many ', term('feeder', 'feeders'), ' must be off', q ? `: ${q.join(', ')} of ${inst.n_feeders}.` : '.')),
        el('div', { class: 'problem-step' }, el('div', { class: 'ps-k' }, '3. The choice'), el('div', { class: 'ps-t' }, 'Which ones?'),
          el('p', null, 'This is what FairShed decides: which feeders go off in which hour.')),
        el('div', { class: 'problem-step' }, el('div', { class: 'ps-k' }, '4. Rules'), el('div', { class: 'ps-t' }, 'Fair and safe'),
          el('p', null, prot ? `${prot.map((f) => f.name).join(' and ')} are ` : 'Hospitals, water pumps and telecom towers are ', term('protected', 'protected'), '. Spread the hours, avoid ', term('backtoback', 'back-to-back cuts'), '.')))));

    page.append(el('section', { 'aria-label': 'How it works' }, el('h2', { class: 'sec-h' }, 'How it works in four steps'),
      el('ol', { class: 'steps' },
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '1'), el('h3', null, 'Forecast'), el('p', null, 'A classical model predicts the shortage for each hour from weather and time of day.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '2'), el('h3', null, 'Protect'), el('p', null, 'Hospitals, water pumps and telecom towers are taken out of the choice.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '3'), el('h3', null, 'Plan'), el('p', null, 'A quantum circuit, simulated, samples schedules that always meet the quota; the best valid one is kept.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '4'), el('h3', null, 'Check'), el('p', null, 'Every schedule is checked against the rules and against the exact best answer.')))));

    const fs = findings(results);
    page.append(el('section', { 'aria-label': 'Findings', 'data-tour': 'findings' }, el('h2', { class: 'sec-h' }, 'What the results say'),
      fs.length
        ? el('div', { class: 'findings' }, fs.map((x) => el('div', { class: `finding${x.kind === 'loss' ? ' finding--loss' : ''}` },
          icon(x.kind === 'loss' ? 'warn' : 'pass', 24), el('div', null, el('div', { class: 'finding-k' }, x.k), el('div', { class: 'finding-t' }, x.t)))))
        : el('div', { class: 'na' }, icon('info', 22), el('div', null, el('div', { class: 'na-title' }, 'Not available'), el('p', null, 'The results files these findings need (ablation.json, replay.json) are missing.')))));

    const link = (href, ic, t, s) => el('a', { class: 'q-link', href }, icon(ic, 32), el('span', null, el('span', { class: 'q-t' }, t), el('br'), el('span', { class: 'q-s' }, s)));
    page.append(el('section', { 'aria-label': 'Questions' }, el('h2', { class: 'sec-h' }, 'Pick a question'),
      el('div', { class: 'questions' },
        link('#/schedule', 'pin', 'Who loses power tonight?', 'Schedule: the map, hour by hour'),
        link('#/replay/watch', 'replay', 'How does it re-plan when things change?', 'Replay and rules: watch it hour by hour'),
        link('#/results/scoreboard', 'compare', 'Did the quantum part work?', 'Results: scoreboard, fair lottery, uncertainty'),
        link('#/learn/how', 'learn', 'How does it work?', 'Learn: plain explanations and a glossary'))));
    return { destroy() {} };
  },
};
