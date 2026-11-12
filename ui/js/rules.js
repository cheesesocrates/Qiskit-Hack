// Browser re-check of the same four audit rules as src/audit/rules.py (quota, protected,
// max consecutive, daily hours), with the same counting and the same score, so an unedited
// example gives exactly the result stored in results/audit_example.json.
// Pure functions over an instance object and a T x N 0/1 matrix (1 = feeder off). No DOM.
// Rule limits come from instance.rules; nothing is hard-coded here.

export const RULES = [
  { id: 'quota', label: 'Quota', hint: 'Exactly m_t feeders are off in each hour' },
  { id: 'protected', label: 'Protected feeders', hint: 'Hospital, water pump and telecom feeders are never off' },
  { id: 'max_consecutive', label: 'Max consecutive hours', hint: 'No feeder is off for more adjacent hours than allowed (the hour before the window counts)' },
  { id: 'daily_hours', label: 'Daily hours', hint: 'Ledger hours plus plan hours stay within the daily limit' },
];

export function checkPlan(inst, M, rulesOverride) {
  const N = inst.n_feeders, T = inst.n_hours;
  const rules = { ...(inst.rules || {}), ...(rulesOverride || {}) };
  const cap = Number(rules.max_consecutive);
  const maxDaily = Number(rules.max_daily_hours);
  const free = [], protectedIds = [];
  for (let f = 0; f < N; f++) (inst.feeders[f].protected ? protectedIds : free).push(f);
  const name = (f) => (inst.feeders[f] ? inst.feeders[f].name : `feeder ${f}`);
  const prev = inst.prev_off || [];
  const ledger = inst.ledger_hours || [];
  const violations = [];
  const counts = { quota: 0, protected: 0, max_consecutive: 0, daily_hours: 0 };
  const add = (rule, hour, feeder, detail) => { violations.push({ rule, hour, feeder, detail }); counts[rule] += 1; };

  for (let t = 0; t < T; t++) {
    const off = M[t].reduce((a, b) => a + b, 0);
    if (off !== inst.quotas[t]) add('quota', t, null, `hour ${t}: expected ${inst.quotas[t]} feeders off, found ${off}`);
  }
  for (let t = 0; t < T; t++) {
    for (const f of protectedIds) if (M[t][f]) add('protected', t, f, `hour ${t}: protected feeder ${f} (${name(f)}) is off`);
  }
  for (const f of free) {
    let run = prev[f] ? 1 : 0;
    let firstBad = null;
    for (let t = 0; t < T; t++) {
      if (M[t][f]) { run += 1; if (run > cap && firstBad === null) firstBad = t; } else run = 0;
    }
    if (firstBad !== null) add('max_consecutive', firstBad, f, `feeder ${f} (${name(f)}) is off more than ${cap} adjacent hours; cap first exceeded at hour ${firstBad}`);
  }
  for (const f of free) {
    let hours = 0;
    for (let t = 0; t < T; t++) hours += M[t][f];
    const total = Number(ledger[f] || 0) + hours;
    if (total > maxDaily + 1e-9) add('daily_hours', null, f, `feeder ${f} (${name(f)}): ledger ${ledger[f] || 0} + plan ${hours} = ${total} hours, daily limit is ${maxDaily}`);
  }
  const totals = { quota: T, protected: T * protectedIds.length, max_consecutive: free.length, daily_hours: free.length };
  const nChecks = Object.values(totals).reduce((a, b) => a + b, 0);
  const nFailed = Object.values(counts).reduce((a, b) => a + b, 0);
  const per_rule = {};
  for (const r of RULES) per_rule[r.id] = { passed: counts[r.id] === 0, count: counts[r.id] };
  return { passed: nFailed === 0, violations, per_rule, score: nChecks ? (100 * (nChecks - nFailed)) / nChecks : 100 };
}
