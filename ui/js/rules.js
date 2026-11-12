// Browser re-check of the same four audit rules (quota, protected, max consecutive, daily hours).
// Pure functions over an instance object and a T x N 0/1 matrix (1 = feeder off). No DOM.
// Rule limits come from instance.rules; nothing is hard-coded here.

export const RULES = [
  { id: 'quota', label: 'Quota' , hint: 'Exactly m_t feeders are off in each hour' },
  { id: 'protected', label: 'Protected feeders', hint: 'Hospital, water pump and telecom feeders are never off' },
  { id: 'max_consecutive', label: 'Max consecutive hours', hint: 'No feeder is off for more consecutive hours than allowed' },
  { id: 'daily_hours', label: 'Daily hours', hint: 'No feeder is off for more hours in the window than allowed' },
];

export function checkPlan(inst, M) {
  const N = inst.n_feeders, T = inst.n_hours;
  const rules = inst.rules || {};
  const violations = [];
  const name = (f) => (inst.feeders[f] ? inst.feeders[f].name : `feeder ${f}`);

  for (let t = 0; t < T; t++) {
    const off = M[t].reduce((a, b) => a + b, 0);
    if (off !== inst.quotas[t]) {
      violations.push({ rule: 'quota', hour: t, feeder: null, detail: `hour ${t}: ${off} feeders off, quota is ${inst.quotas[t]}` });
    }
  }
  for (let f = 0; f < N; f++) {
    if (!inst.feeders[f].protected) continue;
    for (let t = 0; t < T; t++) {
      if (M[t][f]) violations.push({ rule: 'protected', hour: t, feeder: f, detail: `${name(f)} is protected but off` });
    }
  }
  if (rules.max_consecutive !== undefined) {
    for (let f = 0; f < N; f++) {
      let run = (inst.prev_off && inst.prev_off[f]) || 0;
      for (let t = 0; t < T; t++) {
        run = M[t][f] ? run + 1 : 0;
        if (run > rules.max_consecutive) {
          violations.push({ rule: 'max_consecutive', hour: t, feeder: f, detail: `${name(f)} off ${run} hours in a row (max ${rules.max_consecutive})` });
        }
      }
    }
  }
  if (rules.max_daily_hours !== undefined) {
    for (let f = 0; f < N; f++) {
      let tot = 0;
      for (let t = 0; t < T; t++) tot += M[t][f];
      if (tot > rules.max_daily_hours) {
        violations.push({ rule: 'daily_hours', hour: null, feeder: f, detail: `${name(f)} off ${tot} h in the window (max ${rules.max_daily_hours})` });
      }
    }
  }
  const per_rule = {};
  for (const r of RULES) {
    const count = violations.filter((v) => v.rule === r.id).length;
    per_rule[r.id] = { passed: count === 0, count };
  }
  const nPass = RULES.filter((r) => per_rule[r.id].passed).length;
  return { passed: violations.length === 0, violations, per_rule, rulesPassed: nPass, score: (100 * nPass) / RULES.length };
}
