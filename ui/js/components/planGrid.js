// T x N schedule grid (hours down, feeders across). Cells show state icon + text label; violations are outlined
// in red with a warning icon. Optionally editable (click or Enter/Space toggles a cell) for the audit "try it" mode.
import { el, svgEl, clock, reverseStr, bitsFromMatrix } from '../util.js';
import { iconSvg, STATE, stateOf } from '../icons.js';

/** Debug block (?debug=1): index-ordered bitstring and the Qiskit-order key (reversed). */
export function debugBox(bits, N, title = 'Debug') {
  const grouped = (s) => (N ? s.match(new RegExp(`.{1,${N}}`, 'g')).join(' ') : s);
  return el('dl', { class: 'debug-box', 'aria-label': 'Debug bit order' },
    el('dt', null, `${title}: q = t*N + f, bits[q] index-ordered (hours separated by a space)`),
    el('dd', null, grouped(bits)),
    el('dt', null, 'Qiskit-order key (reversed string, qubit 0 on the right)'),
    el('dd', null, reverseStr(bits)));
}

export function planGrid({ inst, matrix, violations = [], editable = false, onToggle, debug = false, label = 'Schedule' }) {
  const N = inst.n_feeders, T = inst.n_hours;
  const root = el('div', { class: 'pgrid', role: 'group', 'aria-label': label, style: `--n:${N}` });
  const cells = [];
  const colHeads = [];
  const rowHeads = [];

  const head = el('div', { class: 'pg-row pg-head' }, el('div', { class: 'pg-corner' }, 'Hour'));
  inst.feeders.forEach((f, i) => {
    const h = el('div', { class: 'pg-colh', title: `${f.name} (${f.kind})` }, el('span', { class: 'pg-name' }, f.name));
    colHeads.push(h);
    head.append(h);
  });
  root.append(head);

  for (let t = 0; t < T; t++) {
    const row = el('div', { class: 'pg-row' });
    const rh = el('div', { class: 'pg-rowh' }, el('span', { class: 'mono' }, clock(inst.start_hour, t)), el('span', { class: 'pg-q' }, `quota ${inst.quotas[t]}`));
    rowHeads.push(rh);
    row.append(rh);
    cells[t] = [];
    for (let f = 0; f < N; f++) {
      const c = editable ? el('button', { type: 'button', class: 'pg-cell' }) : el('div', { class: 'pg-cell' });
      if (editable) c.addEventListener('click', () => onToggle && onToggle(t, f));
      cells[t][f] = c;
      row.append(c);
    }
    root.append(row);
  }

  function update(M, viols = []) {
    for (let t = 0; t < T; t++) {
      for (let f = 0; f < N; f++) {
        const c = cells[t][f];
        const fd = inst.feeders[f];
        const st = fd.protected && M[t][f] === 0 ? STATE.protected : (M[t][f] === 1 ? STATE.off : STATE.on);
        const here = viols.filter((v) => (v.hour === t && v.feeder === f) || (v.feeder === f && v.hour === null && M[t][f] === 1));
        c.className = `pg-cell ${st.cls}${here.length ? ' viol' : ''}`;
        c.replaceChildren(
          svgEl(iconSvg(st.icon, 16)),
          el('span', { class: 'pg-lab' }, fd.protected && M[t][f] === 1 ? 'Off (protected!)' : st.label),
          here.length ? svgEl(iconSvg('warn', 14), 'pg-warn') : null,
          debug ? el('span', { class: 'pg-dbg' }, `q=${t * N + f}`) : null);
        const desc = `${fd.name}, ${clock(inst.start_hour, t)}: ${fd.protected && M[t][f] === 1 ? 'off although protected' : st.label}${here.length ? '. Violation: ' + here.map((v) => v.rule).join(', ') : ''}`;
        c.setAttribute('aria-label', desc);
        if (editable) c.setAttribute('aria-pressed', String(M[t][f] === 1));
      }
      const qv = viols.some((v) => v.rule === 'quota' && v.hour === t);
      rowHeads[t].classList.toggle('viol', qv);
    }
    colHeads.forEach((h, f) => {
      h.classList.toggle('viol', viols.some((v) => v.feeder === f && v.hour === null));
    });
  }

  update(matrix, violations);
  return { root, update };
}
