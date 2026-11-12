// Chart.js wrapper: house styling, a registry so charts are destroyed on route change, and small plugins.
import { reduced } from './motion.js';

const registry = new Set();

export const COLORS = {
  text: '#E6EAF2', dim: '#B4BDCE', muted: '#8A94A8', grid: '#1F2A40', edge: '#66769A',
  accent: '#A99CFF', seriesB: '#C9D2E3', panel: '#121A2B', bg: '#0B1220',
  on: '#2DD4A7', off: '#F5A524', protected: '#4C9AFF', danger: '#F26D6D',
};

export function setupDefaults() {
  const C = window.Chart;
  if (!C) return;
  C.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
  C.defaults.font.size = 12;
  C.defaults.color = COLORS.muted;
  C.defaults.borderColor = COLORS.grid;
  C.defaults.maintainAspectRatio = false;
  C.defaults.responsive = true;
  C.defaults.plugins.legend.display = false;
  C.defaults.plugins.tooltip.backgroundColor = COLORS.bg;
  C.defaults.plugins.tooltip.borderColor = COLORS.edge;
  C.defaults.plugins.tooltip.borderWidth = 1;
  C.defaults.plugins.tooltip.titleColor = COLORS.text;
  C.defaults.plugins.tooltip.bodyColor = COLORS.dim;
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.cornerRadius = 4;
  C.defaults.plugins.tooltip.bodyFont = { family: '"IBM Plex Mono", monospace', size: 12 };
  C.defaults.plugins.tooltip.displayColors = true;
}

/** Axis options in house style. */
export function axis(extra = {}) {
  return {
    grid: { color: COLORS.grid, drawTicks: false },
    border: { color: COLORS.edge },
    ticks: { color: COLORS.muted, font: { family: '"IBM Plex Mono", monospace', size: 11 }, padding: 6 },
    title: { color: COLORS.muted, font: { family: '"IBM Plex Sans", sans-serif', size: 12 } },
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
    ctx.fillStyle = '#182238';
    ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px "IBM Plex Sans", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.label, x0 + 8, chartArea.top + 6);
    ctx.restore();
  },
};
