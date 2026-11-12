// Learn: How it works, Algorithms explained, Glossary. Concepts only; result numbers live on the
// Results screens, which these pages link to.
import { el } from '../util.js';
import { icon } from '../icons.js';
import { explainPanel, pageHeader } from '../explain.js';
import { term, TERMS, TERM_KEYS, glossaryCard } from '../glossary.js';

const ALGOS = [
  { name: 'Exact search (brute force and MILP)', idea: 'Check every valid plan, or use a classical solver that proves it found the best one.',
    analogy: 'Trying every key on the ring until the door opens, but with a list of which keys could possibly fit.',
    role: 'Gives the true best plan. Every other method is scored against it.',
    look: ['Results > Scoreboard: the "Exact search" row.', 'Bigger problems: the exact best score for each size.'],
    limit: 'Fine at these sizes. For much larger cities the number of plans explodes, which is the long-term reason to study other methods.' },
  { name: 'Round-robin and random baselines', idea: 'Take turns in a fixed order, or pick any valid plan at random.',
    analogy: 'A rota pinned on the fridge, or drawing names from a hat.',
    role: 'Show what a simple rule achieves without optimisation.',
    look: ['Scoreboard: the round-robin and random rows.', 'Rule checker: the heatwave example where round-robin breaks the rules.'],
    limit: 'Round-robin ignores harm, so it can break the back-to-back limit in a heatwave.' },
  { name: 'QAOA with a Dicke start and XY mixer', idea: 'Start in an equal blend of plans with the right number of cuts, then alternate a score step and a mixing step that keeps the count.',
    analogy: 'Shuffling only the hands that have exactly 3 aces, then nudging toward better hands.',
    role: 'The main quantum planner: every try is a valid plan.',
    look: ['Scoreboard: "Valid tries" should be 100%.', 'Scoreboard: chance one try finds the best plan, against guessing.'],
    limit: 'One try rarely lands on the best plan, so the plan used is the best of many tries.' },
  { name: 'Penalty QAOA (ordinary mixer)', idea: 'Use an ordinary mixer and only discourage broken rules with extra cost.',
    analogy: 'A fine for parking in the wrong place: people still do it sometimes.',
    role: 'A weak baseline that shows why the special mixers matter.',
    look: ['Scoreboard: its "Valid tries" column.'],
    limit: 'Wastes most tries on plans that break the quota.' },
  { name: 'QAOA with the Grover mixer', idea: 'Mix by reflecting around the starting blend of valid plans.',
    analogy: 'A raffle where tickets with the same number always have the same chance.',
    role: 'Gives tied plans exactly equal probability, so ties are broken by a fair lottery.',
    look: ['Results > Fair lottery: equal bars for the tied best plans.'],
    limit: 'The reflection uses large multi-qubit gates, so it is harder to run on real hardware.' },
  { name: 'Quantum counting', idea: 'Use amplitude estimation to estimate what share of all switch settings are valid plans.',
    analogy: 'Estimating how many marbles in a jar are red from a few clever samples.',
    role: 'Tells how much freedom the planner has. Shown on a small 4 feeder by 2 hour block.',
    look: ['Results > Uncertainty and counting: estimate, interval and exact count.'],
    limit: 'At this block size the exact count is easy, so this only shows the method gives the right answer.' },
  { name: 'Amplitude estimation for risk', idea: 'Turn forecast errors into scenarios and estimate expected loss, VaR and CVaR.',
    analogy: 'Planning for a bad storm: how bad is a 1-in-20 day, and how bad on average are those days?',
    role: 'Measures the shortage the peak-hour plan may miss. Shown on the 8-feeder replay cluster.',
    look: ['Uncertainty and counting: the risk table, estimate against exact.'],
    limit: 'Only a few scenarios, so a normal computer computes the exact values directly.' },
  { name: 'Grover Adaptive Search', idea: 'Repeatedly ask for any plan better than the best found so far.',
    analogy: '"Is there anything cheaper than this?" until the answer is no.',
    role: 'A second quantum comparator on a small block.',
    look: ['Scoreboard: the Grover Adaptive Search row (small block).'],
    limit: 'Needs extra qubits to hold the score, so it only fits small blocks.' },
  { name: 'MPS scaling', idea: 'Run the circuit on bigger problems with a simulator that keeps only part of the links between qubits.',
    analogy: 'Summarising a long book by keeping only the main threads.',
    role: 'Shows how the circuit behaves as the problem grows.',
    look: ['Results > Bigger problems: quality against bond dimension.'],
    limit: 'This is a classical simulation. It shows behaviour, not a quantum advantage.' },
  { name: 'Ridge forecast', idea: 'A classical straight-line model predicts the hourly shortage from weather, hour and weekday.',
    analogy: 'Fitting a ruler through dots without letting one dot pull it too far.',
    role: 'Sets the quotas for the replay and the scenarios for the risk estimate.',
    look: ['Results > Shortage forecast: error in megawatts and the test week.'],
    limit: 'Demand is synthetic; only the weather snapshot is real.' },
  { name: 'Receding-horizon re-planning', idea: 'Plan three hours ahead, commit only the next hour, then plan again.',
    analogy: 'A sat-nav that re-plans at every junction.',
    role: 'Turns the planner into something a control room could run hour by hour.',
    look: ['Replay and rules > Watch it hour by hour: how many hours matched the best plan.'],
    limit: 'The replay covers one synthetic afternoon and evening.' },
];

