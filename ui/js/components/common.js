// Shared UI building blocks: panels, not-available notices, segmented control, tick slider, chips, tiles.
import { el, svgEl } from '../util.js';
import { iconSvg, icon } from '../icons.js';

/** "Not available" notice for every file that is not ok. `entries` are data-layer entries. */
export function naPanel(entries) {
  const list = [].concat(entries).filter(Boolean);
  return el('div', { class: 'stack' }, list.map((e) => {
    const invalid = e.status === 'invalid';
    return el('div', { class: `na${invalid ? ' na--invalid' : ''}`, role: 'status' },
      icon(invalid ? 'fail' : 'info', 20),
      el('div', null,
        el('div', { class: 'na-title' }, 'Not available'),
        invalid
          ? el('p', null, el('code', null, e.path), ' failed schema validation: ', el('span', { class: 'mono' }, e.errors[0] || 'unknown error'))
          : el('p', null, el('code', null, e.path), ' has not been generated.')));
  }));
}

/** Returns an array of non-ok entries among the given keys (empty if all are ok). */
export function missing(results, keys) {
  return keys.map((k) => results.get(k)).filter((e) => e.status !== 'ok');
}

export function panel(title, sub, body, opts = {}) {
  const head = title ? el('div', { class: 'panel-h' }, el('div', null, el('h2', null, title), sub ? el('p', { class: 'panel-sub' }, sub) : null), opts.right || null) : null;
  return el('section', { class: `panel ${opts.class || ''}`.trim(), 'aria-label': opts.label || title || null }, head, el('div', { class: 'panel-b' }, body));
}

export function pageHead(title, lede) {
  return el('header', { class: 'page-head' }, el('h1', null, title), lede ? el('p', { class: 'lede' }, lede) : null);
}

export function kpi(label, value, sub, valueNode) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-l' }, label), el('div', { class: 'kpi-v' }, valueNode || value), sub ? el('div', { class: 'kpi-s' }, sub) : null);
}

export function kindTag(kind) {
  const q = kind === 'quantum';
  return el('span', { class: `chip chip--${q ? 'quantum' : 'classical'}`, title: q ? 'Runs on a quantum circuit (simulated)' : 'Classical method' },
    svgEl(iconSvg(q ? 'atom' : 'chip', 14)), q ? 'Quantum' : 'Classical');
}

export function passChip(passed, passLabel = 'Pass', failLabel = 'Fail') {
  return el('span', { class: `chip ${passed ? 'chip--on' : 'chip--danger'}` }, svgEl(iconSvg(passed ? 'pass' : 'fail', 14)), passed ? passLabel : failLabel);
}

/**
 * Segmented control (radiogroup). options: [{value,label,disabled,title}]. Arrow keys move and select.
 * onChange fires only when the value really changes, so clicking the option that is already on does
 * nothing (it used to re-run the change and reset whatever depended on it). `value` may be null (none
 * selected); the first enabled option then takes the Tab stop so the group stays keyboard-reachable.
 * Returns {root, set(value), get(), setDisabled(value, bool)}.
 */
export function segmented({ label, options, value, onChange }) {
  const root = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const btns = new Map();
  let current;
  const paint = () => {
    const enabled = options.filter((o) => btns.has(o.value) && !btns.get(o.value).disabled);
    const stop = btns.has(current) && !btns.get(current).disabled ? current : (enabled[0] ? enabled[0].value : null);
    for (const [val, b] of btns) { b.setAttribute('aria-checked', String(val === current)); b.tabIndex = val === stop ? 0 : -1; }
  };
  const select = (v, fire = true) => {
    const changed = v !== current;
    current = v;
    paint();
    if (fire && changed && onChange) onChange(v);
  };
  options.forEach((o) => {
    const b = el('button', { type: 'button', class: 'seg-item', role: 'radio', 'aria-checked': 'false', title: o.title || null, disabled: o.disabled || null }, o.label);
    b.addEventListener('click', () => select(o.value));
    b.addEventListener('keydown', (ev) => {
      const enabled = options.filter((x) => !btns.get(x.value).disabled);
      const i = enabled.findIndex((x) => x.value === o.value);
      let n = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') n = enabled[(i + 1) % enabled.length];
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') n = enabled[(i - 1 + enabled.length) % enabled.length];
      if (n) { ev.preventDefault(); select(n.value); btns.get(n.value).focus(); }
    });
    btns.set(o.value, b);
    root.append(b);
  });
  select(value, false);
  return {
    root,
    set: (v) => select(v, false),
    get: () => current,
    setDisabled: (v, d) => { const b = btns.get(v); if (b) { b.disabled = d; paint(); } },
  };
}

/**
 * Slider with clickable tick labels. `ticks` is an array of strings (one per step). Native range input,
 * so arrow keys, Home/End and PageUp/PageDown work. Returns {root, input, set(i)}.
 */
export function tickSlider({ label, ticks, value = 0, onInput, id }) {
  const n = ticks.length;
  const input = el('input', { type: 'range', class: 'range', min: 0, max: Math.max(0, n - 1), step: 1, value, 'aria-label': label, id: id || null });
  input.setAttribute('aria-valuetext', ticks[value]);
  const tickBox = el('div', { class: 'ticks' });
  const tickBtns = ticks.map((t, i) => {
    const b = el('button', { type: 'button', class: 'tick', tabindex: '-1', style: `--p:${n > 1 ? i / (n - 1) : 0}`, 'aria-label': `${label}: ${t}` }, t);
    b.addEventListener('click', () => { set(i); onInput && onInput(i, true); });
    tickBox.append(b);
    return b;
  });
  const set = (i) => {
    input.value = i;
    input.setAttribute('aria-valuetext', ticks[i]);
    tickBtns.forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  };
  input.addEventListener('input', () => { const i = Number(input.value); set(i); onInput && onInput(i, true); });
  set(value);
  return { root: el('div', { class: 'range-wrap' }, input, tickBox), input, set };
}

/** Plain table builder: cols [{key,label,num,render(row)->node|string,cls}], rows []. */
export function table(cols, rows, opts = {}) {
  const t = el('table', { class: 'tbl' });
  t.append(el('thead', null, el('tr', null, cols.map((c) => el('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))));
  t.append(el('tbody', null, rows.map((r) => el('tr', opts.rowAttrs ? opts.rowAttrs(r) : null,
    cols.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      const cls = [c.num ? 'num' : '', c.cls || '', c.best && c.best(r) ? 'best' : ''].join(' ').trim();
      return el('td', { class: cls || null }, v);
    })))));
  return el('div', { class: 'tbl-wrap' }, t);
}
