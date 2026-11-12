// Schedule: the working example, built for the people who live with a load-shedding schedule.
// A full-screen map of tonight's areas. Floating over it: a title card (the current choices as pills,
// the rule check, the key and "Find your area"), a player bar (Play, hour slider, quota) and three
// slide-in panels: Plan settings (left), This hour (right) and Tonight's timetable (a sheet above the
// player). The map keeps the areas clear of whatever is open. Every number comes from the results
// files; nothing is re-optimised in the browser.
import { el, fmt, fmtTrim, clock, clockRange, sum, KIND_LABEL, PROTECTED_WHY } from '../util.js';
import { icon, STATE, stateOf, stateChip } from '../icons.js';
import { createFeederMap } from '../components/map.js';
import { naPanel, segmented, tickSlider, kpi, passChip } from '../components/common.js';
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
const METHOD_SHORT = { quantum: 'FairShed', exact: 'Exact search', round_robin: 'Round-robin', random_valid: 'Random plan' };
const methodLabel = (o) => METHOD_LABEL[o.key] || `${o.label} (${o.kind})`;
const STEP_MS = 1800;
const NARROW_PX = 900;   // below this map width the card spans the top and panels cover the map
const COMPACT_PX = 1100; // below this, one side panel at a time so the map keeps room
/** The reader's choices and open panels, kept for the session so a re-render (theme switch, leaving and coming back) does not reset them. */
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

/** Hours (indices) grouped into runs: [0, 1, 3] -> [[0, 1], [3]]. */
function runs(hours) {
  const out = [];
  for (const t of hours) { const last = out[out.length - 1]; if (last && last[last.length - 1] === t - 1) last.push(t); else out.push([t]); }
  return out;
}

