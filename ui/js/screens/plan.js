// Schedule (was Plan): who loses power tonight? Map (at least 60% of the width) with an on-map legend,
// a large Play button and the hour slider directly under it, a three-stop plan choice built from
// results/pareto.json, and KPIs with plain translations. Every number comes from the results files.
import { el, fmt, fmtTrim, clock, clockRange, sum, KIND_LABEL, PROTECTED_WHY } from '../util.js';
import { icon, STATE, stateOf, stateChip } from '../icons.js';
import { createFeederMap } from '../components/map.js';
import { naPanel, panel, segmented, tickSlider, kpi, passChip } from '../components/common.js';
import { debugBox } from '../components/planGrid.js';
import { buildOptions, defaultMethod, versusRoundRobin, feederFacts, paretoApplies } from '../planModel.js';
import { explainPanel, pageHeader } from '../explain.js';
import { term } from '../glossary.js';
import * as motion from '../motion.js';

const SCEN = { base: 'Normal evening', heatwave_cap: 'Heatwave' };
const STEP_MS = 1800;

/** Three plain stops on the Pareto sweep, chosen from the data. */
function paretoStops(par) {
  const pts = par.points;
  const idx = pts.map((_, i) => i);
  const minBy = (f, tieHigh) => idx.reduce((a, b) => (f(pts[b]) < f(pts[a]) - 1e-12 || (Math.abs(f(pts[b]) - f(pts[a])) <= 1e-12 && tieHigh && pts[b].fairness_weight > pts[a].fairness_weight) ? b : a));
  return [
    { key: 'harm', label: 'Least total harm', sub: 'cuts where it hurts least', i: minBy((p) => p.hardship_total, false) },
    { key: 'bal', label: 'Balanced', sub: 'the default weights', i: par.default_index },
    { key: 'even', label: 'Most even', sub: 'spreads hours most evenly', i: minBy((p) => p.fairness_metric, true) },
  ];
}

