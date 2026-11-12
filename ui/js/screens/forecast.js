import { el } from '../util.js';
export default { id: 'forecast', title: 'Forecast', async mount({ root }) { root.append(el('div', { class: 'page' }, el('h1', null, 'Forecast'))); return { destroy() {} }; } };
