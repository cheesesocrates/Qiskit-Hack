import { el } from '../util.js';
export default { id: 'audit', title: 'Audit', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Audit'))); return { destroy() {} }; } };
