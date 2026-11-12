// Glossary: every technical word in the UI. term(key) returns a dotted-underline button that opens a
// small panel (click, tap, Enter or Space; Esc or the Close button closes it). The same data drives
// the full Glossary page. Concepts only: no result numbers live here.
import { el } from './util.js';
import { icon } from './icons.js';

export const TERMS = {
  feeder: { term: 'Feeder', def: 'A power line that supplies one neighbourhood. The utility switches whole feeders on or off.',
    analogy: 'Like one tap in a building: closing it cuts water to every flat on that pipe.',
    here: 'The feeders are synthetic and placed on illustrative Karachi zones. They are not real lines.' },
  quota: { term: 'Quota', def: 'How many feeders must be off in a given hour.',
    analogy: 'If 3 of 8 lights must be dark to stay under a power limit, the quota is 3.',
    here: 'The quota for each hour comes from the forecast shortfall divided by the size of one feeder.' },
  ledger: { term: 'Ledger', def: 'The outage hours each feeder has already served before this plan starts.',
    analogy: 'A chore chart that remembers who already did the dishes this week.',
    here: 'Fairness counts the ledger, so a feeder that was cut earlier is less likely to be cut again.' },
  hardship: { term: 'Hardship', def: 'How much harm one hour without power causes in that area at that time.',
    analogy: 'A power cut at 3 pm in a heatwave hurts more than one at 3 am.',
    here: 'Hardship comes from synthetic heat and population numbers per feeder and hour.' },
  fairness: { term: 'Fairness', def: 'How evenly the outage hours are spread across feeders, counting hours already served.',
    analogy: 'Taking turns so the same street is not always the one in the dark.',
    here: 'The score adds a penalty when one feeder ends up with many more outage hours than the others.' },
  backtoback: { term: 'Back-to-back cut', def: 'The same feeder is off in two hours in a row.',
    analogy: 'Two long waits in a row at the same counter feel worse than two waits spread out.',
    here: 'The score adds a penalty for each back-to-back cut, and the rule checker can cap them.' },
  protected: { term: 'Protected feeder', def: 'A feeder that is never switched off because it serves something critical.',
    analogy: 'The emergency lights stay on even when the rest of the building is dark.',
    here: 'Hospital, water pump and telecom tower feeders. Their switch has no qubit at all, so they cannot be cut.' },
  qubit: { term: 'Qubit', def: 'A quantum bit. When measured it gives 0 or 1, but before that it can hold a blend of both.',
    analogy: 'A coin spinning in the air before it lands heads or tails.',
    here: 'Each feeder-hour that can be cut is one qubit: 1 means off, 0 means on.' },
  simulator: { term: 'Simulator', def: 'A normal computer program that computes exactly what a quantum computer would do.',
    analogy: 'A flight simulator: real physics, no real plane.',
    here: 'Every quantum result here comes from the Qiskit Aer simulator. Nothing ran on quantum hardware.' },
  shot: { term: 'Shot (try)', def: 'One run of the quantum circuit followed by one measurement. It gives one candidate plan.',
    analogy: 'One roll of a loaded die.',
    here: 'The plan we use is the best valid plan among 256 tries.' },
  qubo: { term: 'QUBO', def: 'A score written as a sum of yes or no switches and pairs of switches. Quantum optimisers take this form.',
    analogy: 'A price list where some items cost extra when bought together.',
    here: 'Hardship, fairness and back-to-back cuts are all written as one QUBO over the feeder-hour switches.' },
  dicke: { term: 'Dicke state', def: 'An equal blend of every way to switch off exactly a given number of feeders.',
    analogy: 'Shuffling a deck that only contains hands with exactly 3 aces.',
    here: 'The circuit starts in a Dicke state for each hour, so every try already meets the quota.' },
  mixer: { term: 'Mixer', def: 'The step of the circuit that moves probability from one plan to other plans.',
    analogy: 'Stirring a pot so the flavour spreads.',
    here: 'The XY mixer moves a cut from one feeder to another without changing how many are cut.' },
  qaoa: { term: 'QAOA', def: 'Quantum Approximate Optimisation Algorithm: alternate a score step and a mixing step, tune the step sizes, then sample plans.',
    analogy: 'Shake a tray of marbles, tilt it toward the low corner, shake again, and look where marbles settle.',
    here: 'Three QAOA versions are compared: XY mixer, Grover mixer and penalty.' },
  penalty: { term: 'Penalty QAOA', def: 'QAOA with an ordinary mixer, where broken rules are only discouraged by extra cost.',
    analogy: 'A fine for parking in the wrong spot: it discourages, but people still do it.',
    here: 'It wastes most tries on invalid plans. It is included as a weak baseline.' },
  grover: { term: 'Grover mixer', def: 'A mixer that reflects the state around the starting blend of valid plans.',
    analogy: 'A raffle where every ticket with the same number has exactly the same chance.',
    here: 'Plans with equal score always get exactly equal probability, so ties are broken like a fair lottery.' },
  ratio: { term: 'Approximation ratio', def: 'How close a plan is to the best possible plan. 0 means as bad as the worst valid plan, 1 means the best possible plan.',
    analogy: 'An exam score scaled so the worst answer is 0 and the perfect answer is 1.',
    here: 'For a method, it is the average over all tries, and an invalid try scores 0.' },
  popt: { term: 'P(optimal)', def: 'The chance that one single try lands on a best plan.',
    analogy: 'The chance one dart hits the bullseye.',
    here: 'Shown next to the chance of hitting a best plan by guessing among valid plans.' },
  feasibility: { term: 'Feasibility', def: 'The share of tries that are valid plans: the right number of feeders off and no protected feeder cut.',
    analogy: 'The share of exam answers written in the required format.',
    here: 'The XY and Grover mixers give valid plans every time; the penalty version does not.' },
  pareto: { term: 'Pareto trade-off', def: 'A set of plans where you cannot improve one goal without making another worse.',
    analogy: 'Cheaper or faster delivery: past a point, gaining one costs the other.',
    here: 'The schedule slider switches between precomputed plans from "least total harm" to "most even".' },
  counting: { term: 'Counting', def: 'Estimating how many valid plans exist.',
    analogy: 'Estimating how many marbles in a jar are red by sampling, not by counting each one.',
    here: 'Shown on a small 4 feeder by 2 hour block, where the exact count is also known.' },
  ae: { term: 'Amplitude estimation', def: 'A quantum method to estimate a probability with fewer samples than plain repetition needs.',
    analogy: 'Measuring a hill by its echo instead of walking every step.',
    here: 'Used for counting valid plans and for the risk numbers. Each estimate is compared with the exact value.' },
  var: { term: 'VaR 95', def: 'Value at risk: the loss that is exceeded only in the worst 5% of cases.',
    analogy: 'The rainfall you plan for, knowing only 1 day in 20 is wetter.',
    here: 'Loss is the megawatts of shortfall the peak-hour plan does not cover.' },
  cvar: { term: 'CVaR 95', def: 'Conditional value at risk: the average loss inside that worst 5% of cases.',
    analogy: 'How wet the 1 day in 20 is, on average.',
    here: 'Computed from the forecast errors on the 8-feeder replay cluster.' },
  gas: { term: 'Grover Adaptive Search', def: 'Repeatedly searches for a plan better than the best one found so far.',
    analogy: 'Keep asking "is there anything cheaper than this?" until the answer is no.',
    here: 'Runs only on a small block of switches; it is a comparator, not the main planner.' },
  mps: { term: 'MPS simulator', def: 'Matrix product state: a simulator that keeps only part of the links between qubits so it can run bigger circuits.',
    analogy: 'Summarising a long book chapter by chapter, keeping only the main threads.',
    here: 'Used to run the circuit on bigger problems. It shows how the circuit behaves as it grows, not an advantage.' },
  bond: { term: 'Bond dimension', def: 'How much connection between qubits the MPS simulator remembers. Higher means more accurate and slower.',
    analogy: 'How many threads you keep in that summary.',
    here: 'The Bigger problems screen shows quality as this number grows.' },
  horizon: { term: 'Receding horizon', def: 'Plan a few hours ahead, commit only the next hour, then plan again with new information.',
    analogy: 'A sat-nav that re-plans the route at every junction.',
    here: 'Every hour the replay re-plans the next three hours with the real shortfall and the updated ledger.' },
  warm: { term: 'Warm start', def: 'Starting a new optimisation from the answer of the previous one.',
    analogy: 'Starting today\'s crossword from where you stopped yesterday.',
    here: 'Each replay hour starts the circuit tuning from the previous hour\'s settings.' },
  ridge: { term: 'Ridge regression', def: 'A classical straight-line forecasting method that keeps its weights small to avoid overfitting.',
    analogy: 'Fitting a ruler through dots without letting any one dot pull it too far.',
    here: 'Predicts the hourly shortfall from weather, hour and weekday. It is classical, not quantum.' },
  audit: { term: 'Audit', def: 'Checking a schedule against the rules and listing every broken rule.',
    analogy: 'A referee reviewing the replay.',
    here: 'Four rules: the quota, protected feeders, a cap on back-to-back hours and a cap on daily hours.' },
  synthetic: { term: 'Synthetic data', def: 'Made-up data generated by a program with a fixed seed, so it is repeatable.',
    analogy: 'A practice exam written to look like the real one.',
    here: 'Feeders, demand and the ledger are synthetic. The weather snapshot is real. Nothing here describes a real network.' },
};

