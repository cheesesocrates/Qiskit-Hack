// Screen 4: Replay. Receding-horizon re-planning, one committed hour per frame, from results/replay.json.
import { el, fmt, fmtSec, pad2 } from '../util.js';
import { icon, STATE, stateChip } from '../icons.js';
import { naPanel, panel, pageHead, tickSlider, kpi, passChip, table } from '../components/common.js';
import { makeChart, axis, COLORS, cursorPlugin } from '../charts.js';
import { reduced } from '../motion.js';

const STEP_MS = 1600;
const hourLabel = (h) => `${pad2(h)}:00`;

export default {
  id: 'replay',
  title: 'Replay',
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHead('Replay', 'Receding horizon: every hour the planner solves the next three hours, commits only the first, and re-plans when the real shortfall is known.'));
    root.append(page);
    const rep = results.ok('replay');
    if (!rep) { page.append(naPanel(results.get('replay'))); return { destroy() {} }; }

    const frames = rep.frames;
    const feeders = rep.feeders;
    const s = rep.summary;
    const solverCounts = {};
    for (const f of frames) solverCounts[f.solver_used] = (solverCounts[f.solver_used] || 0) + 1;
    const quantumFrames = frames.filter((f) => /quantum/i.test(f.solver_used)).length;

    page.append(
      el('div', { class: 'callout' }, `Synthetic feeders and demand. Solver requested: ${rep.solver_requested}. ${quantumFrames} of ${frames.length} frames were solved by the quantum solver on the simulator; any fallback to exact is shown per frame.`),
      el('div', { class: 'kpis' },
        kpi('Frames', String(s.n_frames), `${hourLabel(frames[0].hour)} to ${hourLabel(frames[frames.length - 1].hour)}`),
        kpi('Matched the exact optimum', `${s.matches_exact_count} of ${s.n_frames}`, 'Committed-hour window cost equals brute force'),
        kpi('Total hardship', fmt(s.total_hardship, 1), 'Sum over committed hours'),
        kpi('Fairness spread', `${fmt(s.fairness_spread_hours, 1)} h`, 'Max minus min ledger hours, non-protected feeders')));

    // ---------- frame view ----------
    const S = { i: 0, playing: false, timer: null };
    const head = el('div', { class: 'row' });
    const feederBox = el('div', { class: 'feeder-row' });
    const facts = el('div', { class: 'kpis' });
    const ledgerBox = el('div', { class: 'stack' });
    const playBtn = el('button', { type: 'button', class: 'btn btn--primary btn--icon', 'aria-label': 'Play' }, icon('play', 20));
    const slider = tickSlider({ label: 'Frame', ticks: frames.map((f) => hourLabel(f.hour)), value: 0, onInput: (i) => { stop(); show(i); } });

    const canvas = el('canvas', { role: 'img', 'aria-label': 'Actual and forecast shortfall per replay hour' });
    const chart = makeChart(canvas, {
      type: 'line',
      data: {
        labels: frames.map((f) => hourLabel(f.hour)),
        datasets: [
          { label: 'Actual shortfall (MW)', data: frames.map((f) => f.shortfall_mw), borderColor: COLORS.accent, backgroundColor: COLORS.accent, pointRadius: 3, tension: 0 },
          { label: 'Forecast shortfall (MW)', data: frames.map((f) => f.forecast_mw), borderColor: COLORS.seriesB, backgroundColor: COLORS.seriesB, borderDash: [6, 4], pointRadius: 2, tension: 0 },
        ],
      },
      options: { plugins: { legend: { display: true, labels: { color: COLORS.dim, boxWidth: 14 } } }, scales: { x: axis(), y: axis({ beginAtZero: true, title: { display: true, text: 'MW', color: COLORS.muted } }) } },
      plugins: [cursorPlugin],
    });

    function show(i) {
      S.i = i;
      slider.set(i);
      const f = frames[i];
      const changed = new Set(f.changed_from_previous);
      head.replaceChildren(
        el('h3', { class: 'sec-h' }, `Frame ${f.step + 1} of ${frames.length}: ${hourLabel(f.hour)}`),
        passChip(f.matches_exact, 'Matches exact', 'Worse than exact'),
        passChip(f.audit_passed, 'Audit passes', 'Audit fails'),
        el('span', { class: `chip ${/quantum/i.test(f.solver_used) ? 'chip--quantum' : 'chip--classical'}` }, f.solver_used));
      feederBox.replaceChildren(...feeders.map((fd, k) => {
        const st = fd.protected ? STATE.protected : (f.plan[k] ? STATE.off : STATE.on);
        return el('div', { class: `fr-cell${changed.has(k) ? ' fr-changed' : ''}`, title: changed.has(k) ? 'Changed since the previous hour' : null },
          el('div', { class: 'fr-name' }, fd.name), stateChip(st), changed.has(k) ? el('div', { class: 'subtle' }, 'changed') : null,
          params.debug ? el('div', { class: 'mono subtle' }, `bit ${f.plan[k]}`) : null);
      }));
      facts.replaceChildren(
        kpi('Actual shortfall', `${fmt(f.shortfall_mw, 1)} MW`, f.forecast_mw === null ? 'no forecast' : `forecast ${fmt(f.forecast_mw, 1)} MW`),
        kpi('Quota', `${f.quota} off`, `window quotas ${f.window_quotas.join(', ')}`),
        kpi('Window cost', fmt(f.cost, 2), `exact ${fmt(f.exact_cost, 2)}`),
        kpi('Solve time', fmtSec(f.runtime_s), f.warm_started ? 'warm-started from the previous frame' : 'cold start'));
      const maxL = Math.max(1, ...frames[frames.length - 1].ledger_after);
      ledgerBox.replaceChildren(...feeders.map((fd, k) => el('div', { class: 'mini-row' },
        el('span', { class: 'mini-name' }, fd.name),
        el('span', { class: 'mini-bar' }, el('i', { style: `width:${(100 * f.ledger_after[k]) / maxL}%;background:${fd.protected ? COLORS.protected : COLORS.off}` })),
        el('span', { class: 'mini-val mono' }, fd.protected ? 'protected' : `${fmt(f.ledger_after[k], 0)} h`))));
      chart.$cursorIndex = i;
      chart.update('none');
    }
    function stop() {
      S.playing = false;
      if (S.timer) clearInterval(S.timer);
      S.timer = null;
      playBtn.replaceChildren(icon('play', 20));
      playBtn.setAttribute('aria-label', 'Play');
    }
    playBtn.addEventListener('click', () => {
      if (S.playing) { stop(); return; }
      S.playing = true;
      playBtn.replaceChildren(icon('pause', 20));
      playBtn.setAttribute('aria-label', 'Pause');
      if (S.i >= frames.length - 1) show(0);
      S.timer = setInterval(() => { if (S.i >= frames.length - 1) stop(); else show(S.i + 1); }, reduced() ? STEP_MS * 1.5 : STEP_MS);
    });

    const solverTable = table([
      { label: 'Solver used', render: (r) => r[0] },
      { label: 'Frames', num: true, render: (r) => String(r[1]) },
    ], Object.entries(solverCounts));

    page.append(
      panel('Hour by hour', 'Use the slider or play. Feeders that changed state since the previous hour are outlined.',
        el('div', { class: 'stack' }, el('div', { class: 'row' }, playBtn, el('div', { style: 'flex:1;min-width:240px' }, slider.root)), head, feederBox, facts)),
      el('div', { class: 'grid-2' },
        panel('Shortfall, actual and forecast', 'The first hour of each window uses the actual shortfall; later hours use the classical ridge forecast.', el('div', { class: 'chart-box' }, canvas)),
        panel('Outage ledger after this hour', 'Hours each feeder has been off since the replay started.', ledgerBox)),
      panel('Solvers', null, el('div', { class: 'stack' }, solverTable, el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, rep.notes)))));
    show(0);
    return { destroy() { stop(); } };
  },
};
