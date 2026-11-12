// Plain-language translations of every metric. Each function takes values read from results/*.json
// and returns a sentence. Nothing here contains a result number.
import { fmt } from './util.js';

/** Percent with enough decimals to stay honest for small values: 0.93%, 12%, 100%. */
export function pct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const v = x * 100;
  if (v === 0) return '0%';
  if (Math.abs(v) < 0.1) return `${fmt(v, 3)}%`;
  if (Math.abs(v) < 10) return `${fmt(v, 2)}%`;
  return `${fmt(v, 0)}%`;
}
/** Same, from a value already in percent (feasibility_pct). */
export const pctOf = (p) => (p === null || p === undefined ? 'n/a' : pct(p / 100));

export const ratioPlain = (r) => (r === null || r === undefined ? 'not available'
  : `${fmt(r * 100, 0)}% of the way from the worst valid plan (0%) to the best possible plan (100%)`);

export const feasPlain = (p) => `${pctOf(p)} of tries are valid plans (right number of feeders off, no protected feeder cut)`;

/** P(optimal) next to the chance of a lucky guess among valid plans. */
export function poptPlain(p, guess) {
  if (p === null || p === undefined) return 'not available';
  let s = `${pct(p)} chance that one single try is a best plan`;
  if (guess) {
    const m = p / guess;
    s += `; guessing a valid plan at random gives ${pct(guess)}`;
    if (p >= guess * 1.05) s += `, so this is ${fmt(m, m < 10 ? 1 : 0)} times as likely`;
    else if (p <= guess * 0.95) s += `, so this is worse than guessing`;
    else s += `, about the same as guessing`;
  }
  return s;
}

export const entropyPlain = (e) => (e === null || e === undefined ? 'not available'
  : `${fmt(e, 3)} on a 0 to 1 scale, where 1 means outage hours (including hours already served) are spread perfectly evenly`);

export const triesPlain = 'One try is one run of the circuit plus one measurement, which gives one candidate plan.';

/** Chance of hitting a best plan by guessing uniformly among valid plans, from an exact reference. */
export const guessChance = (ref) => (ref && ref.n_valid ? (ref.n_optimal || 1) / ref.n_valid : null);

/** Human date from an ISO timestamp. */
export function when(iso) {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}
