// Replay and rules > Watch it hour by hour (was Replay). Receding-horizon re-planning from results/replay.json.
import { el, fmt, fmtSec, pad2 } from '../util.js';
import { icon, STATE, stateChip } from '../icons.js';
import { naPanel, panel, tickSlider, kpi, passChip, table } from '../components/common.js';
import { makeChart, axis, COLORS, cursorPlugin, endLabelsPlugin } from '../charts.js';
import { reduced } from '../motion.js';
import { explainPanel, pageHeader, chartBlock, rawJson } from '../explain.js';
import { term } from '../glossary.js';

const STEP_MS = 1600;
const hourLabel = (h) => `${pad2(h)}:00`;

export default {
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHeader('How does the plan change when the real shortage arrives?', 'Replay and rules: watch it hour by hour (was Replay)',
      'Every hour the planner looks three hours ahead, commits only the next hour, then plans again with what it has learned.'));
    root.append(page);
    const rep = results.ok('replay');
    if (!rep) {
      page.append(explainPanel('replay', { what: 'An evening replayed hour by hour.', how: 'Not available.', notice: null, not: 'Not available.' }), naPanel(results.get('replay')));
      return { destroy() {} };
    }
    const frames = rep.frames;
    const feeders = rep.feeders;
    const s = rep.summary;
    const nq = frames.filter((f) => /quantum/i.test(f.solver_used)).length;
    const nAudit = frames.filter((f) => f.audit_passed).length;
    const fc = frames.filter((f) => f.forecast_mw !== null);
    const mae = fc.length ? fc.reduce((a, f) => a + Math.abs(f.shortfall_mw - f.forecast_mw), 0) / fc.length : null;

    page.append(explainPanel('replay', {
      what: [el('span', null, 'One synthetic afternoon and evening, replayed with ', term('horizon', 'receding-horizon'), ' re-planning. Each hour is one frame.')],
      how: ['Press Play or drag the slider. The feeder cards show who is off in that hour; outlined cards changed since the hour before.',
        el('span', null, el('b', null, 'Solver chip: '), 'which method chose that hour\'s plan. "Quantum" means the simulated circuit; a fallback to the exact solver would say so.'),
        el('span', null, el('b', null, '"Matches best plan" chip: '), 'the chosen plan scores as well as the exact best plan for that window.')],
      notice: [`${nq} of ${frames.length} hours were planned by the quantum circuit (simulated).`, `${s.matches_exact_count} of ${s.n_frames} hours matched the exact best plan; the other ${s.n_frames - s.matches_exact_count} were valid but scored worse.`,
        `${nAudit} of ${frames.length} committed plans passed every rule.`],
      not: ['A real day: feeders, demand and shortfall are synthetic (the weather input is a real snapshot).', 'Speed: a normal computer finds each window\'s best plan directly.'],
    }));

    page.append(el('div', { class: 'kpis' },
      kpi('Hours replayed', String(s.n_frames), `${hourLabel(frames[0].hour)} to ${hourLabel(frames[frames.length - 1].hour)}`),
      kpi('Matched the best plan', `${s.matches_exact_count} of ${s.n_frames}`, 'Hours where the chosen plan scored as well as the exact best plan'),
      kpi('Plans that passed every rule', `${nAudit} of ${frames.length}`, 'Quota, protected feeders, back-to-back and daily limits'),
      kpi('Unevenness at the end', `${fmt(s.fairness_spread_hours, 1)} h`, 'Most outage hours minus fewest, among feeders that can be cut')));

    const S = { i: 0, playing: false, timer: null };
    const head = el('div', { class: 'row' });
    const feederBox = el('div', { class: 'feeder-row' });
    const facts = el('div', { class: 'kpis' });
    const ledgerBox = el('div', { class: 'stack-s' });
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary', 'aria-label': 'Play the hours' }, icon('play', 22), el('span', null, 'Play'));
    const slider = tickSlider({ label: 'Hour of the replay', ticks: frames.map((f) => hourLabel(f.hour)), value: 0, onInput: (i) => { stop(); show(i); } });

    const canvas = el('canvas', { role: 'img', 'aria-label': `Real and forecast shortage per hour: ${frames.map((f) => `${hourLabel(f.hour)} real ${fmt(f.shortfall_mw, 1)} MW`).join(', ')}` });
    const takeaway = mae !== null
      ? `The forecast missed the real shortage by ${fmt(mae, 1)} MW per hour on average, and the planner still matched the best plan in ${s.matches_exact_count} of ${s.n_frames} hours.`
      : `The planner matched the best plan in ${s.matches_exact_count} of ${s.n_frames} hours.`;

    function show(i) {
      S.i = i;
      slider.set(i);
      const f = frames[i];
      const changed = new Set(f.changed_from_previous);
      head.replaceChildren(
        el('h3', { class: 'sec-h' }, `Hour ${f.step + 1} of ${frames.length}: ${hourLabel(f.hour)}`),
        passChip(f.matches_exact, 'Matches best plan', 'Valid, but not the best plan'),
        passChip(f.audit_passed, 'Passes every rule', 'Breaks a rule'),
        el('span', { class: `chip ${/quantum/i.test(f.solver_used) ? 'chip--quantum' : 'chip--classical'}`, title: f.solver_used }, icon(/quantum/i.test(f.solver_used) ? 'atom' : 'chip', 16),
          /quantum/i.test(f.solver_used) ? 'Planned by: quantum circuit (simulated)' : `Planned by: ${f.solver_used}`),
        params.expert ? el('span', { class: 'subtle mono' }, f.solver_used) : null);
      feederBox.replaceChildren(...feeders.map((fd, k) => {
        const st = fd.protected ? STATE.protected : (f.plan[k] ? STATE.off : STATE.on);
        return el('div', { class: `fr-cell${changed.has(k) ? ' fr-changed' : ''}` },
          el('div', { class: 'fr-name' }, fd.name), stateChip(st), changed.has(k) ? el('div', { class: 'subtle' }, 'Changed since the hour before') : null,
          params.debug ? el('div', { class: 'mono subtle' }, `bit ${f.plan[k]}`) : null);
      }));
      facts.replaceChildren(
        kpi('Real shortage', `${fmt(f.shortfall_mw, 1)} MW`, f.forecast_mw === null ? 'no forecast for this hour' : `forecast was ${fmt(f.forecast_mw, 1)} MW`),
        kpi('Feeders off', `${f.quota}`, `Quotas for the 3-hour window: ${f.window_quotas.join(', ')}`),
        kpi('Window score', fmt(f.cost, 2), `Best possible: ${fmt(f.exact_cost, 2)}. Lower is better.`),
        kpi('Time to plan', fmtSec(f.runtime_s), f.warm_started ? el('span', null, 'Started from the previous hour\'s settings (', term('warm', 'warm start'), ')') : 'Started fresh'));
      const maxL = Math.max(1, ...frames[frames.length - 1].ledger_after);
      ledgerBox.replaceChildren(...feeders.map((fd, k) => el('div', { class: 'mini-row' },
        el('span', { class: 'mini-name' }, fd.name),
        el('span', { class: 'mini-bar' }, el('i', { style: `width:${(100 * f.ledger_after[k]) / maxL}%;background:${fd.protected ? COLORS.protected : COLORS.off}` })),
        el('span', { class: 'mini-val' }, fd.protected ? 'protected' : `${fmt(f.ledger_after[k], 0)} h`))));
      chart.$cursorIndex = i;
      chart.update('none');
    }
    function stop() {
      S.playing = false;
      if (S.timer) clearInterval(S.timer);
      S.timer = null;
      playBtn.replaceChildren(icon('play', 22), el('span', null, 'Play'));
      playBtn.setAttribute('aria-label', 'Play the hours');
    }
    playBtn.addEventListener('click', () => {
      if (S.playing) { stop(); return; }
      S.playing = true;
      playBtn.replaceChildren(icon('pause', 22), el('span', null, 'Pause'));
      playBtn.setAttribute('aria-label', 'Pause');
      if (S.i >= frames.length - 1) show(0);
      S.timer = setInterval(() => { if (S.i >= frames.length - 1) stop(); else show(S.i + 1); }, reduced() ? STEP_MS * 1.5 : STEP_MS);
    });

    page.append(panel('Hour by hour', 'Use Play or the slider. Outlined feeders changed state since the hour before.',
      el('div', { class: 'stack', 'data-tour': 'replay' }, el('div', { class: 'row' }, playBtn, el('div', { style: 'flex:1;min-width:240px' }, slider.root)), head, feederBox, facts)));
    page.append(panel(null, null, chartBlock({ takeaway, chart: el('div', { class: 'chart-box' }, canvas),
      howto: 'Time runs left to right. The blue line is the real shortage, the orange dashed line is the classical forecast made in advance. The vertical line marks the hour you are looking at.',
      plain: ['MW is megawatts: one feeder carries a fixed share, so more MW means more feeders off.', 'The first hour of each plan uses the real shortage; later hours use the forecast.'] })));
    page.append(panel('Outage hours so far', 'Hours each feeder has been off since the replay started. Long bars mean more outage hours.', ledgerBox));

    const chart = makeChart(canvas, {
      type: 'line',
      data: { labels: frames.map((f) => hourLabel(f.hour)), datasets: [
        { label: 'Real', data: frames.map((f) => f.shortfall_mw), borderColor: COLORS.quantum, backgroundColor: COLORS.quantum, pointRadius: 4, borderWidth: 3, tension: 0 },
        { label: 'Forecast', data: frames.map((f) => f.forecast_mw), borderColor: COLORS.classical, backgroundColor: COLORS.classical, borderDash: [8, 5], pointRadius: 3, borderWidth: 3, tension: 0 },
      ] },
      options: { layout: { padding: { right: 80 } }, scales: { x: axis({ title: { display: true, text: 'Hour of the day' } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Shortage (MW)' } }) } },
      plugins: [cursorPlugin, endLabelsPlugin],
    });

    const solverCounts = {};
    for (const f of frames) solverCounts[f.solver_used] = (solverCounts[f.solver_used] || 0) + 1;
    page.append(el('div', { class: 'expert-only stack' },
      panel('Solvers used (Expert)', null, table([{ label: 'Solver', render: (r) => r[0] }, { label: 'Hours', num: true, render: (r) => String(r[1]) }], Object.entries(solverCounts))),
      el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, rep.notes)),
      rawJson('results/replay.json', rep)));
    show(0);
    return { destroy() { stop(); } };
  },
};
