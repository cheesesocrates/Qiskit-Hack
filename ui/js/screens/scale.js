import { el } from '../util.js';
export default { id: 'scale', title: 'Scale', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Scale'))); return { destroy() {} }; } };
