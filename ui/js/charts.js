// Chart.js wrapper: house styling, a registry so charts are destroyed on route change, and small plugins.
import { reduced } from './motion.js';

const registry = new Set();

/** Colours come from the CSS tokens, so charts follow the light or dark theme. Call refreshColors() after a theme change. */
export const COLORS = {};
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export function refreshColors() {
  Object.assign(COLORS, {
    text: cssVar('--text'), dim: cssVar('--text-dim'), muted: cssVar('--text-dim'), grid: cssVar('--grid'), edge: cssVar('--border-strong'),
    accent: cssVar('--accent'), panel: cssVar('--panel'), bg: cssVar('--bg'),
    on: cssVar('--on'), off: cssVar('--off'), protected: cssVar('--protected'), danger: cssVar('--danger'),
    quantum: cssVar('--c1'), classical: cssVar('--c2'), seriesB: cssVar('--c2'),
    series: ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'].map(cssVar),
  });
  return COLORS;
}
const FONT = '"Atkinson Hyperlegible", "Inter", system-ui, sans-serif';

export function setupDefaults() {
  const C = window.Chart;
  refreshColors();
  if (!C) return;
  C.defaults.font.family = FONT;
  C.defaults.font.size = 15;
  C.defaults.color = COLORS.text;
  C.defaults.borderColor = COLORS.grid;
  C.defaults.maintainAspectRatio = false;
  C.defaults.responsive = true;
  C.defaults.plugins.legend.display = false;
  C.defaults.plugins.legend.labels.font = { family: FONT, size: 15 };
  C.defaults.plugins.tooltip.backgroundColor = COLORS.panel;
  C.defaults.plugins.tooltip.borderColor = COLORS.edge;
  C.defaults.plugins.tooltip.borderWidth = 2;
  C.defaults.plugins.tooltip.titleColor = COLORS.text;
  C.defaults.plugins.tooltip.bodyColor = COLORS.text;
  C.defaults.plugins.tooltip.padding = 12;
  C.defaults.plugins.tooltip.cornerRadius = 4;
  C.defaults.plugins.tooltip.titleFont = { family: FONT, size: 15, weight: 'bold' };
  C.defaults.plugins.tooltip.bodyFont = { family: FONT, size: 15 };
  C.defaults.plugins.tooltip.displayColors = true;
}

/** Label each line at its last point (direct labels instead of a legend box). */
export const endLabelsPlugin = {
  id: 'endLabels',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    const placed = [];
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      let last = null;
      meta.data.forEach((pt, i) => { if (ds.data[i] !== null && ds.data[i] !== undefined) last = pt; });
      if (!last) return;
      let y = last.y;
      for (const p of placed) if (Math.abs(p - y) < 18) y = p + 18;
      placed.push(y);
      ctx.save();
      ctx.font = `bold 14px ${FONT}`;
      ctx.fillStyle = ds.borderColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(ds.label, Math.min(last.x + 10, chartArea.right + 10), y);
      ctx.restore();
    });
  },
};

/** Axis options in house style. */
export function axis(extra = {}) {
  return {
    grid: { color: COLORS.grid, drawTicks: false },
    border: { color: COLORS.edge },
    ticks: { color: COLORS.text, font: { family: FONT, size: 14 }, padding: 6 },
    title: { color: COLORS.text, font: { family: FONT, size: 15, weight: 'bold' } },
    ...extra,
  };
}

/** Create a chart on a canvas. Charts are tracked; call destroyAll() when the screen goes away. */
export function makeChart(canvas, config) {
  const C = window.Chart;
  if (!C) throw new Error('Chart.js is not loaded');
  config.options = config.options || {};
  config.options.animation = reduced() ? false : { duration: 250, easing: 'easeOutQuad' };
  const chart = new C(canvas, config);
  registry.add(chart);
  return chart;
}

export function destroyAll() {
  for (const c of registry) { try { c.destroy(); } catch (e) { /* already gone */ } }
  registry.clear();
}

/** Vertical cursor line at `chart.$cursorIndex` (category/linear x), used by replay. */
export const cursorPlugin = {
  id: 'cursor',
  afterDatasetsDraw(chart) {
    const i = chart.$cursorIndex;
    if (i === undefined || i === null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(i);
    if (!Number.isFinite(x)) return;
    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/** Shade a region between two x indices (forecast test split). Options: chart.options.plugins.band = {from,to,label} */
export const bandPlugin = {
  id: 'band',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.from === undefined) return;
    const { ctx, chartArea, scales } = chart;
    const x0 = scales.x.getPixelForValue(opts.from);
    const x1 = Math.min(chartArea.right, scales.x.getPixelForValue(opts.to));
    ctx.save();
    ctx.fillStyle = COLORS.grid;
    ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 14px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(opts.label, x0 + 8, chartArea.top + 6);
    ctx.restore();
  },
};

/** Print each bar's value just past its end (so values never depend on reading the axis). */
export function valueLabels(format) {
  return {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const v = ds.data[i];
          if (v === null || v === undefined) return;
          ctx.save();
          ctx.fillStyle = COLORS.text;
          ctx.font = `bold 14px ${FONT}`;
          ctx.textBaseline = 'middle';
          ctx.fillText(format(v), bar.x + 8, bar.y);
          ctx.restore();
        });
      });
    },
  };
}