export default {
  async mount({ root, results, params }) {
    const scenarios = ['base', 'heatwave_cap'].filter((k) => results.ok('plans/' + k) || (k === 'base' && results.ok('instance')));
    let sf = null; // the map area; its width (not the window's) decides the layout, so the Inner working drawer is accounted for
    const width = () => (sf && sf.clientWidth) || window.innerWidth;
    const narrow = () => width() < NARROW_PX;
    const compact = () => width() < COMPACT_PX;
    // method: the plan on screen. want: the method the reader picked; kept when the evening changes and
    // used again as soon as it is available (the heatwave has no quantum plan).
    const S = { scenario: 'base', method: null, want: 'quantum', pIndex: 0, stop: 'bal', hour: 0, playing: false, pick: null, mine: null,
      ui: { settings: false, hour: null, sheet: false } }; // hour: null = decide from the width once the map is on screen
    const par0 = results.ok('pareto');
    if (par0) S.pIndex = par0.default_index;
    if (memory && scenarios.includes(memory.scenario)) {
      Object.assign(S, { scenario: memory.scenario, want: memory.want, stop: memory.stop, hour: memory.hour, mine: memory.mine, ui: { ...memory.ui } });
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
    if (S.mine !== null && !(S.mine >= 0 && S.mine < model.inst.n_feeders)) S.mine = null;
    const remember = () => { memory = { scenario: S.scenario, want: S.want, pIndex: S.pIndex, stop: S.stop, hour: S.hour, mine: S.mine, ui: { ...S.ui } }; };
    const cur = () => model.opts.find((o) => o.key === S.method) || model.opts[0];
    const inst = () => model.inst;
    const T = () => inst().n_hours;

    // ---------- DOM ----------
    const mapHost = el('div', { class: 'plan-map', role: 'application', 'aria-label': 'Map of areas. Select an area to see why it is on or off.' });
    const mapWrap = el('div', { class: 'plan-map-wrap' }, mapHost);

    // title card
    const pill = (k) => el('button', { type: 'button', class: 'sf-pill', 'aria-controls': 'sf-settings', 'aria-expanded': 'false' },
      el('span', { class: 'sf-pill-k' }, k), el('span', { class: 'sf-pill-v' }), icon('arrowr', 18));
    const pills = { ev: pill('Evening'), pr: pill('Priority'), me: pill('Plan made by') };
    const lede = el('p', { class: 'sf-lede' });
    const facts = el('div', { class: 'sf-facts', 'aria-live': 'polite' });
    const findSel = el('select', { class: 'select', id: 'sf-find' });
    const mineHost = el('div', { class: 'sf-mine', 'aria-live': 'polite' });
    const titleCard = el('section', { class: 'sf-card sf-title', 'aria-label': 'Tonight' },
      el('h1', null, 'Who loses power tonight?'), lede,
      el('div', { class: 'sf-pills' }, pills.ev, pills.pr, pills.me),
      facts,
      el('div', { class: 'sf-find' }, el('label', { class: 'ctl-label', for: 'sf-find' }, 'Find your area'), el('div', { class: 'select-wrap' }, findSel)),
      mineHost,
      el('div', { class: 'sf-key', 'aria-label': 'Key' }, stateChip(STATE.on), stateChip(STATE.off), stateChip(STATE.protected)));

    // slide-in panels
    const slide = (cls, id, title, ...body) => {
      const close = el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': `Close ${title}` }, icon('close', 20));
      const node = el(cls === 'sf-sheet' ? 'section' : 'aside', { class: cls, id, 'aria-label': title, 'data-open': 'false' },
        el('div', { class: 'sf-panel-h' }, el('h2', null, title), close), el('div', { class: 'sf-panel-b' }, ...body));
      return { node, close };
    };
    const menuEvening = el('div', { class: 'ctl' });
    const menuPriority = el('div', { class: 'ctl' });
    const menuMethod = el('div', { class: 'ctl' });
    const showing = el('div', { class: 'showing', 'aria-live': 'polite' });
    const kpiHost = el('div', { class: 'kpis' });
    const settings = slide('sf-panel sf-panel--left', 'sf-settings', 'Plan settings',
      menuEvening, menuPriority, menuMethod, showing,
      el('div', null, el('h3', { class: 'sf-h3' }, 'How this plan scores'), el('p', { class: 'ctl-help' }, 'The same score is used for every plan. Lower is better.')), kpiHost,
      el('p', { class: 'ctl-help' }, 'Every plan was computed in advance; nothing is re-optimised in your browser.'));
    const nowHost = el('div', { class: 'now' });
    const hourPanel = slide('sf-panel sf-panel--right', 'sf-hour', 'This hour', nowHost);
    const ttHost = el('div');
    const ttWhy = el('div', { class: 'tt-why', 'aria-live': 'polite' });
    const sheet = slide('sf-sheet', 'sf-sheet', 'Tonight\'s timetable', el('p', { class: 'ctl-help' }, 'Each row is one area. Click a cell to jump to that hour and see why.'), ttHost, ttWhy);

    // player bar
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary play-btn', 'aria-label': 'Play the hours' }, icon('play', 22), el('span', null, 'Play'));
    const hourTitle = el('div', { class: 'hour-title' });
    const hourClock = el('div', { class: 'hour-clock' });
    let hourSlider = null;
    const sliderHost = el('div', { class: 'hour-slider' });
    const quotaEl = el('div', { class: 'quota' });
    const toggle = (ic, label, controls) => el('button', { type: 'button', class: 'btn sf-toggle', 'aria-controls': controls, 'aria-expanded': 'false' }, icon(ic, 20), el('span', { class: 'btn-label' }, label));
    const ttBtn = toggle('audit', 'Timetable', 'sf-sheet');
    const hourBtn = toggle('info', 'This hour', 'sf-hour');
    const dock = el('div', { class: 'dock sf-dock', role: 'group', 'aria-label': 'Hour control' }, el('div', { class: 'sf-dock-in' },
      playBtn, el('div', { class: 'sf-dock-mid' }, el('div', { class: 'dock-top' }, hourTitle, hourClock), sliderHost), quotaEl,
      el('div', { class: 'sf-dock-btns' }, ttBtn, hourBtn)));
    const debugHost = el('div', { class: 'plan-debug sf-debug' });
    const fairExpert = el('div', { class: 'expert-only stack-s' });

    sf = el('div', { class: 'sf' }, mapWrap, titleCard, settings.node, hourPanel.node, sheet.node, dock, debugHost);
    const ins0 = model.inst;
    const prot = ins0.feeders.filter((f) => f.protected);
    root.append(sf,
      explainPanel('schedule', {
        say: "Tonight's load-shedding schedule on a full-screen map: which neighbourhood power lines are off in each hour, and the plain reason for every choice.",
        made: [{ kind: 'classical', text: 'A ridge-regression forecast of the shortage sets how many areas must be off each hour (the quota).' },
          { kind: 'classical', text: 'Hospitals, water pumps and telecom towers are taken out of the choice: they get no switch.' },
          { kind: 'quantum', text: 'A quantum circuit (Dicke start, Grover mixer) on the Qiskit simulator samples valid plans; the best valid one is kept.' },
          { kind: 'classical', text: 'The plan is audited against the rules and compared with the exact best plan. Nothing is re-optimised in your browser.' }],
        qa: [{ q: 'What does Priority change?', a: () => ['It moves along a ', term('pareto', 'trade-off'), ' between total harm and an even spread of outage hours. Each choice is a plan computed in advance by the same circuit with a different fairness weight.'] },
          { q: 'Why is an area off or on?', a: 'Click it on the map, or open "This hour" for a one-line reason for every area that is off: its harm this hour and its outage hours so far against the average, and whether it would be a back-to-back cut.' },
          { q: 'How does a resident use it?', a: 'Pick your area under "Find your area". The map flies to it, rings it, and the card shows when your area is off tonight.' },
          { q: 'What does "Plan made by" do?', a: 'It shows the plan the exact search, round-robin or a random draw would choose for the same evening, so you can see what FairShed changed. Try Heatwave with round-robin and open the timetable: the red cells are the rules it breaks.' }],
        what: [el('span', null, 'A full-screen map of the ', term('feeder', 'feeders'), ' (neighbourhood power lines, called areas here) and which are off in each hour of this evening\'s shortage.')],
        how: ['The pills on the card open Plan settings: the evening, the priority and which method made the plan.',
          'Press Play or drag the hour slider; the map and "This hour" follow.',
          '"Timetable" slides up the whole evening at once: amber stripes are Off, teal is On, blue with a shield is Protected.',
          'Esc closes the panel on top.'],
        notice: [`${ins0.n_feeders} areas over ${ins0.n_hours} hours; ${prot.length} are protected (${prot.map((f) => f.name).join(', ')}).`,
          `Quotas per hour: ${ins0.quotas.join(', ')} areas off.`],
        not: ['Real feeders or real outages: everything is synthetic.', 'Live re-planning: the plans shown were computed in advance.'],
      }),
      fairExpert);

    // ---------- panel layout: what is open decides where the map fits the areas ----------
    function measure() {
      const wide = !narrow();
      sf.style.setProperty('--lw', wide && S.ui.settings ? `${settings.node.offsetWidth + 16}px` : '0px');
      sf.style.setProperty('--rw', wide && S.ui.hour ? `${hourPanel.node.offsetWidth + 16}px` : '0px');
      sf.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    }
    /** Pixels the map must keep clear on each side, from the panels' layout boxes (not their slide animation). */
    function mapPadding() {
      const W = sf.clientWidth, H = sf.clientHeight;
      if (!W || !H) return { tl: [40, 40], br: [40, 40] };
      const wide = !narrow();
      let left = 24, top = 24, right = 24;
      let bottom = H - dock.offsetTop + 16;
      if (S.ui.sheet) bottom = H - sheet.node.offsetTop + 16;
      if (wide) left = titleCard.offsetLeft + titleCard.offsetWidth + 16; else top = titleCard.offsetTop + titleCard.offsetHeight + 16;
      if (wide && S.ui.settings) left = Math.max(left, settings.node.offsetLeft + settings.node.offsetWidth + 16);
      if (wide && S.ui.hour) right = W - hourPanel.node.offsetLeft + 16;
      let tl = [left + 70, top + 40], br = [right + 90, bottom + 40]; // room for the labels beside each dot
      const fitIn = (a, b, size) => { const room = size - 200; if (a + b > room && room > 0) { const k = room / (a + b); return [a * k, b * k]; } return [a, b]; };
      [tl[0], br[0]] = fitIn(tl[0], br[0], W);
      [tl[1], br[1]] = fitIn(tl[1], br[1], H);
      return { tl, br };
    }

    const panels = { settings: { p: settings, btns: [pills.ev, pills.pr, pills.me] }, hour: { p: hourPanel, btns: [hourBtn] }, sheet: { p: sheet, btns: [ttBtn] } };
    function paintPanel(name) {
      const { p, btns } = panels[name];
      const open = !!S.ui[name];
      p.node.dataset.open = String(open);
      p.node.inert = !open;
      btns.forEach((b) => b.setAttribute('aria-expanded', String(open)));
    }
    let autoClosedHour = false; // "This hour" was closed for lack of room, not by the reader
    function setPanel(name, open, focusEl) {
      if (name === 'hour') autoClosedHour = false;
      if (open && compact()) for (const k of ['settings', 'hour']) if (k !== name && S.ui[k]) { S.ui[k] = false; paintPanel(k); }
      S.ui[name] = open;
      paintPanel(name);
      const { p, btns } = panels[name];
      if (open && focusEl) setTimeout(() => focusEl.focus({ preventScroll: true }), 60);
      if (!open && p.node.contains(document.activeElement)) btns[0].focus({ preventScroll: true });
      settle();
      remember();
    }
    /** Panels slide and the player bar resizes for about 0.3 s; once they rest, glide the map to fit and re-place the labels. */
    let settleTimer = null;
    function settle() {
      measure();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { measure(); fmap.refit(); setTimeout(() => fmap.relayout(), 500); }, 320);
    }
    settings.close.addEventListener('click', () => setPanel('settings', false));
    hourPanel.close.addEventListener('click', () => setPanel('hour', false));
    sheet.close.addEventListener('click', () => setPanel('sheet', false));
    hourBtn.addEventListener('click', () => setPanel('hour', !S.ui.hour, nowHost.querySelector('h2')));
    ttBtn.addEventListener('click', () => setPanel('sheet', !S.ui.sheet, sheet.close));
    const onKey = (e) => {
      if (e.defaultPrevented || e.key !== 'Escape') return; // a glossary card, the tour or the Inner working panel went first
      const top = ['sheet', 'settings', 'hour'].find((k) => S.ui[k]);
      if (top) { e.preventDefault(); setPanel(top, false); }
    };
    document.addEventListener('keydown', onKey);
    let wasCompact = null;
    const onResize = () => {
      const c = compact();
      if (wasCompact !== null && c !== wasCompact) {
        if (c && S.ui.hour) { S.ui.hour = false; autoClosedHour = true; paintPanel('hour'); } // no room: step aside
        else if (!c && autoClosedHour) { S.ui.hour = true; autoClosedHour = false; paintPanel('hour'); } // room again: come back
      }
      wasCompact = c;
      settle();
    };
    window.addEventListener('resize', onResize);

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

    const fmap = createFeederMap(mapHost, { feeders: inst().feeders, debug: params.debug, tiles: params.tiles, buildPopup,
      padding: mapPadding, zoomPosition: 'bottomright', tileOpacity: 0.62,
      obstacles: () => [titleCard, dock, S.ui.settings && settings.node, S.ui.hour && hourPanel.node, S.ui.sheet && sheet.node,
        mapHost.querySelector('.leaflet-bottom.leaflet-right')] });

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

    // the pills open Plan settings at the matching control
    const checkedIn = (seg) => (seg ? seg.root.querySelector('[aria-checked="true"]') || seg.root.querySelector('button:not(:disabled)') : null);
    pills.ev.addEventListener('click', () => setPanel('settings', true, checkedIn(evSeg) || sel));
    pills.pr.addEventListener('click', () => setPanel('settings', true, checkedIn(prSeg) || sel));
    pills.me.addEventListener('click', () => setPanel('settings', true, sel));

    let findFor = null;
    findSel.addEventListener('change', () => {
      S.mine = findSel.value === '' ? null : Number(findSel.value);
      fmap.focus(S.mine);
      if (S.mine === null) { fmap.closePopup(); fmap.refit(true); } else fmap.flyTo(S.mine, { open: true });
      renderMine(); remember();
      if (S.mine !== null) requestAnimationFrame(() => mineHost.scrollIntoView({ block: 'nearest' }));
    });

    /** The priority stop that matches the plan on screen (null when none does), and its label. */
    function stopNow() {
      const par = paretoApplies(results, S.scenario);
      const st = par ? (stops.find((s) => s.i === S.pIndex && s.key === S.stop) || stops.find((s) => s.i === S.pIndex)) : null;
      S.stopLabel = par ? (st ? st.label : `Fairness weight ${fmtTrim(par.points[S.pIndex].fairness_weight, 3)}`) : null;
      return { par, curStop: st };
    }

    function renderMenus() {
      const ins = inst();
      if (evSeg) evSeg.set(S.scenario); else evStatic.textContent = SCEN[S.scenario] || S.scenario;
      evHelp.textContent = `${clock(ins.start_hour, 0)} to ${clock(ins.start_hour, ins.n_hours)}, ${ins.quotas.join(', ')} areas off by hour.`;
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
      if (selFor !== S.scenario) {
        sel.replaceChildren(...model.opts.map((o) => el('option', { value: o.key }, methodLabel(o))));
        selFor = S.scenario;
      }
      sel.value = S.method;
      mHelp.textContent = S.method === 'quantum' ? 'Or pick a normal method to compare.' : 'A normal method, shown for comparison.';
      if (findFor !== S.scenario) {
        findSel.replaceChildren(el('option', { value: '' }, 'All areas'), ...ins.feeders.map((fd, f) => el('option', { value: String(f) }, fd.name)));
        findFor = S.scenario;
      }
      findSel.value = S.mine === null ? '' : String(S.mine);
      // pills: the current choices at a glance
      pills.ev.querySelector('.sf-pill-v').textContent = SCEN[S.scenario] || S.scenario;
      pills.pr.querySelector('.sf-pill-v').textContent = S.method === 'quantum' && S.stopLabel ? S.stopLabel : 'Not used';
      pills.me.querySelector('.sf-pill-v').textContent = METHOD_SHORT[S.method] || cur().label;
    }

    // ---------- views ----------
    function planName(c) {
      if (c.key === 'quantum') return `${S.stopLabel || 'Selected'} plan, made by FairShed's quantum planner (simulated)`;
      return `Plan made by ${methodLabel(c)}`;
    }

    function renderShowing() {
      const c = cur();
      const v = versusRoundRobin(model.opts, c);
      const rule = () => passChip(c.auditPassed, 'Follows every rule', `${c.nViolations} rule${c.nViolations === 1 ? '' : 's'} broken`);
      const turns = () => (v && !v.isRR ? el('span', { class: 'chip chip--neutral' }, Math.abs(v.pct) < 0.05 ? 'Same score as taking turns'
        : `${fmt(Math.abs(v.pct), Math.abs(v.pct) < 1 ? 1 : 0)}% ${v.pct > 0 ? 'better' : 'worse'} than taking turns`) : null);
      const list = [rule(), turns()];
      if (c.key === 'quantum' && c.point) {
        list.push(el('span', { class: 'chip chip--neutral' }, c.point.matches_exact ? 'Same score as the exact best plan'
          : `Exact best plan scores ${fmt(c.point.exact_cost, 2)}; this one ${fmt(c.point.cost, 2)}`));
      }
      showing.replaceChildren(el('div', { class: 'showing-t' }, el('span', { class: 'showing-k' }, 'Showing'), el('span', null, planName(c))), el('div', { class: 'showing-f' }, list.filter(Boolean)));
      facts.replaceChildren(...[rule(), turns()].filter(Boolean));
    }

    function renderNow() {
      const ins = inst(); const c = cur(); const t = S.hour;
      const row = c.matrix[t];
      const off = [], on = [], pr = [];
      ins.feeders.forEach((fd, f) => (fd.protected ? pr : row[f] ? off : on).push(f));
      const item = (f, st, why) => {
        const b = el('button', { type: 'button', class: `now-item now-item--${st.key}${f === S.mine ? ' is-mine' : ''}`, 'aria-label': `${ins.feeders[f].name}: ${st.label}. Show on the map.` },
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
        el('div', { class: 'now-head' }, el('h2', { tabindex: '-1' }, clockRange(ins.start_hour, t)),
          el('p', { class: off.length === ins.quotas[t] ? 'subtle' : 'subtle warn-text' }, `${off.length} of ${ins.n_feeders} areas off; the quota is ${ins.quotas[t]}.`)),
        el('h3', { class: 'now-h' }, `Off now (${off.length})`), el('div', { class: 'now-list' }, off.map((f) => item(f, STATE.off, offWhy(f)))),
        el('h3', { class: 'now-h' }, `Never cut (${pr.length})`), el('div', { class: 'now-list' }, pr.map((f) => item(f, STATE.protected, cap(PROTECTED_WHY[ins.feeders[f].kind] || ins.feeders[f].kind)))),
        el('h3', { class: 'now-h' }, `On now (${on.length})`), el('div', { class: 'now-list now-list--grid' }, on.map((f) => item(f, STATE.on, null))));
    }

    /** "Find your area": the reader's own area for the whole evening. */
    function renderMine() {
      if (S.mine === null) { mineHost.replaceChildren(); return; }
      const ins = inst(); const c = cur(); const f = S.mine; const fd = ins.feeders[f];
      const hours = Array.from({ length: ins.n_hours }, (_, t) => t);
      const offH = hours.filter((t) => c.matrix[t][f] === 1);
      const said = fd.protected ? `Never cut: protected (${PROTECTED_WHY[fd.kind] || fd.kind}).`
        : offH.length ? `Off ${runs(offH).map((r) => `${clock(ins.start_hour, r[0])} to ${clock(ins.start_hour, r[r.length - 1] + 1)}`).join(' and ')} (${offH.length} hour${offH.length === 1 ? '' : 's'}).`
          : 'On all evening.';
      const strip = el('div', { class: 'sf-mine-strip' }, hours.map((t) => {
        const st = stateOf(fd, f, c.matrix[t]);
        const b = el('button', { type: 'button', class: `tt-cell tt-cell--${st.key}${t === S.hour ? ' is-now' : ''}`, 'aria-label': `${fd.name}, ${clockRange(ins.start_hour, t)}: ${st.label}` },
          el('span', { class: 'sf-mine-t' }, clock(ins.start_hour, t)), icon(st.icon, 16), el('span', null, st.label));
        b.addEventListener('click', () => { setHour(t, true); fmap.open(f); });
        return b;
      }));
      mineHost.replaceChildren(el('p', { class: 'sf-mine-say' }, el('b', null, `${fd.name}: `), said), strip);
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
      const body = ins.feeders.map((fd, f) => el('tr', { class: S.pick === f || S.mine === f ? 'is-pick' : null },
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
        kpi('Total score', fmt(c.cost, 2), 'Harm plus unevenness plus back-to-back cuts.'),
        kpi('Harm', fmt(c.breakdown.hardship, 1), el('span', null, 'Sum of the ', term('hardship'), ' of every cut.')),
        kpi('Unevenness', `${fmt(c.fairness, 2)} h`, 'How much outage hours differ between areas.'),
        kpi('Back-to-back cuts', fmt(c.breakdown.consecutive, 0), 'Times an area is off two hours in a row.'),
        kpi('Rules check', null, c.nViolations ? `${c.nViolations} rule${c.nViolations === 1 ? '' : 's'} broken` : 'Quota, protected areas, back-to-back and daily limits all met', passChip(c.auditPassed, 'Passes', 'Fails')));
    }

    function renderDebug() {
      debugHost.replaceChildren();
      if (params.debug) debugHost.append(debugBox(cur().bits, inst().n_feeders, `Plan "${cur().label}"`));
    }

    function renderLede() {
      const ins = inst();
      lede.textContent = `${clock(ins.start_hour, 0)} to ${clock(ins.start_hour, ins.n_hours)}. FairShed picks who loses power each hour, fairly, and never cuts hospitals or water pumps.`;
    }

    function setHour(t, user = false) {
      S.hour = Math.max(0, Math.min(T() - 1, t));
      if (user) stopPlay();
      renderMap(); renderDock(); renderNow(); renderTable(); renderMine();
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
      if (S.mine !== null && S.mine >= inst().n_feeders) S.mine = null;
      fmap.setFeeders(inst().feeders);
      fmap.focus(S.mine);
      buildHourSlider();
      renderMenus();
      refreshAll(false, true);
    }

    function refreshAll(rebuild = true, full = false) {
      if (rebuild) model = buildOptions(results, S.scenario, S.pIndex);
      if (!model.opts.some((o) => o.key === S.method)) S.method = defaultMethod(model.opts);
      stopNow();
      renderLede(); renderMap(!full); renderDock(); renderShowing(); renderNow(); renderTable(); renderKpis(); renderMine(); renderDebug();
      if (S.pick !== null && ttWhy.firstChild) explainCell(S.pick, S.hour);
      remember();
    }

    buildHourSlider();
    renderMenus();
    refreshAll(false, true);
    if (S.ui.hour === null) S.ui.hour = width() >= COMPACT_PX;
    wasCompact = compact();
    ['settings', 'hour', 'sheet'].forEach(paintPanel);
    fmap.focus(S.mine);
    measure();
    requestAnimationFrame(() => { measure(); fmap.refit(); fmap.relayout(); });
    return { destroy() { stopPlay(); clearTimeout(settleTimer); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); fmap.destroy(); } };
  },
};
