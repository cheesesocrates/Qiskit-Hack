// Page-level configuration. Nothing in here is a result: no numbers about the problem live in the UI code.

const qs = new URLSearchParams(window.location.search);

/** Safe relative path for the results folder: default ../results/, or e.g. tests/fixtures/ for mock data. */
function resultsBase() {
  const raw = qs.get('results');
  if (!raw) return '../results/';
  if (!/^[\w./-]+$/.test(raw) || raw.includes('//') || raw.startsWith('/')) return '../results/';
  return raw.endsWith('/') ? raw : raw + '/';
}

export const params = {
  base: resultsBase(),
  schemas: '../schemas/',
  debug: qs.get('debug') === '1',
  tiles: qs.get('tiles') !== 'off', // ?tiles=off keeps the offline grid only (used by tests and screenshots)
};
params.mock = params.base !== '../results/';

/** Scenario plan files the dashboard looks for under results/plans/. */
export const SCENARIOS = ['base', 'heatwave_cap', 'block_4x2'];

/** Screens, in rail order. `id` is the hash route. */
export const SCREEN_META = [
  { id: 'plan', label: 'Plan', icon: 'pin' },
  { id: 'compare', label: 'Compare', icon: 'compare' },
  { id: 'audit', label: 'Audit', icon: 'audit' },
  { id: 'replay', label: 'Replay', icon: 'replay' },
  { id: 'risk', label: 'Risk', icon: 'risk' },
  { id: 'scale', label: 'Scale', icon: 'scale' },
  { id: 'forecast', label: 'Forecast', icon: 'forecast' },
];