let open = null; // { pop, btn }

const PROPER = new Set(['dicke', 'grover', 'gas', 'qubo', 'qaoa', 'var', 'cvar', 'mps', 'popt']);
/** Name as used inside a sentence: "simulator", but "Dicke state" and "QAOA" keep their capitals. */
function inlineName(key) {
  const n = TERMS[key].term;
  return PROPER.has(key) ? n : n.charAt(0).toLowerCase() + n.slice(1);
}

function close(returnFocus = true) {
  if (!open) return;
  const { pop, btn } = open;
  pop.remove();
  btn.setAttribute('aria-expanded', 'false');
  open = null;
  if (returnFocus) btn.focus();
}

function place(pop, btn) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.max(12, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 12));
  pop.style.left = `${left}px`;
  pop.style.top = `${window.scrollY + r.bottom + 8}px`;
}

export function glossaryCard(key, opts = {}) {
  const t = TERMS[key];
  return el('dl', null,
    el('dt', null, 'What it means'), el('dd', null, t.def),
    el('dt', null, 'Everyday example'), el('dd', null, t.analogy),
    el('dt', null, 'In FairShed'), el('dd', null, t.here),
    opts.link ? el('dd', null, el('a', { href: `#/learn/glossary?term=${key}` }, 'Open the full glossary')) : null);
}

/** A glossary term inside text. `label` defaults to the term name. */
export function term(key, label) {
  const t = TERMS[key];
  if (!t) return label || key;
  const btn = el('button', { type: 'button', class: 'gl-term', 'aria-expanded': 'false', 'aria-haspopup': 'dialog', 'data-term': key },
    label || inlineName(key));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open && open.btn === btn) { close(); return; }
    close(false);
    const pop = el('div', { class: 'gl-pop', role: 'dialog', 'aria-label': `Glossary: ${t.term}` },
      el('h3', null, t.term),
      el('button', { type: 'button', class: 'btn btn--icon gl-close', 'aria-label': `Close ${t.term}` }, icon('close', 18), 'Close'),
      glossaryCard(key, { link: true }));
    pop.querySelector('.gl-close').addEventListener('click', () => close());
    pop.addEventListener('click', (ev) => ev.stopPropagation());
    document.body.append(pop);
    place(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    open = { pop, btn };
  });
  return btn;
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
document.addEventListener('click', () => close(false));
window.addEventListener('hashchange', () => close(false));

/** Text helper: tpl`Each ${'qubit'} is ...` is not used; screens compose el() with term() calls. */
export const TERM_KEYS = Object.keys(TERMS);
