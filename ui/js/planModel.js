// Plan model: turns results files into "plan options" the Plan and Compare screens can show, and derives
// the per-feeder facts used by the popover. Pure functions, no DOM. All numbers come from the JSON.
import { sum, mean, weightedCost, findRow, matrixFromBits } from './util.js';
import { checkPlan } from './rules.js';

export const RR = /round/i;
export const EXACT = /exact/i;

/** Population standard deviation of total outage hours (ledger + plan) over non-protected feeders. */
export function fairnessStd(inst, M) {
  const hours = [];
  inst.feeders.forEach((fd, f) => {
    if (fd.protected) return;
    hours.push(inst.ledger_hours[f] + M.reduce((a, row) => a + row[f], 0));
  });
  const m = mean(hours);
  return Math.sqrt(mean(hours.map((h) => (h - m) ** 2)));
}

/** The scenario's instance: from plans/<scenario>.json, or instance.json for the base case. */
export function scenarioInstance(results, scenario) {
  const p = results.ok('plans/' + scenario);
  if (p) return p.instance;
  if (scenario === 'base') return results.ok('instance');
  return null;
}

export function paretoApplies(results, scenario) {
  const par = results.ok('pareto');
  const inst = scenarioInstance(results, scenario);
  if (!par || !inst) return null;
  return par.instance_name === inst.name || par.instance_name === scenario ? par : null;
}

/** Plan options for one scenario: rows from plans/<scenario>.json (+ the quantum Pareto plan for the base case). */
export function buildOptions(results, scenario, paretoIndex) {
  const plansFile = results.ok('plans/' + scenario);
  const inst = scenarioInstance(results, scenario);
  const opts = [];
  if (!inst) return { inst: null, plansFile, opts };
  const par = paretoApplies(results, scenario);
  if (par) {
    const i = Math.min(Math.max(paretoIndex, 0), par.points.length - 1);
    const pt = par.points[i];
    const M = pt.plan.matrix;
    const audit = checkPlan(inst, M);
    opts.push({
      key: 'quantum', label: 'Quantum Pareto plan', kind: 'quantum', bits: pt.plan.bits, matrix: M,
      cost: weightedCost(pt.breakdown, inst.weights), costAtPoint: pt.cost, breakdown: pt.breakdown,
      feasible: !audit.violations.some((v) => v.rule === 'quota' || v.rule === 'protected'),
      auditPassed: audit.passed, nViolations: audit.violations.length, auditSource: 'browser re-check',
      fairness: pt.fairness_metric, entropy: pt.fairness_entropy, point: pt, pointIndex: i,
      note: `${par.method}, fairness weight ${pt.fairness_weight}`,
    });
  }
  if (plansFile) {
    for (const r of plansFile.plans) {
      opts.push({
        key: r.method, label: r.label, kind: r.kind, bits: r.bits, matrix: r.matrix, cost: r.cost, breakdown: r.breakdown,
        feasible: r.feasible, auditPassed: r.audit_passed, nViolations: r.n_violations, auditSource: 'results file',
        fairness: fairnessStd(inst, r.matrix), entropy: r.fairness_entropy, note: r.notes,
      });
    }
  }
  return { inst, plansFile, opts, pareto: par };
}

/** Default method key: the quantum Pareto plan if present, else the exact plan, else the first row. */
export function defaultMethod(opts) {
  if (opts.some((o) => o.key === 'quantum')) return 'quantum';
  const ex = opts.find((o) => EXACT.test(o.key) || EXACT.test(o.label));
  return (ex || opts[0] || {}).key;
}

/** Percent difference vs the round-robin plan of the same scenario. null if round-robin is unavailable. */
export function versusRoundRobin(opts, cur) {
  const rr = findRow(opts.filter((o) => o.key !== 'quantum'), RR);
  if (!rr || !cur || !(Math.abs(rr.cost) > 1e-12)) return null;
  const pct = ((rr.cost - cur.cost) / Math.abs(rr.cost)) * 100;
  return { pct, rr, isRR: cur === rr || cur.key === rr.key };
}

/** Facts for one feeder at hour t of plan matrix M (popover). */
export function feederFacts(inst, M, t, f) {
  const fd = inst.feeders[f];
  const free = inst.feeders.map((x, i) => i).filter((i) => !inst.feeders[i].protected);
  const hardHere = inst.hardship[t][f];
  const hardAvg = mean(free.map((i) => inst.hardship[t][i]));
  const ledgerAt = (i) => inst.ledger_hours[i] + sum(M.slice(0, t).map((row) => row[i]));
  const ledgerMean = mean(free.map(ledgerAt));
  return {
    fd, off: M[t][f] === 1, protected: fd.protected,
    hardHere, hardAvg, hardDiffPct: hardAvg ? ((hardHere - hardAvg) / hardAvg) * 100 : 0,
    ledger: ledgerAt(f), ledgerMean,
    prevOff: t > 0 ? M[t - 1][f] === 1 : inst.prev_off[f] === 1,
    prevIsWindowStart: t === 0,
    nextOff: t < inst.n_hours - 1 ? M[t + 1][f] === 1 : null,
    nFree: free.length,
  };
}

export { matrixFromBits };