export const howItWorks = {
  async mount({ root }) {
    const page = el('div', { class: 'page' }, pageHeader('How does FairShed work?', 'Learn: how it works',
      'The problem, the four steps, and where the quantum part fits. No results here: those are on the Results screens.'));
    root.append(page);
    page.append(explainPanel('learn-how', {
      what: 'A plain explanation of the problem and the method.',
      how: 'Read top to bottom. Dotted-underlined words open a short explanation.',
      notice: 'Each feeder-hour that can be cut is one yes or no switch, and one qubit.',
      not: 'Results. Open Results for the numbers.',
    }));
    page.append(el('section', { class: 'panel' }, el('div', { class: 'panel-b stack-s' },
      el('h2', null, 'The problem'),
      el('p', null, 'A city has a number of ', term('feeder', 'feeders'), ' (neighbourhood power lines) and a shortage that lasts some hours. Each hour, the forecast shortage sets a ', term('quota'), ': exactly that many feeders must be off. ', term('protected', 'Protected feeders'), ' (hospital, water pump, telecom tower) are never off.'),
      el('p', null, 'Among all plans that meet those rules, FairShed looks for the one with the lowest score. The score adds three things: ', term('hardship'), ' (the harm of cutting that feeder in that hour), ', term('fairness'), ' (uneven total outage hours, counting the ', term('ledger'), ' of hours already served) and ', term('backtoback', 'back-to-back cuts'), ' of the same feeder.'),
      el('pre', { class: 'formula expert-only' }, 'x[t,f] = 1 means feeder f is off in hour t; qubit index q = t*N + f\n'
        + 'Score C(x) = w_h * sum hardship[t][f] x[t,f]\n'
        + '           + w_f * sum_f (ledger[f] + sum_t x[t,f] - mean)^2\n'
        + '           + w_c * sum_f sum_t x[t,f] x[t+1,f]\n'
        + 'Rules: sum_f x[t,f] = quota[t] for every hour; x[t,f] = 0 for protected f'))));
    page.append(el('section', { class: 'panel' }, el('div', { class: 'panel-b stack-s' },
      el('h2', null, 'The four steps'),
      el('ol', { class: 'steps' },
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '1'), el('h3', null, 'Forecast'), el('p', null, 'A classical ', term('ridge', 'ridge regression'), ' predicts the shortage for each hour.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '2'), el('h3', null, 'Protect'), el('p', null, 'Protected feeders get no switch at all, so they can never be cut.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '3'), el('h3', null, 'Plan'), el('p', null, 'A ', term('qaoa', 'QAOA'), ' circuit, on a ', term('simulator'), ', samples plans; the best valid one of many ', term('shot', 'tries'), ' is kept.')),
        el('li', { class: 'step' }, el('span', { class: 'step-n' }, '4'), el('h3', null, 'Check'), el('p', null, 'An ', term('audit'), ' checks the rules, and an exact search gives the true best plan to compare with.'))))));
    page.append(el('section', { class: 'panel' }, el('div', { class: 'panel-b stack-s' },
      el('h2', null, 'Where the quantum part fits'),
      el('p', null, 'Each feeder-hour that can be cut is one ', term('qubit'), '. The circuit starts in a ', term('dicke', 'Dicke state'), ': an equal blend of every plan that cuts exactly the right number of feeders each hour, so it starts inside the valid plans. Then it alternates two steps: a score step that tags each plan by its score, and a ', term('mixer', 'mixing step'), ' that moves probability between plans. The XY mixer moves a cut from one feeder to another without changing how many are cut, so it never leaves the valid plans.'),
      el('p', null, 'A normal optimiser tunes the step sizes. Then the circuit is run many times, and the best valid plan among those tries is the plan we use. The ', term('grover', 'Grover mixer'), ' version gives equally good plans exactly equal chances: a fair lottery for ties.'),
      el('p', { class: 'callout callout--honest' }, 'Honest limits: everything runs on a simulator, the data is synthetic, at this size a normal computer finds the exact answer faster, and single tries rarely land on the best plan. No speed-up is claimed.'))));
    page.append(el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/learn/algorithms' }, 'Next: the algorithms explained', icon('arrowr', 20))));
    return { destroy() {} };
  },
};

export const algorithms = {
  async mount({ root }) {
    const page = el('div', { class: 'page' }, pageHeader('Which methods are used, and why?', 'Learn: algorithms explained',
      'Eleven methods, each in five short parts: the idea, an everyday example, its job in FairShed, which numbers to look at, and its honest limit.'));
    root.append(page);
    page.append(explainPanel('learn-algos', {
      what: 'Every classical and quantum method in the project.',
      how: 'Each block has the same five parts. "Which numbers to look at" tells you which screen shows its results.',
      notice: 'The quantum methods are always compared with the exact classical answer.',
      not: 'The results themselves. Follow the screen names to see them.',
    }));
    page.append(el('div', { class: 'panel' }, el('div', { class: 'panel-b' }, ALGOS.map((a) => el('section', { class: 'algo' },
      el('h3', null, a.name),
      el('dl', null,
        el('dt', null, 'The idea'), el('dd', null, a.idea),
        el('dt', null, 'Everyday example'), el('dd', null, a.analogy),
        el('dt', null, 'What it does here'), el('dd', null, a.role),
        el('dt', null, 'Which numbers to look at'), el('dd', null, el('ul', { class: 'plain-list' }, a.look.map((x) => el('li', null, x)))),
        el('dt', null, 'Honest limit'), el('dd', null, a.limit)))))));
    page.append(el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/learn/glossary' }, 'Next: the glossary', icon('arrowr', 20))));
    return { destroy() {} };
  },
};

export const glossaryPage = {
  async mount({ root, route }) {
    const page = el('div', { class: 'page' }, pageHeader('What do these words mean?', 'Learn: glossary',
      'Every technical word used in the dashboard: what it means, an everyday example, and what it means in FairShed.'));
    root.append(page);
    page.append(explainPanel('learn-glossary', {
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
