// Schedule: who loses power tonight? Built for the people who use the schedule.
// Top: one menu bar (which evening, which priority, which method made the plan). Then a one-line
// "Showing" summary, the map with the hour control and a "This hour" list beside it, the whole
// evening as a timetable (areas by hours, the way load-shedding schedules are published), and the
// plan's scores. Every number comes from the results files; nothing is re-optimised in the browser.
import { el, fmt, fmtTrim, clock, clockRange, sum, KIND_LABEL, PROTECTED_WHY } from '../util.js';
import { icon, STATE, stateOf, stateChip } from '../icons.js';
import { createFeederMap } from '../components/map.js';
import { naPanel, panel, segmented, tickSlider, kpi, passChip } from '../components/common.js';
import { debugBox } from '../components/planGrid.js';
import { buildOptions, defaultMethod, versusRoundRobin, feederFacts, paretoApplies } from '../planModel.js';
import { explainPanel, pageHeader } from '../explain.js';
import { term } from '../glossary.js';
import { RULES, checkPlan } from '../rules.js';

const SCEN = { base: 'Normal evening', heatwave_cap: 'Heatwave' };
const METHOD_LABEL = {
  quantum: 'FairShed (quantum planner)',
  exact: 'Exact search (classical)',
  round_robin: 'Round-robin: taking turns (classical)',
  random_valid: 'One random valid plan (classical)',
};
const methodLabel = (o) => METHOD_LABEL[o.key] || `${o.label} (${o.kind})`;
const STEP_MS = 1800;
/** The reader's choices, kept for the session so a re-render (theme switch, leaving and coming back) does not reset them. */
let memory = null;

/** Three plain stops on the Pareto sweep, chosen from the data. */
function paretoStops(par) {
  const pts = par.points;
  const idx = pts.map((_, i) => i);
  const minBy = (f, tieHigh) => idx.reduce((a, b) => (f(pts[b]) < f(pts[a]) - 1e-12 || (Math.abs(f(pts[b]) - f(pts[a])) <= 1e-12 && tieHigh && pts[b].fairness_weight > pts[a].fairness_weight) ? b : a));
  return [
    { key: 'harm', label: 'Least harm', sub: 'Cut where it hurts least, even if some areas lose more hours.', i: minBy((p) => p.hardship_total, false) },
    { key: 'bal', label: 'Balanced', sub: 'The default: harm and an even spread of hours weigh the same.', i: par.default_index },
    { key: 'even', label: 'Most even', sub: 'Spread outage hours as evenly as possible across areas.', i: minBy((p) => p.fairness_metric, true) },
  ];
}