export default {
  async mount({ root, results, params }) {
    const scenarios = ['base', 'heatwave_cap'].filter((k) => results.ok('plans/' + k) || (k === 'base' && results.ok('instance')));
    const S = { scenario: 'base', method: null, pIndex: 0, stop: 'bal', hour: 0, playing: false };
    const par0 = results.ok('pareto');
    if (par0) S.pIndex = par0.default_index;

    let model = buildOptions(results, S.scenario, S.pIndex);
    if (!model.inst || !model.opts.length) {
      const why = !model.inst ? [results.get('plans/base'), results.get('instance')] : [results.get('plans/base'), results.get('pareto')];
      root.append(el('div', { class: 'page' }, pageHeader('Who loses power tonight?', 'Schedule (was Plan)'),
        explainPanel('schedule', { what: 'A map of which feeders are off in each hour.', how: 'Not available.', notice: null, not: 'Not available.' }),
        naPanel(why.filter((e) => e.status !== 'ok'))));
      return { destroy() {} };
    }
    S.method = defaultMethod(model.opts);

    // ---------- DOM ----------
    const mapHost = el('div', { class: 'plan-map', role: 'application', 'aria-label': 'Map of feeders. Select a feeder to see why it is on or off.' });
    const legend = el('div', { class: 'map-legend', 'aria-label': 'Legend' }, el('span', { class: 'ml-h' }, 'Legend:'),
      stateChip(STATE.on), stateChip(STATE.off), stateChip(STATE.protected));
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary play-btn', 'aria-label': 'Play the hours' }, icon('play', 22), el('span', null, 'Play'));
    const hourTitle = el('div', { class: 'hour-title' });
    const hourClock = el('div', { class: 'hour-clock' });
    let hourSlider = null;
    const sliderHost = el('div', { class: 'hour-slider' });
    const quotaEl = el('div', { class: 'quota' });
    const dock = el('div', { class: 'dock', role: 'group', 'aria-label': 'Hour control' },
      playBtn, el('div', null, el('div', { class: 'dock-top' }, hourTitle, hourClock), sliderHost), quotaEl);
    const debugHost = el('div', { class: 'plan-debug' });
    const headline = el('div', { class: 'headline', 'aria-live': 'polite' });
    const choiceHost = el('div');
    const kpiHost = el('div', { class: 'kpis' });
    const scenHost = el('div');
    const methodHost = el('div', { class: 'expert-only' });
    const fairExpert = el('div', { class: 'expert-only' });

    const ins0 = model.inst;
    const prot = ins0.feeders.filter((f) => f.protected);
    const stage = el('div', { class: 'sched' },
      el('div', { class: 'sched-main' },
        pageHeader('Who loses power tonight?', 'Schedule (was Plan)'),
        el('div', { class: 'plan-map-wrap' }, mapHost, legend),
        el('p', { class: 'map-caption' }, 'Illustrative Karachi zones. Synthetic feeders, not real network data. Click any feeder to see why.'),
        dock, debugHost),
      el('aside', { class: 'sched-side', 'aria-label': 'Plan details' },
        panel(null, null, headline),
        explainPanel('schedule', {
          what: [el('span', null, 'Which ', term('feeder', 'feeders'), ' (neighbourhood power lines) are off in each hour of this evening\'s shortage.')],
          how: ['Use Play or the slider to move through the hours.', 'Teal with a check is On, amber with stripes is Off, blue with a shield is Protected.', 'Click a feeder for the plain reason.'],
          notice: [`${ins0.n_feeders} feeders over ${ins0.n_hours} hours; ${prot.length} are protected (${prot.map((f) => f.name).join(', ')}).`,
            `Quotas per hour: ${ins0.quotas.join(', ')} feeders off.`],
          not: ['Real feeders or real outages: everything is synthetic.', 'Live re-planning: the plans shown were computed in advance.'],
        }),
        panel('Which plan?', null, el('div', { class: 'stack' }, scenHost, choiceHost, methodHost, fairExpert)),
        panel('How this plan scores', 'Lower scores are better. Each number has a plain meaning under it.', kpiHost)));
    root.append(stage);

    const cur = () => model.opts.find((o) => o.key === S.method) || model.opts[0];
    const inst = () => model.inst;
    const T = () => inst().n_hours;

    function reasonOf(fa) {
      if (fa.protected) return `On this hour because it is protected (${PROTECTED_WHY[fa.fd.kind] || fa.fd.kind}). Protected feeders are never cut.`;
      const bits = [];
      if (fa.off) {
        if (fa.hardDiffPct < -0.5) bits.push('cutting it now causes less harm than average');
        if (fa.ledger < fa.ledgerMean) bits.push('it has had fewer outage hours than most');
        if (!fa.prevOff) bits.push('it was on in the previous hour, so this is not a back-to-back cut');
        return `Off this hour because: ${bits.length ? bits.join('; ') : 'the quota must be met, and this choice gave the lowest total score'}.`;
      }
      if (fa.hardDiffPct > 0.5) bits.push('cutting it now would cause more harm than average');
      if (fa.ledger > fa.ledgerMean) bits.push('it has already had more outage hours than most');
      if (fa.prevOff) bits.push('it was off in the previous hour');
      return `On this hour because: ${bits.length ? bits.join('; ') : 'other feeders gave a lower total score'}.`;
    }

    function buildPopup(i) {
      const c = cur(); const ins = inst();
      const fa = feederFacts(ins, c.matrix, S.hour, i);
      const st = stateOf(fa.fd, i, c.matrix[S.hour]);
      const dl = el('dl', { class: 'pop-list' });
      const row = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
      row('Area', `${KIND_LABEL[fa.fd.kind] || fa.fd.kind} in ${fa.fd.zone} (synthetic)`);
      if (!fa.protected) {
        row('Harm of a cut this hour', `${fmt(fa.hardHere, 1)}, against an average of ${fmt(fa.hardAvg, 1)} for feeders that can be cut`);
        row('Outage hours before this hour', `${fmtTrim(fa.ledger)} h, against an average of ${fmtTrim(fa.ledgerMean, 2)} h`);
        row('Neighbouring hours', `${fa.prevIsWindowStart ? 'Hour before tonight' : 'Previous hour'}: ${fa.prevOff ? 'off' : 'on'}. Next hour: ${fa.nextOff === null ? 'after tonight\'s plan' : fa.nextOff ? 'off' : 'on'}.`);
      }
      return el('div', { class: 'pop' },
        el('div', { class: 'pop-h' }, el('div', null, el('div', { class: 'pop-name' }, fa.fd.name), el('div', { class: 'subtle' }, clockRange(ins.start_hour, S.hour))), stateChip(st)),
        el('p', { class: 'pop-why' }, reasonOf(fa)), dl);
    }

    const fmap = createFeederMap(mapHost, { feeders: inst().feeders, debug: params.debug, tiles: params.tiles, buildPopup });

    function renderMap(animate = true) {
      const c = cur(); const ins = inst();
      const row = c.matrix[S.hour];
      fmap.setStates(ins.feeders.map((fd, f) => stateOf(fd, f, row)), { hour: S.hour, N: ins.n_feeders, bits: c.bits }, animate);
      fmap.refreshPopup();
    }

    function planName(c) {
      if (c.key === 'quantum') {
        const stop = S.stopLabel || 'Selected';
        return `${stop} plan, chosen by the quantum circuit (simulated)`;
      }
      return `${c.label} plan (${c.kind === 'classical' ? 'classical' : 'quantum'})`;
    }

    function renderHeadline() {
      const c = cur();
      const v = versusRoundRobin(model.opts, c);
      const lines = [el('div', { class: 'subtle' }, 'Showing'), el('div', { class: 'hl-sentence' }, planName(c))];
      if (v && !v.isRR) {
        const abs = Math.abs(v.pct);
        lines.push(el('p', { class: 'hl-sub' }, abs < 0.05 ? 'Its total score equals the take-turns plan (round-robin).'
          : `Its total score is ${fmt(abs, abs < 1 ? 1 : 0)}% ${v.pct > 0 ? 'lower (better)' : 'higher (worse)'} than the take-turns plan (round-robin).`,
          v.rr.nViolations > 0 ? ` Round-robin breaks ${v.rr.nViolations} rule${v.rr.nViolations === 1 ? '' : 's'} in this scenario.` : ''));
      }
      if (c.key === 'quantum' && c.point) {
        lines.push(el('p', { class: 'hl-sub' }, c.point.matches_exact ? 'This is also the best possible plan for these weights (checked by exact search).'
          : `This is not the best possible plan for these weights: exact search finds a score of ${fmt(c.point.exact_cost, 2)} against ${fmt(c.point.cost, 2)}.`));
      }
      headline.replaceChildren(...lines);
    }

    function renderDock() {
      const ins = inst(); const c = cur();
      const off = sum(c.matrix[S.hour]);
      const quota = ins.quotas[S.hour];
      hourTitle.textContent = `Hour ${S.hour + 1} of ${ins.n_hours}`;
      hourClock.textContent = clockRange(ins.start_hour, S.hour);
      quotaEl.replaceChildren(
        el('div', { class: 'quota-main' }, el('span', { class: 'q-num' }, String(off)), ` of ${ins.n_feeders} feeders off`),
        el('div', { class: off !== quota ? 'quota-sub warn-text' : 'quota-sub' }, off !== quota ? `The quota for this hour is ${quota}` : `Quota met: exactly ${quota} must be off`));
      hourSlider.set(S.hour);
    }

    function buildHourSlider() {
      const ins = inst();
      hourSlider = tickSlider({ label: 'Hour of the plan', ticks: Array.from({ length: ins.n_hours }, (_, t) => clock(ins.start_hour, t)), value: S.hour, onInput: (t) => setHour(t, true) });
      sliderHost.replaceChildren(hourSlider.root);
    }

    function renderDebug() {
      debugHost.replaceChildren();
      if (!params.debug) return;
      debugHost.append(debugBox(cur().bits, inst().n_feeders, `Plan "${cur().label}"`));
    }

    function setHour(t, user = false) {
      S.hour = Math.max(0, Math.min(T() - 1, t));
      if (user) stopPlay();
      renderMap(); renderDock();
    }

    let timer = null;
    function stopPlay() {
      S.playing = false; clearInterval(timer); timer = null;
      playBtn.replaceChildren(icon('play', 22), el('span', null, 'Play')); playBtn.setAttribute('aria-label', 'Play the hours');
    }
    function startPlay() {
      if (S.hour >= T() - 1) setHour(0);
      S.playing = true;
      playBtn.replaceChildren(icon('pause', 22), el('span', null, 'Pause')); playBtn.setAttribute('aria-label', 'Pause');
      timer = setInterval(() => { if (S.hour >= T() - 1) { stopPlay(); return; } setHour(S.hour + 1); if (S.hour >= T() - 1) stopPlay(); }, STEP_MS);
    }
    playBtn.addEventListener('click', () => (S.playing ? stopPlay() : startPlay()));

    function renderKpis() {
      const c = cur();
      kpiHost.replaceChildren(
        kpi('Total score', fmt(c.cost, 2), 'Harm plus unfairness plus back-to-back cuts, with the base weights. Lower is better.'),
        kpi('Harm', fmt(c.breakdown.hardship, 1), el('span', null, 'Sum of the ', term('hardship'), ' of every cut in this plan.')),
        kpi('Unevenness', `${fmt(c.fairness, 2)} h`, 'How far total outage hours differ between feeders (standard deviation). 0 would be perfectly even.'),
        kpi('Back-to-back cuts', fmt(c.breakdown.consecutive, 0), 'Times the same feeder is off two hours in a row.'),
        kpi('Rules check', null, c.nViolations ? `${c.nViolations} rule${c.nViolations === 1 ? '' : 's'} broken` : 'Quota, protected feeders, back-to-back and daily limits all met', passChip(c.auditPassed, 'Passes', 'Fails')));
    }

    function renderScenario() {
      if (scenarios.length < 2) { scenHost.replaceChildren(); return; }
      const seg = segmented({ label: 'Scenario', options: scenarios.map((k) => ({ value: k, label: SCEN[k] || k })), value: S.scenario, onChange: switchScenario });
      const d = results.ok('plans/' + S.scenario);
      scenHost.replaceChildren(el('span', { class: 'field-label' }, 'Scenario'), seg.root, d ? el('p', { class: 'subtle', style: 'margin-top:8px' }, d.description) : null);
    }

    function renderChoice() {
      const par = paretoApplies(results, S.scenario);
      if (!par) {
        S.stopLabel = null;
        const opts = model.opts.map((o) => ({ value: o.key, label: o.label }));
        const seg = segmented({ label: 'Plan', options: opts, value: S.method, onChange: (v) => { S.method = v; refreshAll(false); } });
        choiceHost.replaceChildren(el('span', { class: 'field-label' }, 'Plan'), seg.root,
          el('p', { class: 'subtle', style: 'margin-top:8px' }, S.scenario === 'base' ? 'The quantum plans are not available (results/pareto.json is missing).' : 'Quantum plans with the fairness choice were computed for the normal evening only.'));
        methodHost.replaceChildren();
        fairExpert.replaceChildren();
        return;
      }
      const stops = paretoStops(par);
      const curStop = stops.find((s) => s.i === S.pIndex && s.key === S.stop) || stops.find((s) => s.i === S.pIndex);
      S.stopLabel = curStop ? curStop.label : `Fairness weight ${fmtTrim(par.points[S.pIndex].fairness_weight, 3)}`;
      const seg = segmented({ label: 'Fairness choice', value: curStop ? curStop.key : null,
        options: stops.map((s) => ({ value: s.key, label: el('span', null, el('span', null, s.label), el('br'), el('span', { class: 'seg-sub' }, s.sub)) })),
        onChange: (k) => { const s = stops.find((x) => x.key === k); S.stop = k; S.pIndex = s.i; S.method = 'quantum'; refreshAll(true); renderChoice(); } });
      seg.root.classList.add('seg--stops');
      choiceHost.replaceChildren(el('span', { class: 'field-label' }, 'Fairness choice'), seg.root,
        el('p', { class: 'fair-note', style: 'margin-top:8px' }, 'This switches between plans that were computed in advance. Nothing is re-optimised in your browser.'),
        el('p', { class: 'subtle' }, el('span', null, 'Each stop is one point of a ', term('pareto', 'trade-off'), ' between total harm and an even spread of outage hours.')));
      const mseg = segmented({ label: 'Method', options: model.opts.map((o) => ({ value: o.key, label: o.label })), value: S.method, onChange: (v) => { S.method = v; refreshAll(false); } });
      methodHost.replaceChildren(el('span', { class: 'field-label' }, 'Method (Expert)'), mseg.root);
      const fs = tickSlider({ label: 'Fairness weight', ticks: par.points.map((p) => fmtTrim(p.fairness_weight, 3)), value: S.pIndex,
        onInput: (i) => { S.pIndex = i; S.stop = null; S.method = 'quantum'; refreshAll(true); renderChoice(); } });
      const pt = par.points[S.pIndex];
      fairExpert.replaceChildren(el('span', { class: 'field-label' }, 'Fairness weight w_f (Expert)'), fs.root,
        el('p', { class: 'subtle mono' }, `w_f ${fmtTrim(pt.fairness_weight, 3)} | score at this weight ${fmt(pt.cost, 2)} | exact ${fmt(pt.exact_cost, 2)} | P(optimal) per try ${fmt(pt.p_optimal, 4)}`));
    }

    function switchScenario(k) {
      stopPlay();
      S.scenario = k;
      model = buildOptions(results, k, S.pIndex);
      if (!model.inst) return;
      S.method = defaultMethod(model.opts);
      S.hour = Math.min(S.hour, T() - 1);
      fmap.setFeeders(inst().feeders);
      buildHourSlider();
      renderScenario(); renderChoice();
      refreshAll(true, true);
    }

    function refreshAll(rebuild = true, full = false) {
      if (rebuild) model = buildOptions(results, S.scenario, S.pIndex);
      if (!model.opts.some((o) => o.key === S.method)) S.method = defaultMethod(model.opts);
      renderMap(!full); renderDock(); renderHeadline(); renderKpis(); renderDebug();
    }

    buildHourSlider();
    renderScenario(); renderChoice();
    refreshAll(false, true);
    requestAnimationFrame(() => fmap.relayout());
    void motion;
    return { destroy() { stopPlay(); fmap.destroy(); } };
  },
};
