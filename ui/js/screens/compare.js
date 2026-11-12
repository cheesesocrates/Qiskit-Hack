import { el } from '../util.js';
export default { id: 'compare', title: 'Compare', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Compare'))); return { destroy() {} }; } };
