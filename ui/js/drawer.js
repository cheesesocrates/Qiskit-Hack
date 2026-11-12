// Inner working drawer. One button in the top bar opens it on any screen. It explains the screen
// behind it in plain words (what it is, how to read it, how it was made, what it does not show, the
// questions judges ask), and gathers the technical detail the screen marked .expert-only under
// "For specialists". Pages stay clean for the people who use the schedule.
// Esc closes it (after any open glossary card), "i" toggles it, focus returns to the button.
import { el } from './util.js';
import { icon } from './icons.js';
import { kindTag } from './components/common.js';
import { takeExplain } from './explain.js';

const PAGES = [
  { href: '#/inner/story', ic: 'learn', t: 'How FairShed works', s: 'The whole project in six steps' },
  { href: '#/inner/questions', ic: 'info', t: 'Questions judges ask', s: 'Short, honest answers' },
  { href: '#/inner/algorithms', ic: 'atom', t: 'The methods', s: 'Each algorithm in plain words' },
  { href: '#/inner/glossary', ic: 'flask', t: 'Glossary', s: 'Every technical word' },
];

const S = { open: false, btn: null, drawer: null, scrim: null, body: null, sub: null, title: '', moved: [] };

const list = (x) => {
  if (x === null || x === undefined) return null;
  return Array.isArray(x) ? el('ul', { class: 'iw-list' }, x.filter(Boolean).map((i) => el('li', null, i))) : el('p', null, x);
};
const sec = (h, ...kids) => el('section', { class: 'iw-sec' }, el('h3', null, h), ...kids);

/** Block-level technical detail still sitting (hidden) on the page. Inline spans stay hidden. */
function harvest() {
  const found = [...document.querySelectorAll('#main .expert-only')]
    .filter((n) => n.tagName !== 'SPAN' && !(n.parentElement && n.parentElement.closest('.expert-only')));
  S.moved.push(...found);
  return S.moved;
}

function render() {
  const p = takeExplain();
  S.sub.textContent = S.title ? `About this screen: ${S.title}` : 'About this screen';
  const kids = [];
  kids.push(el('nav', { class: 'iw-pages', 'aria-label': 'Inner working pages' },
    PAGES.map((x) => el('a', { class: 'iw-page', href: x.href, 'aria-current': window.location.hash.startsWith(x.href) ? 'page' : null },
      icon(x.ic, 22), el('span', null, el('span', { class: 'iw-page-t' }, x.t), el('span', { class: 'iw-page-s' }, x.s))))));
  if (!p) {
    kids.push(el('p', null, 'This screen has no explanation of its own. The pages above explain the whole project.'));
  } else {
    if (p.say) kids.push(el('p', { class: 'iw-say' }, p.say));
    kids.push(sec('What you are looking at', list(p.what), p.how ? el('h4', null, 'How to read it') : null, list(p.how)));
    kids.push(sec('What to notice', p.notice ? list(p.notice) : el('p', null, 'Not available: the results file this screen needs is missing.')));
    if (p.made && p.made.length) {
      kids.push(sec('How it was made', el('ol', { class: 'iw-made' }, p.made.map((m, i) => el('li', null,
        el('span', { class: 'iw-made-n' }, String(i + 1)), el('div', null, kindTag(m.kind), el('p', null, m.text)))))));
    }
    kids.push(sec('What it does not show', list(p.not)));
    if (p.qa && p.qa.length) {
      kids.push(sec('Questions judges ask', el('div', { class: 'qa-list' }, p.qa.map((x) => el('details', { class: 'qa' },
        el('summary', null, x.q), el('div', { class: 'qa-a' }, typeof x.a === 'function' ? x.a() : x.a))))));
    }
  }
  const spec = harvest();
  kids.push(sec('For specialists', spec.length
    ? el('div', { class: 'iw-spec' }, spec)
    : el('p', null, 'No extra technical detail on this screen. "The methods" page has formulas, qubit counts and circuit settings.')));
  S.body.replaceChildren(...kids);
}

export function openDrawer() {
  if (S.open) return;
  S.open = true;
  render();
  S.drawer.hidden = false;
  S.scrim.hidden = false;
  document.body.classList.add('iw-open');
  S.btn.setAttribute('aria-expanded', 'true');
  S.drawer.querySelector('#iw-title').focus();
  window.dispatchEvent(new Event('resize')); // maps and charts re-measure when the page narrows
}

export function closeDrawer(returnFocus = true) {
  if (!S.open) return;
  S.open = false;
  S.drawer.hidden = true;
  S.scrim.hidden = true;
  document.body.classList.remove('iw-open');
  S.btn.setAttribute('aria-expanded', 'false');
  if (returnFocus) S.btn.focus();
  window.dispatchEvent(new Event('resize'));
}

export const toggleDrawer = () => (S.open ? closeDrawer() : openDrawer());

/** Called by the router after every screen mounts: forget the old screen's detail, redraw if open. */
export function screenChanged(title) {
  S.title = title;
  S.moved = [];
  if (S.open) render();
}

export function setupDrawer(btn) {
  S.btn = btn;
  S.title = '';
  S.sub = el('p', { class: 'iw-sub' });
  S.body = el('div', { class: 'iw-body' });
  const closeBtn = el('button', { type: 'button', class: 'btn', 'aria-label': 'Close Inner working' }, icon('close', 20), 'Close');
  closeBtn.addEventListener('click', () => closeDrawer());
  S.drawer = el('aside', { class: 'iw-drawer', id: 'inner-drawer', hidden: true, 'aria-labelledby': 'iw-title' },
    el('div', { class: 'iw-head' },
      el('div', null, el('h2', { id: 'iw-title', tabindex: '-1' }, icon('learn', 26), 'Inner working'), S.sub),
      closeBtn),
    S.body);
  S.scrim = el('div', { class: 'iw-scrim', hidden: true, 'aria-hidden': 'true' });
  S.scrim.addEventListener('click', () => closeDrawer());
  document.body.append(S.scrim, S.drawer);
  btn.addEventListener('click', toggleDrawer);
  // Following a link inside the drawer keeps it open on wide screens (it explains the next screen too),
  // and closes it where it covers the page.
  S.drawer.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (a && window.matchMedia('(max-width: 1279px)').matches) closeDrawer(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // a glossary card or the tour handled it first
    if (e.key === 'Escape' && S.open) { e.preventDefault(); closeDrawer(); return; }
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === 'i' || e.key === 'I') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleDrawer(); }
  });
}