export default {
  async mount({ root, results, params }) {
    const scenarios = ['base', 'heatwave_cap'].filter((k) => results.ok('plans/' + k) || (k === 'base' && results.ok('instance')));
    // method: the plan on screen. want: the method the reader picked; kept when the evening changes and
    // used again as soon as it is available (the heatwave has no quantum plan).
    const S = { scenario: 'base', method: null, want: 'quantum', pIndex: 0, stop: 'bal', hour: 0, playing: false, pick: null };
    const par0 = results.ok('pareto');
    if (par0) S.pIndex = par0.default_index;
    if (memory && scenarios.includes(memory.scenario)) {
      Object.assign(S, { scenario: memory.scenario, want: memory.want, stop: memory.stop, hour: memory.hour });
      if (par0 && memory.pIndex >= 0 && memory.pIndex < par0.points.length) S.pIndex = memory.pIndex;
    }

    let model = buildOptions(results, S.scenario, S.pIndex);
    if (!model.inst || !model.opts.length) {
      const why = !model.inst ? [results.get('plans/base'), results.get('instance')] : [results.get('plans/base'), results.get('pareto')];
      root.append(el('div', { class: 'page' }, pageHeader('Who loses power tonight?', null),
        explainPanel('schedule', { what: 'A map of which feeders are off in each hour.', how: 'Not available.', notice: null, not: 'Not available.' }),
        naPanel(why.filter((e) => e.status !== 'ok'))));
      return { destroy() {} };
    }
    const pickMethod = () => (model.opts.some((o) => o.key === S.want) ? S.want : defaultMethod(model.opts));
    S.method = pickMethod();
    S.hour = Math.max(0, Math.min(model.inst.n_hours - 1, S.hour));
    const remember = () => { memory = { scenario: S.scenario, want: S.want, pIndex: S.pIndex, stop: S.stop, hour: S.hour }; };
    const cur = () => model.opts.find((o) => o.key === S.method) || model.opts[0];
    const inst = () => model.inst;
    const T = () => inst().n_hours;

    // ---------- DOM ----------
    const lede = el('p', { class: 'lede' });
    const menuEvening = el('div', { class: 'ctl' });
    const menuPriority = el('div', { class: 'ctl' });
    const menuMethod = el('div', { class: 'ctl' });
    const showing = el('div', { class: 'showing', 'aria-live': 'polite' });
    const mapHost = el('div', { class: 'plan-map', role: 'application', 'aria-label': 'Map of areas. Select an area to see why it is on or off.' });
    const keyRow = el('div', { class: 'map-key', 'aria-label': 'Key' }, el('span', { class: 'ml-h' }, 'Key'),
      stateChip(STATE.on), stateChip(STATE.off), stateChip(STATE.protected),
      el('span', { class: 'map-caption' }, 'Illustrative Karachi zones, synthetic data. Click an area for the reason.'));
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary play-btn', 'aria-label': 'Play the hours' }, icon('play', 22), el('span', null, 'Play'));
    const hourTitle = el('div', { class: 'hour-title' });
    const hourClock = el('div', { class: 'hour-clock' });
    let hourSlider = null;
    const sliderHost = el('div', { class: 'hour-slider' });
    const quotaEl = el('div', { class: 'quota' });
    const dock = el('div', { class: 'dock', role: 'group', 'aria-label': 'Hour control' },
      playBtn, el('div', null, el('div', { class: 'dock-top' }, hourTitle, hourClock), sliderHost), quotaEl);
    const debugHost = el('div', { class: 'plan-debug' });
    const nowHost = el('div', { class: 'now' });
    const ttHost = el('div');
    const ttWhy = el('div', { class: 'tt-why', 'aria-live': 'polite' });
    const kpiHost = el('div', { class: 'kpis kpis--row' });
    const fairExpert = el('div', { class: 'expert-only stack-s' });

    const ins0 = model.inst;
    const prot = ins0.feeders.filter((f) => f.protected);
    root.append(el('div', { class: 'page page--wide sched-page' },
      el('header', { class: 'page-head' }, el('h1', null, 'Who loses power tonight?'), lede),
      el('section', { class: 'menubar', 'aria-label': 'Choose the plan' }, menuEvening, menuPriority, menuMethod),
      showing,
      el('div', { class: 'sched' },
        el('div', { class: 'sched-main' }, dock, el('div', { class: 'plan-map-wrap' }, mapHost), keyRow, debugHost),
        el('aside', { class: 'sched-side', 'aria-label': 'This hour' }, nowHost)),
      panel('Tonight\'s timetable', 'Each row is one area. Click a cell to jump to that hour and see why.', el('div', { class: 'stack-s' }, ttHost, ttWhy), { label: 'Tonight\'s timetable' }),
      panel('How this plan scores', 'The same score is used for every plan. Lower is better.', kpiHost),
      explainPanel('schedule', {
        say: "Tonight's load-shedding schedule: which neighbourhood power lines are off in each hour, and the plain reason for every choice.",
        made: [{ kind: 'classical', text: 'A ridge-regression forecast of the shortage sets how many areas must be off each hour (the quota).' },
          { kind: 'classical', text: 'Hospitals, water pumps and telecom towers are taken out of the choice: they get no switch.' },
          { kind: 'quantum', text: 'A quantum circuit (Dicke start, Grover mixer) on the Qiskit simulator samples valid plans; the best valid one is kept.' },
          { kind: 'classical', text: 'The plan is audited against the rules and compared with the exact best plan. Nothing is re-optimised in your browser.' }],
        qa: [{ q: 'What does Priority change?', a: () => ['It moves along a ', term('pareto', 'trade-off'), ' between total harm and an even spread of outage hours. Each choice is a plan computed in advance by the same circuit with a different fairness weight.'] },
          { q: 'Why is an area off or on?', a: 'The "This hour" list gives a short reason for every area that is off. Click any area, on the map or in the timetable, for the full reason: its harm this hour and its outage hours so far against the average, and whether it would be a back-to-back cut.' },
          { q: 'What does "Plan made by" do?', a: 'It shows the plan the exact search, round-robin or a random draw would choose for the same evening, so you can see what FairShed changed. The "Showing" line compares each with taking turns.' }],
        what: [el('span', null, 'Which ', term('feeder', 'feeders'), ' (neighbourhood power lines, called areas here) are off in each hour of this evening\'s shortage.')],
        how: ['Pick the evening, the priority and which method made the plan in the menu bar at the top.',
          'Press Play or drag the hour slider; the map and the "This hour" list follow.',
          'The timetable shows the whole evening at once: amber stripes are Off, teal is On, blue with a shield is Protected.'],
        notice: [`${ins0.n_feeders} areas over ${ins0.n_hours} hours; ${prot.length} are protected (${prot.map((f) => f.name).join(', ')}).`,
          `Quotas per hour: ${ins0.quotas.join(', ')} areas off.`],
        not: ['Real feeders or real outages: everything is synthetic.', 'Live re-planning: the plans shown were computed in advance.'],
      }),
      fairExpert));

    // ---------- reasons ----------
    function whyParts(fa) {
      const bits = [];
      if (fa.off) {
        if (fa.hardDiffPct < -0.5) bits.push('less harm than average this hour');
        if (fa.ledger < fa.ledgerMean) bits.push('fewer outage hours than most so far');
        if (!fa.prevOff) bits.push('not off the hour before');
      } else {
        if (fa.hardDiffPct > 0.5) bits.push('a cut would cause more harm than average');
        if (fa.ledger > fa.ledgerMean) bits.push('already more outage hours than most');
        if (fa.prevOff) bits.push('was off the hour before');
      }
      return bits;
    }
    /** Plans that are not optimised have a different kind of reason: a rota or a random draw. */
    function simpleReason(fa) {
      const k = cur().key;
      if (k === 'round_robin') return fa.off ? 'Its turn in the take-turns rota (round-robin ignores harm and outage history).' : 'Not its turn in the take-turns rota.';
      if (/random/.test(k)) return fa.off ? 'Picked by a random draw among plans that meet the quota.' : 'Not picked by the random draw.';
      return null;
    }
    function reasonOf(fa) {
      if (fa.protected) return `On this hour because it is protected (${PROTECTED_WHY[fa.fd.kind] || fa.fd.kind}). Protected areas are never cut.`;
      const simple = simpleReason(fa);
      if (simple) return `${fa.off ? 'Off' : 'On'} this hour: ${simple.charAt(0).toLowerCase()}${simple.slice(1)}`;
      const bits = whyParts(fa);
      if (fa.off) return `Off this hour because: ${bits.length ? bits.join('; ') : 'the quota must be met, and this choice gave the lowest total score'}.`;
      return `On this hour because: ${bits.length ? bits.join('; ') : 'other areas gave a lower total score'}.`;
    }
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    function buildPopup(i) {
      const c = cur(); const ins = inst();
      const fa = feederFacts(ins, c.matrix, S.hour, i);
      const st = stateOf(fa.fd, i, c.matrix[S.hour]);
      const dl = el('dl', { class: 'pop-list' });
      const row = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
      row('Area', `${KIND_LABEL[fa.fd.kind] || fa.fd.kind} in ${fa.fd.zone} (synthetic)`);
      if (!fa.protected) {
        row('Harm of a cut this hour', `${fmt(fa.hardHere, 1)}, against an average of ${fmt(fa.hardAvg, 1)} for areas that can be cut`);
        row('Outage hours before this hour', `${fmtTrim(fa.ledger)} h, against an average of ${fmtTrim(fa.ledgerMean, 2)} h`);
        row('Neighbouring hours', `${fa.prevIsWindowStart ? 'Hour before tonight' : 'Previous hour'}: ${fa.prevOff ? 'off' : 'on'}. Next hour: ${fa.nextOff === null ? 'after tonight\'s plan' : fa.nextOff ? 'off' : 'on'}.`);
      }
      return el('div', { class: 'pop' },
        el('div', { class: 'pop-h' }, el('div', null, el('div', { class: 'pop-name' }, fa.fd.name), el('div', { class: 'subtle' }, clockRange(ins.start_hour, S.hour))), stateChip(st)),
        el('p', { class: 'pop-why' }, reasonOf(fa)), dl);
    }

    const fmap = createFeederMap(mapHost, { feeders: inst().feeders, debug: params.debug, tiles: params.tiles, buildPopup });

    // ---------- menus: built once, then updated in place (no flicker, focus stays where it was) ----------
    const evHelp = el('p', { class: 'ctl-help' });
    const evSeg = scenarios.length > 1
      ? segmented({ label: 'Evening', options: scenarios.map((k) => ({ value: k, label: SCEN[k] || k })), value: S.scenario, onChange: switchScenario })
      : null;
    const evStatic = evSeg ? null : el('div', { class: 'ctl-static' });
    menuEvening.append(el('span', { class: 'ctl-label' }, 'Evening'), evSeg ? evSeg.root : evStatic, evHelp);

    const stops = par0 ? paretoStops(par0) : [];
    const prHelp = el('p', { class: 'ctl-help' });
    const prSeg = stops.length
      ? segmented({ label: 'Priority', value: null, options: stops.map((s) => ({ value: s.key, label: s.label, title: s.sub })),
        onChange: (k) => { const s = stops.find((x) => x.key === k); S.stop = k; S.pIndex = s.i; S.method = S.want = 'quantum'; refreshAll(true); renderMenus(); } })
      : null;
    menuPriority.append(el('span', { class: 'ctl-label' }, 'Priority'), prSeg ? prSeg.root : el('div', { class: 'ctl-static' }, 'Not available'), prHelp);

    // fairness weight slider for specialists (shown in the Inner working drawer); built once so dragging it is never interrupted
    const fsText = el('p', { class: 'subtle mono' });
    const fs = par0 ? tickSlider({ label: 'Fairness weight', ticks: par0.points.map((p) => fmtTrim(p.fairness_weight, 3)), value: S.pIndex,
      onInput: (i) => { if (i === S.pIndex && S.method === 'quantum') return; S.pIndex = i; S.stop = null; S.method = S.want = 'quantum'; refreshAll(true); renderMenus(); } }) : null;
    if (fs) fairExpert.append(el('span', { class: 'field-label' }, 'Fairness weight (for specialists)'), fs.root, fsText);

    const sel = el('select', { class: 'select', id: 'plan-method' });
    const mHelp = el('p', { class: 'ctl-help' });
    let selFor = null;
    sel.addEventListener('change', () => { S.method = S.want = sel.value; refreshAll(false); renderMenus(); });
    menuMethod.append(el('label', { class: 'ctl-label', for: 'plan-method' }, 'Plan made by'), el('div', { class: 'select-wrap' }, sel), mHelp);

    /** The priority stop that matches the plan on screen (null when none does), and its label for the "Showing" line. */
    function stopNow() {
      const par = paretoApplies(results, S.scenario);
      const st = par ? (stops.find((s) => s.i === S.pIndex && s.key === S.stop) || stops.find((s) => s.i === S.pIndex)) : null;
      S.stopLabel = par ? (st ? st.label : `Fairness weight ${fmtTrim(par.points[S.pIndex].fairness_weight, 3)}`) : null;
      return { par, curStop: st };
    }

    function renderMenus() {
      const ins = inst();
      // evening
      if (evSeg) evSeg.set(S.scenario); else evStatic.textContent = SCEN[S.scenario] || S.scenario;
      evHelp.textContent = `${clock(ins.start_hour, 0)} to ${clock(ins.start_hour, ins.n_hours)}, ${ins.quotas.join(', ')} areas off by hour.`;
      // priority
      const { par, curStop } = stopNow();
      if (prSeg) stops.forEach((s) => prSeg.setDisabled(s.key, !par));
      if (!prSeg) prHelp.textContent = 'The quantum plans are missing (results/pareto.json).';
      else if (!par) { prSeg.set(null); prHelp.textContent = 'Priority choices were computed for the normal evening only.'; }
      else if (S.method !== 'quantum') { prSeg.set(null); prHelp.textContent = 'Showing a normal method. Pick a priority to go back to FairShed\'s plan.'; }
      else { prSeg.set(curStop ? curStop.key : null); prHelp.textContent = curStop ? curStop.sub : 'A custom fairness weight, set under "For specialists" in Inner working.'; }
      if (fs) {
        fairExpert.hidden = !par;
        fs.set(S.pIndex);
        const pt = par0.points[S.pIndex];
        fsText.textContent = `w_f ${fmtTrim(pt.fairness_weight, 3)} | score at this weight ${fmt(pt.cost, 2)} | exact ${fmt(pt.exact_cost, 2)} | P(optimal) per try ${fmt(pt.p_optimal, 4)}`;
      }
      // method: options change only with the evening
      if (selFor !== S.scenario) {
        sel.replaceChildren(...model.opts.map((o) => el('option', { value: o.key }, methodLabel(o))));
        selFor = S.scenario;
      }
      sel.value = S.method;
      mHelp.textContent = S.method === 'quantum' ? 'Or pick a normal method to compare.' : 'A normal method, shown for comparison.';
    }

    // ---------- views ----------
    function planName(c) {
      if (c.key === 'quantum') return `${S.stopLabel || 'Selected'} plan, made by FairShed's quantum planner (simulated)`;
      return `Plan made by ${methodLabel(c)}`;
    }

    function renderShowing() {
      const c = cur();
      const v = versusRoundRobin(model.opts, c);
      const facts = [passChip(c.auditPassed, 'Follows every rule', `${c.nViolations} rule${c.nViolations === 1 ? '' : 's'} broken`)];
      if (v && !v.isRR) {
        const abs = Math.abs(v.pct);
        facts.push(el('span', { class: 'chip chip--neutral' }, abs < 0.05 ? 'Same score as taking turns' : `${fmt(abs, abs < 1 ? 1 : 0)}% ${v.pct > 0 ? 'better' : 'worse'} score than taking turns`));
      }
      if (c.key === 'quantum' && c.point) {
        facts.push(el('span', { class: 'chip chip--neutral' }, c.point.matches_exact ? 'Same score as the exact best plan'
          : `Exact best plan scores ${fmt(c.point.exact_cost, 2)}; this one ${fmt(c.point.cost, 2)}`));
      }
      showing.replaceChildren(el('div', { class: 'showing-t' }, el('span', { class: 'showing-k' }, 'Showing'), el('span', null, planName(c))), el('div', { class: 'showing-f' }, facts));
    }

    function renderNow() {
      const ins = inst(); const c = cur(); const t = S.hour;
      const row = c.matrix[t];
      const off = [], on = [], pr = [];
      ins.feeders.forEach((fd, f) => (fd.protected ? pr : row[f] ? off : on).push(f));
      const item = (f, st, why) => {
        const b = el('button', { type: 'button', class: `now-item now-item--${st.key}`, 'aria-label': `${ins.feeders[f].name}: ${st.label}. Show on the map.` },
          stateChip(st), el('span', { class: 'now-txt' }, el('span', { class: 'now-name' }, ins.feeders[f].name), why ? el('span', { class: 'now-why' }, why) : null));
        b.addEventListener('click', () => fmap.open(f));
        return b;
      };
      const offWhy = (f) => {
        const fa = feederFacts(ins, c.matrix, t, f);
        const simple = simpleReason(fa);
        if (simple) return simple;
        const bits = whyParts(fa);
        return bits.length ? cap(bits.join(', ')) : 'Needed to meet the quota at the lowest score';
      };
      nowHost.replaceChildren(
        el('div', { class: 'now-head' }, el('div', { class: 'now-k' }, 'This hour'), el('h2', null, clockRange(ins.start_hour, t)),
          el('p', { class: off.length === ins.quotas[t] ? 'subtle' : 'subtle warn-text' }, `${off.length} of ${ins.n_feeders} areas off; the quota is ${ins.quotas[t]}.`)),
        el('h3', { class: 'now-h' }, `Off now (${off.length})`), el('div', { class: 'now-list' }, off.map((f) => item(f, STATE.off, offWhy(f)))),
        el('h3', { class: 'now-h' }, `Never cut (${pr.length})`), el('div', { class: 'now-list' }, pr.map((f) => item(f, STATE.protected, cap(PROTECTED_WHY[ins.feeders[f].kind] || ins.feeders[f].kind)))),
        el('h3', { class: 'now-h' }, `On now (${on.length})`), el('div', { class: 'now-list now-list--grid' }, on.map((f) => item(f, STATE.on, null))));
    }

    function renderTable() {
      const ins = inst(); const c = cur();
      const hours = Array.from({ length: ins.n_hours }, (_, t) => t);
      // where the plan breaks a rule: same four rules and counting as the Rule checker
      const viol = checkPlan(ins, c.matrix).violations;
      const ruleName = (id) => (RULES.find((r) => r.id === id) || { label: id }).label;
      const cellViol = (f, t) => viol.filter((v) => v.feeder === f && v.hour === t);
      const rowViol = (f) => viol.filter((v) => v.feeder === f && (v.hour === null || v.hour === undefined));
      const now = (t) => (t === S.hour ? 'is-now' : null);
      const head = el('tr', null, el('th', { scope: 'col' }, 'Area'),
        hours.map((t) => el('th', { scope: 'col', class: now(t) }, clock(ins.start_hour, t), t === S.hour ? el('span', { class: 'tt-now' }, 'now') : null)),
        el('th', { scope: 'col', class: 'num' }, 'Off tonight'));
      const body = ins.feeders.map((fd, f) => el('tr', { class: S.pick === f ? 'is-pick' : null },
        el('th', { scope: 'row' }, el('div', { class: 'tt-name' }, fd.name), el('div', { class: 'tt-kind' }, KIND_LABEL[fd.kind] || fd.kind)),
        hours.map((t) => {
          const st = stateOf(fd, f, c.matrix[t]);
          const bad = cellViol(f, t);
          const b = el('button', { type: 'button', dataset: { cell: `${f}-${t}` }, class: `tt-cell tt-cell--${st.key}${bad.length ? ' tt-cell--bad' : ''}`, title: bad.length ? `Breaks: ${bad.map((v) => ruleName(v.rule)).join(', ')}` : null,
            'aria-label': `${fd.name}, ${clockRange(ins.start_hour, t)}: ${st.label}${bad.length ? `, breaks ${bad.map((v) => ruleName(v.rule)).join(', ')}` : ''}` },
          icon(bad.length ? 'warn' : st.icon, 18), el('span', null, st.label));
          b.addEventListener('click', () => {
            S.pick = f; setHour(t, true); explainCell(f, t);
            const again = ttHost.querySelector(`[data-cell="${f}-${t}"]`); // the table was redrawn: keep focus on the same cell
            if (again) again.focus({ preventScroll: true });
          });
          return el('td', { class: now(t) }, b);
        }),
        el('td', { class: `num tt-tot${rowViol(f).length ? ' warn-text' : ''}`, title: rowViol(f).length ? `Breaks: ${rowViol(f).map((v) => ruleName(v.rule)).join(', ')}` : null },
          fd.protected ? 'never' : `${sum(hours.map((t) => c.matrix[t][f]))} h`, rowViol(f).length ? el('span', { class: 'tt-flag' }, 'breaks the daily limit') : null)));
      const foot = el('tr', { class: 'tt-foot' }, el('th', { scope: 'row' }, 'Areas off'),
        hours.map((t) => el('td', { class: now(t) }, `${sum(c.matrix[t])} (quota ${ins.quotas[t]})`)), el('td'));
      const broken = viol.length ? el('div', { class: 'tt-broken', role: 'note' }, icon('warn', 20), el('div', null,
        el('b', null, `This plan breaks ${viol.length} rule${viol.length === 1 ? '' : 's'} (red cells): `),
        viol.map((v) => `${ruleName(v.rule)}, ${ins.feeders[v.feeder] ? ins.feeders[v.feeder].name : 'all areas'}${v.hour === null || v.hour === undefined ? '' : ` at ${clock(ins.start_hour, v.hour)}`}`).join('; '), '.')) : null;
      ttHost.replaceChildren(...[el('div', { class: 'tbl-wrap' }, el('table', { class: 'tt' }, el('thead', null, head), el('tbody', null, body, foot))), broken].filter(Boolean));
    }

    function explainCell(f, t) {
      const ins = inst(); const c = cur();
      const fa = feederFacts(ins, c.matrix, t, f);
      ttWhy.replaceChildren(stateChip(stateOf(fa.fd, f, c.matrix[t])), el('div', null, el('b', null, `${fa.fd.name}, ${clockRange(ins.start_hour, t)}. `), reasonOf(fa)));
    }

    function renderMap(animate = true) {
      const c = cur(); const ins = inst();
      fmap.setStates(ins.feeders.map((fd, f) => stateOf(fd, f, c.matrix[S.hour])), { hour: S.hour, N: ins.n_feeders, bits: c.bits }, animate);
      fmap.refreshPopup();
    }

    function renderDock() {
      const ins = inst(); const c = cur();
      const off = sum(c.matrix[S.hour]);
      const quota = ins.quotas[S.hour];
      hourTitle.textContent = `Hour ${S.hour + 1} of ${ins.n_hours}`;
      hourClock.textContent = clockRange(ins.start_hour, S.hour);
      quotaEl.replaceChildren(
        el('div', { class: 'quota-main' }, el('span', { class: 'q-num' }, String(off)), ` of ${ins.n_feeders} areas off`),
        el('div', { class: off !== quota ? 'quota-sub warn-text' : 'quota-sub' }, off !== quota ? `The quota for this hour is ${quota}` : `Quota met: exactly ${quota} must be off`));
      hourSlider.set(S.hour);
    }

    function buildHourSlider() {
      const ins = inst();
      hourSlider = tickSlider({ label: 'Hour of the plan', ticks: Array.from({ length: ins.n_hours }, (_, t) => clock(ins.start_hour, t)), value: S.hour, onInput: (t) => setHour(t, true) });
      sliderHost.replaceChildren(hourSlider.root);
    }

    function renderKpis() {
      const c = cur();
      kpiHost.replaceChildren(
        kpi('Total score', fmt(c.cost, 2), 'Harm plus unevenness plus back-to-back cuts. Lower is better.'),
        kpi('Harm', fmt(c.breakdown.hardship, 1), el('span', null, 'Sum of the ', term('hardship'), ' of every cut.')),
        kpi('Unevenness', `${fmt(c.fairness, 2)} h`, 'How much total outage hours differ between areas. 0 is perfectly even.'),
        kpi('Back-to-back cuts', fmt(c.breakdown.consecutive, 0), 'Times an area is off two hours in a row.'),
        kpi('Rules check', null, c.nViolations ? `${c.nViolations} rule${c.nViolations === 1 ? '' : 's'} broken` : 'Quota, protected areas, back-to-back and daily limits all met', passChip(c.auditPassed, 'Passes', 'Fails')));
    }

    function renderDebug() {
      debugHost.replaceChildren();
      if (params.debug) debugHost.append(debugBox(cur().bits, inst().n_feeders, `Plan "${cur().label}"`));
    }

    function renderLede() {
      const ins = inst();
      const prots = ins.feeders.filter((f) => f.protected).map((f) => PROTECTED_WHY[f.kind] || f.kind);
      lede.textContent = `${SCEN[S.scenario] || S.scenario}, ${clock(ins.start_hour, 0)} to ${clock(ins.start_hour, ins.n_hours)}. Every hour some areas must lose power; FairShed picks which, spreads the hours fairly and never cuts the ${[...new Set(prots)].join(' or the ')}.`;
    }

    function setHour(t, user = false) {
      S.hour = Math.max(0, Math.min(T() - 1, t));
      if (user) stopPlay();
      renderMap(); renderDock(); renderNow(); renderTable();
      remember();
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

    function switchScenario(k) {
      stopPlay();
      S.scenario = k;
      S.pick = null;
      ttWhy.replaceChildren();
      model = buildOptions(results, k, S.pIndex);
      if (!model.inst) return;
      S.method = pickMethod();
      S.hour = Math.min(S.hour, T() - 1);
      fmap.setFeeders(inst().feeders);
      buildHourSlider();
      renderMenus();
      refreshAll(false, true);
    }

    function refreshAll(rebuild = true, full = false) {
      if (rebuild) model = buildOptions(results, S.scenario, S.pIndex);
      if (!model.opts.some((o) => o.key === S.method)) S.method = defaultMethod(model.opts);
      stopNow();
      renderLede(); renderMap(!full); renderDock(); renderShowing(); renderNow(); renderTable(); renderKpis(); renderDebug();
      if (S.pick !== null && ttWhy.firstChild) explainCell(S.pick, S.hour);
      remember();
    }

    buildHourSlider();
    renderMenus();
    refreshAll(false, true);
    requestAnimationFrame(() => fmap.relayout());
    return { destroy() { stopPlay(); fmap.destroy(); } };
  },
};
