// Top banner: names every missing or schema-invalid results file (visible system status).
import { el, clear } from './util.js';
import { icon } from './icons.js';

export function renderBanner(host, results) {
  clear(host);
  const probs = results.problems;
  if (!probs.length && results.indexLoaded) return;

  const body = el('div', { class: 'banner-body' });
  if (!results.indexLoaded) {
    body.append(el('div', { class: 'banner-title' }, 'Could not read schemas/index.json, so results are shown without validation.'));
  }
  if (probs.length) {
    const nMissing = probs.filter((p) => p.status === 'missing').length;
    const nInvalid = probs.length - nMissing;
    const parts = [];
    if (nMissing) parts.push(`${nMissing} not generated`);
    if (nInvalid) parts.push(`${nInvalid} failed schema validation`);
    body.append(
      el('div', { class: 'banner-title' }, `Some results are not available (${parts.join(', ')}). Affected screens say so instead of showing numbers.`),
      el('div', { class: 'banner-files', role: 'list', 'aria-label': 'Unavailable result files' },
        probs.map((p) => el('span', { class: `file-chip${p.status === 'invalid' ? ' file-chip--invalid' : ''}`, role: 'listitem' },
          p.path, el('span', null, p.status === 'invalid' ? '(invalid)' : '(missing)')))));
    const invalid = probs.filter((p) => p.status === 'invalid');
    if (invalid.length) {
      body.append(el('details', null, el('summary', null, 'Show validation errors'),
        el('pre', null, invalid.map((p) => `${p.path}\n  ${p.errors.slice(0, 5).join('\n  ')}`).join('\n\n'))));
    }
  }
  host.append(el('div', { class: 'banner', role: 'region', 'aria-label': 'Result files status' }, el('span', { class: 'banner-icon' }, icon('info', 18)), body));
}
