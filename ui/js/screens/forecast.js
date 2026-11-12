// Screen 7: Forecast. Classical ridge regression of the shortfall (results/forecast.json).
import { el, fmt, pad2 } from '../util.js';
import { naPanel, panel, pageHead, segmented, table, kpi } from '../components/common.js';
import { makeChart, axis, COLORS, bandPlugin } from '../charts.js';

export default {
  id: 'forecast',
  title: 'Forecast',
  async mount({ root, results }) {
    const page = el('div', { class: 'page' }, pageHead('Forecast', 'A classical ridge regression predicts the hourly shortfall from weather, hour and weekday. Its quotas and residuals feed the replay and the risk estimate.'));
    root.append(page);
    const fc = results.ok('forecast');
    if (!fc) { page.append(naPanel(results.get('forecast'))); return { destroy() {} }; }

    page.append(
      el('div', { class: 'row' },
        el('span', { class: 'chip chip--classical' }, `Model: ${fc.label}`),
        el('span', { class: 'chip' }, `Weather: ${fc.weather_provenance} (${fc.weather_source})`),
        el('span', { class: 'chip chip--off' }, `Demand and shortfall: ${fc.demand_provenance}`),
        el('span', { class: 'subtle' }, fc.location)),
      el('div', { class: 'kpis' },
        kpi('Mean absolute error', `${fmt(fc.metrics.mae_mw, 2)} MW`, 'test set'),
        kpi('Root mean square error', `${fmt(fc.metrics.rmse_mw, 2)} MW`, 'test set'),
        kpi('R squared', fmt(fc.metrics.r2, 3), 'test set'),
        kpi('Training / test hours', `${fc.model.n_train} / ${fc.model.n_test}`, `${fc.model.type}, alpha ${fc.model.alpha}`)));

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
            { label: 'Actual (synthetic)', data: pts.map((p) => p.shortfall_actual_mw), borderColor: COLORS.seriesB, backgroundColor: COLORS.seriesB, pointRadius: 0, borderWidth: 1.5, tension: 0 },
            { label: 'Ridge prediction', data: pts.map((p) => p.shortfall_pred_mw), borderColor: COLORS.accent, backgroundColor: COLORS.accent, pointRadius: 0, borderWidth: 1.5, tension: 0 },
          ],
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: true, labels: { color: COLORS.dim, boxWidth: 14 } }, band: which === 'all' && firstTest >= 0 ? { from: firstTest - offset, to: pts.length - 1, label: 'Test period' } : undefined },
          scales: { x: axis({ ticks: { color: COLORS.muted, maxTicksLimit: 8, maxRotation: 0, font: { family: '"IBM Plex Mono"', size: 11 } } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Shortfall (MW)', color: COLORS.muted } }) },
        },
        plugins: [bandPlugin],
      });
    };
    const seg = segmented({ label: 'Period', options: [{ value: 'test', label: 'Test week' }, { value: 'all', label: 'All hours' }], value: 'test', onChange: draw });
    page.append(panel('Actual and predicted shortfall', `${series.length} hourly points. The model never sees the test period while training.`, el('div', { class: 'stack' }, seg.root, chartBox)));
    draw('test');

    const da = fc.day_ahead;
    const dCanvas = el('canvas', { role: 'img', 'aria-label': 'Day-ahead predicted shortfall by hour' });
    page.append(el('div', { class: 'grid-2' },
      panel('Day-ahead forecast and quotas', 'Predicted shortfall per hour and the number of feeders it requires.', el('div', { class: 'chart-box' }, dCanvas)),
      panel('Hours with a quota', null, table([
        { label: 'Hour', render: (d) => `${pad2(d.hour)}:00` },
        { label: 'Predicted shortfall', num: true, render: (d) => `${fmt(d.shortfall_pred_mw, 2)} MW` },
        { label: 'Quota (feeders off)', num: true, render: (d) => String(d.quota) },
      ], da.filter((d) => d.quota > 0)))));
    makeChart(dCanvas, {
      type: 'bar',
      data: { labels: da.map((d) => pad2(d.hour)), datasets: [{ data: da.map((d) => d.shortfall_pred_mw), backgroundColor: da.map((d) => (d.quota > 0 ? COLORS.off : COLORS.seriesB)), borderWidth: 0 }] },
      options: {
        scales: { x: axis({ title: { display: true, text: 'Hour of day', color: COLORS.muted } }), y: axis({ beginAtZero: true, title: { display: true, text: 'MW', color: COLORS.muted } }) },
        plugins: { tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.y, 2)} MW, quota ${da[c.dataIndex].quota}` } } },
      },
    });
    page.append(el('details', { class: 'disc' }, el('summary', null, 'Method notes'), el('p', { class: 'subtle' }, fc.notes)));
    return { destroy() { if (chart) chart.destroy(); } };
  },
};
