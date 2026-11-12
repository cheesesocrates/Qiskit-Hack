// Screen 7: Forecast. Classical ridge regression of the shortfall (results/forecast.json).
import { el, fmt, pad2 } from '../util.js';
import { naPanel, panel, segmented, table, kpi } from '../components/common.js';
import { explainPanel, pageHeader, chartBlock, rawJson } from '../explain.js';
import { term } from '../glossary.js';
import { makeChart, axis, COLORS, bandPlugin, endLabelsPlugin } from '../charts.js';

export default {
  id: 'forecast',
  title: 'Forecast',
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHeader('How big will the shortage be?', 'Results: shortage forecast (was Forecast, classical)',
      'A classical model predicts the hourly shortage. Its forecast sets how many feeders must be off, and its errors feed the risk estimate.'));
    root.append(page);
    const fc = results.ok('forecast');
    if (!fc) {
      page.append(explainPanel('forecast', { what: 'The shortage forecast.', how: 'Not available.', notice: null, not: 'Not available.' }), naPanel(results.get('forecast')));
      return { destroy() {} };
    }
    const testPts = fc.series.filter((p) => p.split === 'test');
    const peak = testPts.length ? Math.max(...testPts.map((p) => p.shortfall_actual_mw)) : null;
    page.append(explainPanel('forecast', {
      what: [el('span', null, 'A classical ', term('ridge', 'ridge regression'), ' forecast of the hourly shortage, against the shortage that actually happened.')],
      how: ['Time runs left to right. The blue line is what happened, the orange line is the forecast.', 'The model learned on the earlier weeks and never saw the test week while learning.'],
      notice: [`On the test week the forecast is off by ${fmt(fc.metrics.mae_mw, 2)} MW per hour on average${peak !== null ? `, against shortages of up to ${fmt(peak, 1)} MW` : ''}.`,
        `R squared is ${fmt(fc.metrics.r2, 2)}: the share of the hour-to-hour ups and downs the model explains (1 would be perfect).`],
      not: ['Quantum computing: the forecast is classical.', `Real demand: weather is ${fc.weather_provenance} (${fc.weather_source}), demand and shortage are ${fc.demand_provenance}.`],
    }));

    page.append(
      el('div', { class: 'row' },
        el('span', { class: 'chip chip--classical' }, `Model: ${fc.label}`),
        el('span', { class: 'chip' }, `Weather: ${fc.weather_provenance} (${fc.weather_source})`),
        el('span', { class: 'chip chip--neutral' }, `Demand and shortfall: ${fc.demand_provenance}`),
        el('span', { class: 'subtle' }, fc.location)),
      el('div', { class: 'kpis' },
        kpi('Typical miss', `${fmt(fc.metrics.mae_mw, 2)} MW`, 'Average size of the forecast error per hour, test week'),
        kpi('Miss, weighting big errors more', `${fmt(fc.metrics.rmse_mw, 2)} MW`, 'Root mean square error, test week'),
        kpi('Share of ups and downs explained', fmt(fc.metrics.r2, 2), 'R squared: 1 is perfect, 0 is no better than the average'),
        kpi('Hours learned from / tested on', `${fc.model.n_train} / ${fc.model.n_test}`, el('span', { class: 'expert-only' }, `${fc.model.type}, alpha ${fc.model.alpha}`))));

    const series = fc.series;
    const firstTest = series.findIndex((p) => p.split === 'test');
    const canvas = el('canvas', { role: 'img', 'aria-label': 'Actual and predicted shortfall over time' });
    const chartBox = el('div', { class: 'chart-box chart-box--tall' }, canvas);
    let chart = null;
    const draw = (which) => {
      const pts = which === 'test' && firstTest >= 0 ? series.slice(firstTest) : series;
      const offset = which === 'test' && firstTest >= 0 ? firstTest : 0;
      if (chart) chart.destroy();
      chart = makeChart(canvas, {
        type: 'line',
        data: {
          labels: pts.map((p) => p.time.replace('T', ' ')),
          datasets: [
            { label: 'Happened', data: pts.map((p) => p.shortfall_actual_mw), borderColor: COLORS.quantum, backgroundColor: COLORS.quantum, pointRadius: 0, borderWidth: 2.5, tension: 0 },
            { label: 'Forecast', data: pts.map((p) => p.shortfall_pred_mw), borderColor: COLORS.classical, backgroundColor: COLORS.classical, pointRadius: 0, borderWidth: 2.5, borderDash: [8, 4], tension: 0 },
          ],
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { right: 88 } },
          plugins: { band: which === 'all' && firstTest >= 0 ? { from: firstTest - offset, to: pts.length - 1, label: 'Test week' } : undefined },
          scales: { x: axis({ ticks: { color: COLORS.text, maxTicksLimit: 7, maxRotation: 0, font: { size: 14 } }, title: { display: true, text: 'Date and hour' } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Shortage (MW)' } }) },
        },
        plugins: [bandPlugin, endLabelsPlugin],
      });
    };
    const seg = segmented({ label: 'Period', options: [{ value: 'test', label: 'Test week' }, { value: 'all', label: 'All hours' }], value: 'test', onChange: draw });
    page.append(panel(null, null, el('div', { class: 'stack' }, el('div', null, el('span', { class: 'field-label' }, 'Period'), seg.root),
      chartBlock({ takeaway: `On the test week the forecast is off by ${fmt(fc.metrics.mae_mw, 2)} MW per hour on average.`, chart: chartBox,
        howto: 'Time runs left to right. The solid blue line is the shortage that happened (synthetic); the dashed orange line is the forecast. Where they overlap, the forecast was right.',
        plain: ['MW is megawatts. One feeder carries a fixed number of megawatts, so the forecast decides how many feeders must be off.'] }))));
    draw('test');

    const da = fc.day_ahead;
    const dCanvas = el('canvas', { role: 'img', 'aria-label': 'Day-ahead predicted shortfall by hour' });
    const withQ = da.filter((d) => d.quota > 0);
    const pk = da.reduce((a, b) => (b.shortfall_pred_mw > a.shortfall_pred_mw ? b : a), da[0]);
    page.append(el('div', { class: 'grid-2' },
      panel(null, null, chartBlock({ takeaway: `The day-ahead forecast needs feeders off in ${withQ.length} of ${da.length} hours, peaking at ${fmt(pk.shortfall_pred_mw, 1)} MW at ${pad2(pk.hour)}:00.`,
        chart: el('div', { class: 'chart-box' }, dCanvas), howto: 'One bar per hour of the day. Taller bars mean a bigger shortage, so more feeders off. Grey bars need no cuts.' })),
      panel('Hours with a quota', null, table([
        { label: 'Hour', render: (d) => `${pad2(d.hour)}:00` },
        { label: 'Predicted shortfall', num: true, render: (d) => `${fmt(d.shortfall_pred_mw, 2)} MW` },
        { label: 'Quota (feeders off)', num: true, render: (d) => String(d.quota) },
      ], da.filter((d) => d.quota > 0)))));
    makeChart(dCanvas, {
      type: 'bar',
      data: { labels: da.map((d) => pad2(d.hour)), datasets: [{ data: da.map((d) => d.shortfall_pred_mw), backgroundColor: da.map((d) => (d.quota > 0 ? COLORS.classical : COLORS.edge)), borderWidth: 0 }] },
      options: {
        scales: { x: axis({ title: { display: true, text: 'Hour of the day' } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Forecast shortage (MW)' } }) },
        plugins: { tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.y, 2)} MW, quota ${da[c.dataIndex].quota}` } } },
      },
    });
    page.append(el('div', { class: 'expert-only stack' }, el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, fc.notes)), rawJson('results/forecast.json', fc)));
    return { destroy() { if (chart) chart.destroy(); } };
  },
};
