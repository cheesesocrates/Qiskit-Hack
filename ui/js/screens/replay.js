import { el } from '../util.js';
export default { id: 'replay', title: 'Replay', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Replay'))); return { destroy() {} }; } };
