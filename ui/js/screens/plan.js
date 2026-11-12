// Screen 1: Plan. First view shows only the map, the hour control and one headline number.
// Everything else (method, scenario, KPIs, fairness slider, debug) sits behind the Details toggle.
import { el, clear, fmt, fmtTrim, clock, clockRange, sum, KIND_LABEL, PROTECTED_WHY } from '../util.js';
import { icon, svgEl, iconSvg, STATE, stateOf, stateChip } from '../icons.js';
import { createFeederMap } from '../components/map.js';
import { naPanel, segmented, tickSlider, kpi, passChip } from '../components/common.js';
import { debugBox } from '../components/planGrid.js';
import { buildOptions, defaultMethod, versusRoundRobin, feederFacts, paretoApplies } from '../planModel.js';
import * as motion from '../motion.js';

const SCENARIO_LABEL = (k) => (k === 'base' ? 'Base' : k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
const STEP_MS = 1800;

export default {
  id: 'plan',
  title: 'Plan',
  async mount({ root, results, params }) {
    const scenarios = ['base', 'heatwave_cap'];
    const S = { scenario: 'base', method: null, pIndex: 0, hour: 0, playing: false, detailsOpen: false };
    const par0 = results.ok('pareto');
    if (par0) S.pIndex = par0.default_index;

    // The map needs an instance (feeders) and at least one plan to show.
    let model = buildOptions(results, S.scenario, S.pIndex);
    if (!model.inst || !model.opts.length) {
      const why = !model.inst ? [results.get('plans/base'), results.get('instance')] : [results.get('plans/base'), results.get('pareto')];
      root.append(el('div', { class: 'page' }, el('h1', { class: 'sr-only' }, 'Plan'),
        el('p', { class: 'lede' }, 'The Plan screen needs the base instance and at least one plan.'), naPanel(why.filter((e) => e.status !== 'ok'))));
      return { destroy() {} };
    }
    S.method = defaultMethod(model.opts);

    // ---------- DOM skeleton ----------
    const mapHost = el('div', { class: 'plan-map', role: 'application', 'aria-label': 'Map of feeders. Select a feeder for details.' });
    const hlVal = el('span', { class: 'hl-val num' }, '');
    const hlUnit = el('span', { class: 'hl-unit' }, '%');
    const hlText = el('div', { class: 'hl-text' });
    const hlSub = el('div', { class: 'hl-sub' });
    const hlSrc = el('div', { class: 'hl-src' });
    const headline = el('div', { class: 'headline', role: 'group', 'aria-label': 'Headline' }, el('div', { class: 'hl-num' }, hlVal, hlUnit), hlText, hlSub, hlSrc);

    const toggle = el('button', { type: 'button', class: 'btn details-toggle', 'aria-expanded': 'false', 'aria-controls': 'plan-details' }, icon('panel', 18), 'Details');
    const caption = el('p', { class: 'map-caption' }, 'Illustrative Karachi zones - synthetic feeders, not real network data');

    // hour dock
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary btn--icon play-btn', 'aria-label': 'Play' }, icon('play', 22));
    const hourTitle = el('div', { class: 'hour-title' });
    const hourClock = el('div', { class: 'hour-clock mono' });
    let hourSlider = null;
    const sliderHost = el('div', { class: 'hour-slider' });
    const quotaEl = el('div', { class: 'quota' });
    const dock = el('div', { class: 'dock', role: 'group', 'aria-label': 'Hour control' },
      playBtn, el('div', { class: 'dock-mid' }, el('div', { class: 'dock-top' }, hourTitle, hourClock), sliderHost), quotaEl);
    const debugHost = el('div', { class: 'plan-debug' });

    const details = el('aside', { class: 'details', id: 'plan-details', 'aria-label': 'Plan details', hidden: true });
    const stage = el('div', { class: 'plan', dataset: { details: 'closed' } },
      el('h1', { class: 'sr-only' }, 'Plan'),
      el('div', { class: 'plan-main' },
        el('div', { class: 'plan-map-wrap' }, mapHost, headline, toggle),
        caption, dock, debugHost),
      details);
    root.append(stage);

    // ---------- helpers ----------
    const cur = () => model.opts.find((o) => o.key === S.method) || model.opts[0];
    const inst = () => model.inst;
    const T = () => inst().n_hours;

    function buildPopup(i) {
      const c = cur(); const ins = inst();
      const fa = feederFacts(ins, c.matrix, S.hour, i);
      const st = stateOf(fa.fd, i, c.matrix[S.hour]);
      const dl = el('dl', { class: 'pop-list' });
      const row = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
      row('Kind', `${KIND_LABEL[fa.fd.kind] || fa.fd.kind} in ${fa.fd.zone}`);
      row('Protected', fa.protected ? `Yes - ${PROTECTED_WHY[fa.fd.kind] || fa.fd.kind}, never shed` : 'No, can be shed');
      const dir = Math.abs(fa.hardDiffPct) < 0.5 ? 'equal to the average' : `${fmt(Math.abs(fa.hardDiffPct), 0)}% ${fa.hardDiffPct < 0 ? 'below' : 'above'} the average`;
      row('Hardship this hour', el('span', null, el('b', { class: 'num' }, fmt(fa.hardHere, 1)), ' vs ', el('b', { class: 'num' }, fmt(fa.hardAvg, 1)), ` average of the ${fa.nFree} sheddable feeders (${dir})`));
      if (!fa.protected) {
        row('Outage hours before this hour', el('span', null, el('b', { class: 'num' }, fmtTrim(fa.ledger)), ' h vs fleet mean ', el('b', { class: 'num' }, fmtTrim(fa.ledgerMean, 2)), ' h'));
        row('Adjacent hours', `${fa.prevIsWindowStart ? 'Hour before the window' : 'Previous hour'}: ${fa.prevOff ? 'off' : 'on'}. Next hour: ${fa.nextOff === null ? 'beyond the window' : fa.nextOff ? 'off' : 'on'}.`);
      }
      const facts = [];
      if (!fa.protected) {
        facts.push(fa.hardDiffPct < -0.5 ? 'Harm from an outage now is lower than for the average feeder.' : fa.hardDiffPct > 0.5 ? 'Harm from an outage now is higher than for the average feeder.' : 'Harm from an outage now is about average.');
        facts.push(fa.ledger < fa.ledgerMean ? 'It has served fewer outage hours than the fleet mean.' : fa.ledger > fa.ledgerMean ? 'It has served more outage hours than the fleet mean.' : 'It has served about the fleet mean of outage hours.');
        if (fa.off && fa.prevOff) facts.push('It was also off in the previous hour (a consecutive outage).');
        if (fa.off && !fa.prevOff) facts.push('It was on in the previous hour, so this is not a consecutive outage.');
      } else {
        facts.push(`Protected feeders (${PROTECTED_WHY[fa.fd.kind] || fa.fd.kind}) are excluded from every shedding hour.`);
      }
      return el('div', { class: 'pop' },
        el('div', { class: 'pop-h' }, el('div', null, el('div', { class: 'pop-name' }, fa.fd.name), el('div', { class: 'subtle' }, `${clockRange(ins.start_hour, S.hour)}`)), stateChip(st)),
        dl,
        el('div', { class: 'pop-facts' }, el('div', { class: 'pop-facts-h' }, fa.off ? 'What the plan sees (this feeder is off)' : 'What the plan sees'), el('ul', null, facts.map((x) => el('li', null, x)))));
    }

    const fmap = createFeederMap(mapHost, { feeders: inst().feeders, debug: params.debug, tiles: params.tiles, buildPopup });

    // ---------- renderers ----------
    function renderMap(animate = true) {
      const c = cur(); const ins = inst();
      const row = c.matrix[S.hour];
      const states = ins.feeders.map((fd, f) => stateOf(fd, f, row));
      fmap.setStates(states, { hour: S.hour, N: ins.n_feeders, bits: c.bits }, animate);
      fmap.refreshPopup();
    }

    function renderHeadline() {
      const c = cur(); const ins = inst();
      const v = versusRoundRobin(model.opts, c);
      hlSrc.replaceChildren();
      if (v && !v.isRR) {
        const abs = Math.abs(v.pct);
        const eq = abs < 0.05;
        hlUnit.style.display = '';
        motion.countTo(hlVal, eq ? 0 : abs, (x) => fmt(x, abs < 1 && !eq ? 1 : 0));
        hlText.textContent = eq ? 'same cost as round-robin' : `${v.pct > 0 ? 'lower' : 'higher'} cost than round-robin`;
        const rrFail = v.rr.nViolations > 0 || v.rr.auditPassed === false;
        hlSub.textContent = `Total cost, same scenario and weights.${rrFail ? ` Round-robin breaks ${v.rr.nViolations} audit ${v.rr.nViolations === 1 ? 'rule' : 'rules'} here.` : ''}`;
      } else if (v && v.isRR) {
        hlVal.textContent = '0'; hlUnit.style.display = ''; hlVal._cv = 0;
        hlText.textContent = 'This is the round-robin plan';
        hlSub.textContent = 'The reference every other plan is compared with.';
      } else {
        hlUnit.style.display = 'none';
        motion.countTo(hlVal, ins.quotas[S.hour], (x) => fmt(x, 0));
        hlText.textContent = `feeders off this hour (quota, of ${ins.n_feeders})`;
        hlSub.textContent = 'Round-robin plan not available, so no cost comparison.';
      }
      const hasQ = model.opts.some((o) => o.key === 'quantum');
      const src = c.key === 'quantum' ? `quantum Pareto plan (${c.note})`
        : `${c.label.toLowerCase()}${c.kind === 'classical' ? ' classical plan' : ''}`;
      hlSrc.textContent = c.key === 'quantum' ? `Showing: ${src}`
        : (!hasQ && /exact/i.test(c.key + c.label) ? 'Showing: exact classical plan - quantum results not available' : `Showing: ${c.label}`);
    }

    function renderDock() {
      const ins = inst(); const c = cur();
      const off = sum(c.matrix[S.hour]);
      const quota = ins.quotas[S.hour];
      hourTitle.textContent = `Hour ${S.hour + 1} of ${ins.n_hours}`;
      hourClock.textContent = clockRange(ins.start_hour, S.hour);
      quotaEl.replaceChildren(
        el('div', { class: 'quota-main' }, el('span', { class: 'num q-num' }, String(off)), ` of ${ins.n_feeders} feeders off`),
        off !== quota ? el('div', { class: 'quota-sub warn-text' }, `Quota for this hour is ${quota}`) : el('div', { class: 'quota-sub' }, `Quota m_t = ${quota}`));
      hourSlider.set(S.hour);
    }

    function buildHourSlider() {
      const ins = inst();
      hourSlider = tickSlider({ label: 'Hour of the plan', ticks: Array.from({ length: ins.n_hours }, (_, t) => clock(ins.start_hour, t)), value: S.hour,
        onInput: (t) => { setHour(t, true); } });
      sliderHost.replaceChildren(hourSlider.root);
    }

    function renderDebug() {
      debugHost.replaceChildren();
      if (!params.debug) return;
      const c = cur();
      debugHost.append(debugBox(c.bits, inst().n_feeders, `Plan "${c.label}"`));
    }

    function setHour(t, user = false) {
      S.hour = Math.max(0, Math.min(T() - 1, t));
      if (user) stopPlay();
      renderMap(); renderDock(); renderHeadlineQuotaOnly();
    }
    function renderHeadlineQuotaOnly() { renderHeadline(); }

    // ---------- play ----------
    let timer = null;
    function stopPlay() {
      S.playing = false; clearInterval(timer); timer = null;
      playBtn.replaceChildren(icon('play', 22)); playBtn.setAttribute('aria-label', 'Play');
    }
    function startPlay() {
      if (S.hour >= T() - 1) setHour(0);
      S.playing = true;
      playBtn.replaceChildren(icon('pause', 22)); playBtn.setAttribute('aria-label', 'Pause');
      timer = setInterval(() => {
        if (S.hour >= T() - 1) { stopPlay(); return; }
        setHour(S.hour + 1);
        if (S.hour >= T() - 1) stopPlay();
      }, STEP_MS);
    }
    playBtn.addEventListener('click', () => (S.playing ? stopPlay() : startPlay()));

    // ---------- details panel ----------
    let methodSeg = null, scenSeg = null, fairSlider = null;
    const kpiHost = el('div', { class: 'kpis' });
    const methodHost = el('div'); const scenHost = el('div'); const fairHost = el('div'); const noteHost = el('div', { class: 'subtle' });

    function renderKpis() {
      const c = cur(); const ins = inst();
      const costNode = el('span', { class: 'num' });
      const items = [
        kpi('Total cost', null, c.key === 'quantum' && Math.abs(c.costAtPoint - c.cost) > 1e-6 ? `at base weights; ${fmt(c.costAtPoint, 2)} at this fairness weight` : 'weighted, base weights', costNode),
        kpi('Hardship', fmt(c.breakdown.hardship, 1), 'sum over off feeders'),
        kpi('Fairness spread', `${fmt(c.fairness, 2)}`, 'std of outage hours, lower is more even'),
        kpi('Consecutive outages', fmt(c.breakdown.consecutive, 0), 'same feeder off in adjacent hours'),
        kpi('Audit', null, c.auditSource === 'browser re-check' ? 'browser re-check of the four rules' : `${c.nViolations} violation${c.nViolations === 1 ? '' : 's'}`, passChip(c.auditPassed, 'Pass', 'Fail')),
      ];
      kpiHost.replaceChildren(...items);
      motion.countTo(costNode, c.cost, (x) => fmt(x, 2));
      costNode._cv = c.cost;
    }

    function renderMethod() {
      const opts = model.opts.map((o) => ({ value: o.key, label: o.label, title: o.note || '' }));
      methodSeg = segmented({ label: 'Method', options: opts, value: S.method, onChange: (v) => { S.method = v; refreshAll(false); } });
      methodHost.replaceChildren(el('span', { class: 'field-label' }, 'Method'), methodSeg.root);
      if (!model.opts.some((o) => o.key === 'quantum')) {
        noteHost.textContent = 'Quantum Pareto plans are not available for this scenario' + (paretoApplies(results, S.scenario) ? '' : ' (they are precomputed for the base case only).');
      } else noteHost.textContent = '';
    }

    function renderScenario() {
      const opts = scenarios.map((k) => ({ value: k, label: SCENARIO_LABEL(k), disabled: !results.ok('plans/' + k) && !(k === 'base' && results.ok('instance')), title: results.ok('plans/' + k) ? results.ok('plans/' + k).description : `${results.get('plans/' + k).path} is not available` }));
      scenSeg = segmented({ label: 'Scenario', options: opts, value: S.scenario, onChange: switchScenario });
      const d = results.ok('plans/' + S.scenario);
      scenHost.replaceChildren(el('span', { class: 'field-label' }, 'Scenario'), scenSeg.root, d ? el('p', { class: 'subtle sc-desc' }, d.description) : null);
    }

    function renderFairness() {
      const par = paretoApplies(results, S.scenario);
      fairHost.replaceChildren();
      const head = el('span', { class: 'field-label' }, 'Fairness weight');
      if (!par) {
        fairHost.append(head, el('p', { class: 'subtle' }, 'The fairness slider needs results/pareto.json for the base scenario.'));
        fairSlider = null; return;
      }
      fairSlider = tickSlider({ label: 'Fairness weight', ticks: par.points.map((p) => fmtTrim(p.fairness_weight, 3)), value: S.pIndex, id: 'fair-slider',
        onInput: (i) => { S.pIndex = i; S.method = 'quantum'; refreshAll(true); } });
      fairHost.append(head, fairSlider.root,
        el('p', { class: 'fair-note' }, 'Switches between precomputed plans - nothing is re-optimised in the browser'),
        el('p', { class: 'subtle' }, 'Left: cost matters most. Right: an even spread of outage hours matters more.'));
      const pt = par.points[S.pIndex];
      fairHost.append(el('p', { class: 'subtle mono' }, `weight ${fmtTrim(pt.fairness_weight, 3)} | cost at this weight ${fmt(pt.cost, 2)} | ${pt.matches_exact ? 'matches the exact optimum' : 'differs from the exact optimum'} | P(optimal) ${fmt(pt.p_optimal, 3)}`));
    }

    function buildDetails() {
      details.replaceChildren(
        el('div', { class: 'details-h' }, el('h2', null, 'Details'), el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Close details', onclick: () => setDetails(false) }, icon('close', 18))),
        el('div', { class: 'details-b' }, scenHost, methodHost, noteHost, kpiHost, fairHost));
    }

    function setDetails(open) {
      S.detailsOpen = open;
      stage.dataset.details = open ? 'open' : 'closed';
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        details.hidden = false;
        motion.set(details, { opacity: 0, x: 16 });
        motion.to(details, { opacity: 1, x: 0, duration: 0.25 });
      } else {
        details.hidden = true;
        toggle.focus();
      }
      setTimeout(() => fmap.map.invalidateSize({ pan: false }), 30);
    }
    toggle.addEventListener('click', () => setDetails(!S.detailsOpen));
    stage.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.detailsOpen && !document.querySelector('.leaflet-popup')) setDetails(false); });

    // ---------- scenario / refresh ----------
    function switchScenario(k) {
      stopPlay();
      S.scenario = k;
      model = buildOptions(results, k, S.pIndex);
      if (!model.inst) return;
      S.method = defaultMethod(model.opts);
      S.hour = Math.min(S.hour, T() - 1);
      fmap.setFeeders(inst().feeders);
      buildHourSlider();
      refreshAll(true, true);
    }

    function refreshAll(rebuildModel = true, full = false) {
      if (rebuildModel) model = buildOptions(results, S.scenario, S.pIndex);
      if (!model.opts.some((o) => o.key === S.method)) S.method = defaultMethod(model.opts);
      renderMap(!full); renderDock(); renderHeadline(); renderKpis(); renderDebug();
      if (full) { renderMethod(); renderFairness(); renderScenario(); }
      else if (methodSeg) methodSeg.set(S.method);
      if (fairSlider) fairSlider.set(S.pIndex);
    }

    buildHourSlider();
    buildDetails();
    renderScenario(); renderMethod(); renderFairness();
    refreshAll(false, true);
    requestAnimationFrame(() => fmap.relayout());

    return {
      destroy() { stopPlay(); fmap.destroy(); },
    };
  },
};
