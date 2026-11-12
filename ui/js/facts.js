// Key facts derived from results/*.json, shared by the Inner working pages, the method comparison and
// Home, so every page quotes the same numbers. Nothing here is a result: each value is read or
// computed from the files at runtime, and a fact whose file is missing is simply absent (null).
import { weightedCost } from './util.js';
import { guessChance } from './metrics.js';
import { checkPlan } from './rules.js';

const num = (re, s) => { const m = re.exec(s || ''); return m ? Number(m[1]) : null; };

export function facts(results) {
  const F = {};
  const base = results.ok('plans/base');
  const inst = results.ok('instance') || (base && base.instance) || null;

  if (inst) {
    const prot = inst.feeders.filter((f) => f.protected);
    F.inst = inst;
    F.N = inst.n_feeders;
    F.T = inst.n_hours;
    F.quotas = inst.quotas;
    F.protectedFeeders = prot;
    F.nProtected = prot.length;
    F.nQubits = (inst.n_feeders - prot.length) * inst.n_hours; // one qubit per feeder-hour that can be cut
    F.nPatterns = 2 ** F.nQubits;
    F.weights = inst.weights;
    F.rules = inst.rules;
  }

  if (base) {
    F.exact = base.exact; // cost_min, cost_max, n_valid, n_optimal
    const ratio = (c) => (base.exact.cost_max - c) / (base.exact.cost_max - base.exact.cost_min);
    F.ratioOf = ratio;
    F.exactPlan = base.plans.find((p) => p.method === 'exact') || null;
    F.rr = base.plans.find((p) => p.method === 'round_robin') || null;
    F.randomOne = base.plans.find((p) => p.method === 'random_valid') || null;
    F.randomStats = base.random_valid_stats || null;
    F.exactTieRule = F.exactPlan && /first of \d+ optimal/i.test(F.exactPlan.notes || '') ? 'first in sorted order' : null;
  }

  // The plan FairShed delivers: the default point of the Pareto sweep (best valid plan of many tries).
  const par = results.ok('pareto');
  if (par && inst && base) {
    const pt = par.points[par.default_index] || par.points[0];
    const cost = weightedCost(pt.breakdown, inst.weights);
    F.delivered = {
      cost, exactCost: base.exact.cost_min, ratio: F.ratioOf(cost), matches: Math.abs(cost - base.exact.cost_min) < 1e-9,
      method: par.method, tries: num(/among (\d+) /i, par.notes), layers: num(/p=(\d+)/, par.method), pOptimal: pt.p_optimal,
      matrix: pt.plan.matrix, audit: checkPlan(inst, pt.plan.matrix),
    };
    F.pareto = { n: par.points.length, matched: par.points.filter((p) => p.matches_exact).length };
  }

  const abl = results.ok('ablation');
  if (abl) {
    const rows = abl.rows.filter((r) => r.instance === abl.instance_name);
    const by = (m) => rows.find((r) => r.method === m) || null;
    F.abl = { rows, by, ref: abl.reference, guess: guessChance(abl.reference), block: abl.rows.filter((r) => r.instance !== abl.instance_name) };
    F.depth = (r) => (r ? num(/Transpiled depth (\d+)/, r.notes) : null);
    F.evals = (r) => (r ? num(/Optimiser evaluations: (\d+)/, r.notes) : null);
    const q = rows.filter((r) => r.kind === 'quantum' && r.method !== 'dicke_uniform');
    F.bestTry = q.length ? q.reduce((a, b) => (b.approx_ratio > a.approx_ratio ? b : a)) : null;
    F.bestP = q.length ? q.reduce((a, b) => (b.p_optimal > a.p_optimal ? b : a)) : null;
    const pen = q.filter((r) => r.method.startsWith('penalty'));
    F.penaltyBest = pen.length ? pen.reduce((a, b) => (b.feasibility_pct > a.feasibility_pct ? b : a)) : null;
  }

  const rep = results.ok('replay');
  if (rep) {
    F.replay = {
      n: rep.frames.length, matched: rep.summary.matches_exact_count,
      passed: rep.frames.filter((f) => f.audit_passed).length,
      quantum: rep.frames.filter((f) => /quantum/i.test(f.solver_used)).length,
      horizon: rep.horizon_hours, first: rep.frames[0] && rep.frames[0].hour, last: rep.frames.length ? rep.frames[rep.frames.length - 1].hour : null,
    };
  }

  const chk = results.ok('checks');
  if (chk) F.checks = chk.summary;

  const lot = results.ok('lottery');
  if (lot && lot.tie_groups.length) {
    const g = lot.tie_groups[0];
    F.tie = { n: g.n_plans, cost: g.cost, prob: g.prob_min, spread: g.prob_spread, qubits: lot.n_qubits, layers: lot.layers, method: lot.method, groups: lot.tie_groups.length };
  }

  const cnt = results.ok('counting');
  if (cnt) F.counting = { est: cnt.estimated_count, exact: cnt.exact_count, ci: cnt.ci, space: cnt.search_space, ok: cnt.within_tolerance, block: cnt.instance };

  const risk = results.ok('risk');
  if (risk) F.risk = { alpha: risk.alpha, cvarExact: risk.exact.cvar, cvarEst: risk.estimated.cvar, tailExact: risk.exact.tail_prob, tailEst: risk.estimated.tail_prob, ok: risk.within_tolerance };

  const sc = results.ok('scaling');
  if (sc) {
    const ok = sc.points.filter((p) => p.status === 'ok');
    const maxQ = ok.length ? Math.max(...ok.map((p) => p.n_qubits)) : null;
    const atMax = ok.filter((p) => p.n_qubits === maxQ && typeof p.mps_memory_mb === 'number');
    const top = atMax.length ? atMax.reduce((a, b) => (b.bond_dim > a.bond_dim ? b : a)) : null;
    F.scale = { maxQ, nOk: ok.length, n: sc.points.length, mpsMb: top ? top.mps_memory_mb : null, topBond: top ? top.bond_dim : null, topRatio: top ? top.approx_ratio : null, layers: sc.layers, method: sc.method };
  }

  const heat = results.ok('plans/heatwave_cap');
  if (heat) {
    const rr = heat.plans.find((p) => p.method === 'round_robin');
    const ex = heat.plans.find((p) => p.method === 'exact');
    F.heatwave = { rrBroken: rr ? rr.n_violations : null, exactPassed: ex ? ex.audit_passed : null,
      randomCapPct: heat.random_valid_stats ? heat.random_valid_stats.cap_violation_pct : null };
  }

  const fc = results.ok('forecast');
  if (fc) F.forecast = { mae: fc.metrics.mae_mw, r2: fc.metrics.r2 };
  return F;
}
