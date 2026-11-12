import { el } from '../util.js';
export default { id: 'risk', title: 'Risk and counting', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Risk and counting'))); return { destroy() {} }; } };
