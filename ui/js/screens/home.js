// Start here: what FairShed is, tonight at a glance, the problem, how it works in four steps, a
// pointer to Inner working for judges, and big links to each question. Built for the people who use
// the schedule; the evidence and explanations live behind the Inner working button.
// Every number is read from results/*.json at runtime.
import { el, fmt } from '../util.js';
import { icon } from '../icons.js';
import { explainPanel } from '../explain.js';
import { term } from '../glossary.js';
import { startTour } from '../tour.js';
import { facts } from '../facts.js';
import { verdictSentence } from '../components/evidence.js';

export default {
  id: 'home',
  async mount({ root, results }) {
    const inst = results.ok('instance');
    const page = el('div', { class: 'page' });
    root.append(page);

    const tourBtn = el('button', { type: 'button', class: 'btn btn--big', id: 'home-tour' }, icon('tour', 22), 'Take the 2-minute tour');
    tourBtn.addEventListener('click', () => startTour());
    page.append(el('section', { class: 'hero' },
      el('h1', null, 'Who loses power tonight, and is it fair?'),
      el('p', null, 'When there is not enough electricity, a utility switches whole neighbourhood lines off, hour by hour. FairShed chooses which ones: it never cuts hospitals, water pumps or telecom towers, spreads the hours evenly, and lets anyone check the schedule against the rules.'),
      el('div', { class: 'row' }, el('a', { class: 'btn btn--primary btn--big', href: '#/schedule' }, icon('pin', 22), 'See tonight\'s schedule'), el('a', { class: 'btn btn--big', href: '#/replay/watch' }, icon('replay', 22), 'Watch it re-plan'), tourBtn)));

    const F = facts(results);
    const tiles = [];
    if (inst) tiles.push(['' + inst.n_feeders, `feeders over ${inst.n_hours} hours tonight`]);
    if (inst) tiles.push([inst.quotas.join(' / '), 'feeders must be off in each hour']);
    if (F.inst) tiles.push([String(F.nProtected), 'protected sites, never cut']);
    if (F.replay) tiles.push([`${F.replay.passed} of ${F.replay.n}`, 'replayed hours passed every rule']);
    if (tiles.length) page.append(el('section', { 'aria-label': 'Tonight at a glance' }, el('div', { class: 'glance' }, tiles.map(([v, l]) => el('div', { class: 'glance-tile' }, el('div', { class: 'glance-v' }, v), el('div', { class: 'glance-l' }, l))))));

    page.append(explainPanel('home', {
      say: 'FairShed turns load-shedding into a fair, auditable schedule, and shows honestly what its quantum part does and does not do.',
      what: 'The starting point: tonight at a glance, the problem in four boxes, how FairShed works in four steps, and where to go next.',
      how: 'Read the four boxes left to right, then the four steps. Each card at the bottom opens one question.',
      made: [{ kind: 'classical', text: 'A forecast sets the quota: how many feeders must be off each hour.' },
        { kind: 'classical', text: 'Protected feeders (hospital, water pump, telecom tower) are removed from the choice.' },
        { kind: 'quantum', text: 'A quantum circuit on the Qiskit simulator samples valid schedules; the best valid one is kept.' },
        { kind: 'classical', text: 'Every schedule is audited against four rules and compared with the exact best answer.' }],
      notice: verdictSentence(F),
      not: ['A real power network: every feeder and demand number is synthetic.', 'A speed-up: at this size a normal computer finds the exact answer.'],
      qa: [{ q: 'What is FairShed in one sentence?', a: 'A planner that decides which feeders to switch off each hour of a shortage, fairly and safely, with a quantum circuit proposing the plan and a rule checker auditing it.' },
        { q: 'Is any of this real?', a: 'The feeders, demand and outage history are synthetic, on illustrative Karachi zones. The weather behind the forecast is a real snapshot. Every screen carries a "Simulator - synthetic data" badge.' }],
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

    page.append(el('section', { class: 'judge-card', 'aria-label': 'For judges' }, icon('learn', 40),
      el('div', null, el('h2', null, 'Judging this project, or curious how it works?'),
        el('p', null, 'Inner working explains every screen, how the problem becomes qubits, why the circuit is built this way, how every result is checked against the exact answer, and the honest limits. Open it from any screen with the button at the top, or press i.')),
      el('a', { class: 'btn btn--primary', href: '#/inner/story' }, 'Open Inner working', icon('arrowr', 20))));

    const link = (href, ic, t, s) => el('a', { class: 'q-link', href }, icon(ic, 32), el('span', null, el('span', { class: 'q-t' }, t), el('br'), el('span', { class: 'q-s' }, s)));
    page.append(el('section', { 'aria-label': 'Questions' }, el('h2', { class: 'sec-h' }, 'Where to next?'),
      el('div', { class: 'questions' },
        link('#/schedule', 'pin', 'Who loses power tonight?', 'Schedule: the map, hour by hour'),
        link('#/replay/watch', 'replay', 'How does it re-plan when things change?', 'Replay and rules: watch it hour by hour'),
        link('#/results/scoreboard', 'compare', 'How does it compare with normal methods?', 'Results: method comparison, fair tie-breaks, risk'),
        link('#/inner/story', 'learn', 'How does it work inside?', 'Inner working: the six-step story, questions and answers'))));
    return { destroy() {} };
  },
};
