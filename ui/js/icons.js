// Inline SVG icons (24x24 viewBox, stroke = currentColor). State icons are used together with a text label.
import { svgEl } from './util.js';

const P = {
  // feeder states
  on: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.8 5.2-5.6" stroke-width="2.25"/>',
  off: '<path d="M12 3.5v8" stroke-width="2.25"/><path d="M7.2 6.6a7.5 7.5 0 1 0 9.6 0" stroke-width="2.25"/>',
  protected: '<path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6z" fill="currentColor" fill-opacity="0.18" stroke-linejoin="round"/><path d="m8.8 12 2.4 2.4 4.2-4.6"/>',
  // status
  pass: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.7 2.7 5-5.4"/>',
  fail: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  warn: '<path d="M12 4 3 19.5h18z" stroke-linejoin="round"/><path d="M12 10v4.5M12 17v.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>',
  // controls
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>',
  stepf: '<path d="M6 6v12l9-6z" fill="currentColor" stroke-linejoin="round"/><path d="M18 6v12"/>',
  stepb: '<path d="M18 6v12l-9-6z" fill="currentColor" stroke-linejoin="round"/><path d="M6 6v12"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4.5v4h-4"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  // tags
  atom: '<circle cx="12" cy="12" r="1.8" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-9.5v-6" stroke-linejoin="round"/><path d="M7.7 15h8.6"/>',
  // nav
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3"/>',
  compare: '<path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
  audit: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 12.5l2.2 2.2 4.5-4.8"/>',
  replay: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke-linejoin="round"/>',
  risk: '<path d="M3.5 18.5c3-1 4.5-12 8.5-12s5.500 11 8.500 12"/><path d="M3 20.5h18"/>',
  scale: '<path d="M4 19.5 9 14l3.500 3.500L20 8.500"/><path d="M15 8.500h5v5"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  learn: '<path d="M4 5.5c3-1 6-1 8 .8 2-1.8 5-1.8 8-.8v13c-3-1-6-1-8 .8-2-1.8-5-1.8-8-.8z" stroke-linejoin="round"/><path d="M12 6.3v13"/>',
  tour: '<circle cx="12" cy="12" r="8.5"/><path d="m9.5 14.5 1.6-4.4 4.4-1.6-1.6 4.4z" fill="currentColor" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" stroke-linejoin="round"/>',
  bolt: '<path d="M13 3 5 13.5h5.5L9.5 21 19 9.5h-5.8z" stroke-linejoin="round"/>',
  arrowr: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowl: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forecast: '<path d="M3.500 15c2.500 0 2.500-6 5-6s2.500 8 5 8 2.500-5 7-5"/><path d="M3.500 20.500h17"/>',
};

export function iconSvg(name, size = 20, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false" ${extra}>${P[name] || ''}</svg>`;
}
export function icon(name, size = 20) { return svgEl(iconSvg(name, size)); }

/** Feeder state vocabulary: icon + text label + css class, used by map, grids and popovers. */
export const STATE = {
  on: { key: 'on', label: 'On', icon: 'on', cls: 'is-on' },
  off: { key: 'off', label: 'Off', icon: 'off', cls: 'is-off' },
  protected: { key: 'protected', label: 'Protected', icon: 'protected', cls: 'is-protected' },
};

/** State of feeder at column f of one matrix row (1 = off). Protected feeders always read as protected. */
export function stateOf(feeder, f, matrixRow) {
  if (feeder.protected) return STATE.protected;
  return matrixRow[f] === 1 ? STATE.off : STATE.on;
}

export function stateChip(state, labelOverride) {
  const c = document.createElement('span');
  c.className = `chip chip--${state.key}`;
  c.innerHTML = iconSvg(state.icon, 14);
  c.append(labelOverride || state.label);
  return c;
}
