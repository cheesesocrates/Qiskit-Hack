// UI smoke test (Area 3). No npm packages: Node >= 22 (built-in WebSocket and fetch) drives a
// headless Chrome, Chromium or Edge over the DevTools protocol.
//
//   node scripts/ui_smoke.mjs                 # every screen, real results/
//   node scripts/ui_smoke.mjs --results tests/fixtures/   # the UI's mock fixtures instead
//   CHROME_PATH=/path/to/chrome node scripts/ui_smoke.mjs
//
// For each screen it does a full page load of /ui/?tiles=off#/<screen>, waits for the screen to
// render, and fails if there is any console error, uncaught exception, failed request (other than
// a results file that is legitimately missing), a "This screen failed to render" notice, or an
// empty screen. Screenshots go to results/tmp/ui_smoke/<screen>.png (git-ignored).
// Exit code: 0 all screens pass, 1 a screen failed, 2 no browser or no WebSocket support.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS = ['home', 'schedule', 'replay/watch', 'replay/rules', 'results/scoreboard', 'results/lottery',
  'results/uncertainty', 'results/scale', 'results/forecast', 'learn/how', 'learn/algorithms', 'learn/glossary'];
const shotName = (s) => s.replace('/', '-');
const args = process.argv.slice(2);
const argv = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const resultsArg = argv('--results');
const OUT = argv('--out') ? resolve(ROOT, argv('--out')) : join(ROOT, 'results', 'tmp', 'ui_smoke');
const [VW, VH] = (argv('--viewport') || '1440x900').split('x').map(Number);
const FULL = args.includes('--full');
const SCALE = Number(argv('--scale') || 1);          // screenshot scale (0.5 keeps committed PNGs small)
const QUICK = args.includes('--no-checks');          // skip the size, target, keyboard and flow checks

// Runs in the page: text under 14px and interactive targets under 44px (48px for the primary action).
// Inline glossary terms and links inside running text are exempt (WCAG 2.5.8 inline exception).
const SIZE_CHECK = `(() => {
  const vis = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; const p = t.parentElement;
    if (!p || !t.textContent.trim() || !vis(p) || p.closest('script,style,.leaflet-control-attribution,.sr-only,.skip')) continue;
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs < 13.95) small.push(fs.toFixed(1) + 'px "' + t.textContent.trim().slice(0, 30) + '"');
  }
  const tiny = [];
  const sel = 'a[href], button, input, select, summary, [role=radio], [role=button]';
  for (const n of document.querySelectorAll(sel)) {
    if (!vis(n) || n.closest('.sr-only') || n.classList.contains('gl-term') || n.matches('a.skip')) continue;
    if (n.closest('p, li, dd, .lede, .subtle, .howto, .leaflet-control-attribution, .crumbs ol')) continue;
    const r = n.getBoundingClientRect();
    const min = n.classList.contains('btn--primary') ? 47.5 : 43.5;
    if (r.height < min || r.width < 43.5) tiny.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (n.getAttribute('aria-label') || n.textContent.trim().slice(0, 24) || n.tagName));
  }
  return { small: small.slice(0, 6), nSmall: small.length, tiny: tiny.slice(0, 6), nTiny: tiny.length };
})()`;

const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 2500);

const FOCUS_PROBE = `(() => { const a = document.activeElement; if (!a || a === document.body) return null;
  const cs = getComputedStyle(a); const r = a.getBoundingClientRect();
  return { id: a.tagName + '|' + (a.textContent || '').trim().slice(0, 20) + '|' + Math.round(r.top + window.scrollY) + '|' + Math.round(r.left),
           ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none' }; })()`;

const FLOW_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const shown = () => [...document.querySelectorAll('.expert-only')].some((n) => n.getBoundingClientRect().height > 0);
  const exp = document.querySelector('[role=radio][data-mode="expert"]');
  if (!exp) return ['no Expert switch'];
  exp.click(); await wait(900);
  if (document.body.dataset.mode !== 'expert') out.push('Expert mode did not switch');
  if (!shown()) out.push('Expert mode shows no expert detail');
  document.querySelector('[role=radio][data-mode="beginner"]').click(); await wait(900);
  if (shown()) out.push('Beginner mode still shows expert detail');
  const g = document.querySelector('#main .gl-term');
  if (!g) out.push('no glossary term on the Scoreboard'); else {
    g.click(); await wait(200);
    if (!document.querySelector('.gl-pop')) out.push('glossary term did not open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(100);
    if (document.querySelector('.gl-pop')) out.push('Escape did not close the glossary card');
  }
  const tb = document.getElementById('tour-btn');
  if (!tb) out.push('no Tour button'); else {
    tb.click(); await wait(1500);
    if (!document.querySelector('.tour-card')) out.push('tour did not open');
    for (let i = 0; i < 7; i++) {
      const nx = [...document.querySelectorAll('.tour-card button')].find((b) => /Next|Finish/.test(b.textContent));
      if (nx) nx.click();
      await wait(1000);
    }
    const last = document.querySelector('.tour-card .tour-step');
    if (!last || !/8 of 8/.test(last.textContent)) out.push('tour did not reach step 8 (at ' + (last ? last.textContent : 'none') + ')');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(200);
    if (document.querySelector('.tour-card')) out.push('Escape did not close the tour');
  }
  return out;
})()`;

// Per-screen interactions (run in the page; `main`, `byText`, `wait` are in scope). Each returns
// a short description of what it did. A missing control is not an error when the screen shows
// "not available" instead (the control does not exist then).
const INTERACT = {
  schedule: `const play = main.querySelector('.play-btn'); if (!play) return 'no play button';
         play.click(); await wait(2200); play.click();
         const d = main.querySelector('.details-toggle'); if (d) { d.click(); await wait(400); }
         return 'played hours, opened details';`,
  'results/scoreboard': `main.querySelectorAll('details').forEach((x) => { x.open = true; }); return 'opened details';`,
  'replay/rules': `const edit = byText('button', /Edit this plan/); if (!edit) return 'no edit button';
          edit.click(); await wait(200);
          const cell = main.querySelector('button.pg-cell'); if (!cell) return 'interaction error: no editable cell';
          cell.click(); await wait(200);
          const rr = byText('button', /Round-robin/); if (rr) rr.click(); await wait(200);
          return 'edited a cell, switched example';`,
  'replay/watch': `const play = main.querySelector('.btn--primary'); if (!play) return 'no play button';
           play.click(); await wait(3500); play.click(); return 'played frames';`,
  'results/uncertainty': `main.querySelectorAll('details').forEach((x) => { x.open = true; }); return 'opened notes';`,
  'results/forecast': `const all = byText('button', /All hours/); if (!all) return 'no period control';
             all.click(); await wait(600); return 'switched to all hours';`,
};

if (typeof WebSocket === 'undefined') {
  console.error('ui_smoke: this Node has no built-in WebSocket (need Node 22 or newer)');
  process.exit(2);
}

function findBrowser() {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

// Static server over the repo root with directory listings (the UI uses them to skip absent files).
function serve() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const full = normalize(join(ROOT, urlPath));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (!existsSync(full)) { res.writeHead(404).end('not found'); return; }
    const st = statSync(full);
    if (st.isDirectory()) {
      const index = join(full, 'index.html');
      if (urlPath.endsWith('/') && existsSync(index)) {
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(readFileSync(index));
        return;
      }
      if (!urlPath.endsWith('/')) { res.writeHead(301, { location: urlPath + '/' }).end(); return; }
      const items = readdirSync(full, { withFileTypes: true })
        .map((d) => `<li><a href="${encodeURIComponent(d.name)}${d.isDirectory() ? '/' : ''}">${d.name}</a></li>`).join('');
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(`<html><body><ul>${items}</ul></body></html>`);
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(full));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function launch(browser) {
  const profile = mkdtempSync(join(tmpdir(), 'fairshed-smoke-'));
  const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--window-size=1440,960', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('browser did not print a DevTools URL within 30 s')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) { clearTimeout(timer); ok({ proc, wsUrl: m[1], profile }); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); fail(new Error(`browser exited early (${code}): ${buf.slice(-400)}`)); });
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static open(url) {
    return new Promise((ok, fail) => {
      const ws = new WebSocket(url);
      const c = new CDP(ws);
      ws.onopen = () => ok(c);
      ws.onerror = (e) => fail(new Error('WebSocket error ' + (e.message || '')));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        if (msg.id && c.pending.has(msg.id)) {
          const { ok: res, fail: rej } = c.pending.get(msg.id);
          c.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
        } else if (msg.method) {
          c.handlers.forEach((h) => h(msg));
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  on(h) { this.handlers.push(h); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = findBrowser();
  if (!browser) { console.error('ui_smoke: no Chrome, Chromium or Edge found (set CHROME_PATH)'); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const { proc, wsUrl, profile } = await launch(browser);
  const cdp = await CDP.open(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);

  let events = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
      events.push({ kind: 'console.error', text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      events.push({ kind: 'exception', text: (d.exception && d.exception.description) || d.text });
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      events.push({ kind: 'log.error', text: `${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim(), url: msg.params.entry.url || '' });
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      events.push({ kind: 'http', text: `HTTP ${msg.params.response.status} ${msg.params.response.url}`, url: msg.params.response.url });
    }
  });
  await S('Runtime.enable');
  await S('Log.enable');
  await S('Network.enable');
  await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 600 });

  const query = new URLSearchParams({ tiles: 'off' });
  if (resultsArg) query.set('results', resultsArg);
  let failed = 0;
  console.log(`ui_smoke: ${browser}`);
  for (const screen of SCREENS) {
    events = [];
    query.set('smoke', shotName(screen));  // unique query string forces a full load per screen
    const url = `http://127.0.0.1:${port}/ui/?${query}#/${screen}`;
    await S('Page.navigate', { url });
    // wait until the app has loaded results and mounted something in <main>
    let state = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const r = await S('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const m = document.getElementById('main');
        return { ready: !!window.__fairshed && !!m && m.childElementCount > 0,
                 text: m ? m.innerText.length : 0,
                 failedRender: !!(m && /This screen failed to render/.test(m.innerText)),
                 na: m ? m.querySelectorAll('.na').length : 0,
                 title: document.getElementById('screen-title') && document.getElementById('screen-title').textContent,
                 status: document.getElementById('status') && document.getElementById('status').textContent,
                 banner: document.getElementById('banner') ? document.getElementById('banner').innerText.slice(0, 300) : '' };
      })()` });
      state = r.result.value;
      if (state && state.ready) break;
    }
    await sleep(WAIT_MS);  // let charts, maps and animations settle
    const r2 = await S('Runtime.evaluate', { returnByValue: true, expression: `(() => { const m = document.getElementById('main');
      return { text: m ? m.innerText.length : 0, failedRender: !!(m && /This screen failed to render/.test(m.innerText)), na: m ? m.querySelectorAll('.na').length : 0 }; })()` });
    Object.assign(state || {}, r2.result.value);
    const shot = await S('Page.captureScreenshot', SCALE === 1 ? { format: 'png', captureBeyondViewport: FULL }
      : { format: 'png', clip: { x: 0, y: 0, width: VW, height: VH, scale: SCALE } });
    writeFileSync(join(OUT, `${shotName(screen)}.png`), Buffer.from(shot.data, 'base64'));

    // exercise the main controls of the screen; any console error they cause fails the screen
    let interaction = '';
    if (INTERACT[screen]) {
      const r = await S('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
        const main = document.getElementById('main');
        const byText = (sel, re) => [...main.querySelectorAll(sel)].find((n) => re.test(n.textContent));
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        try { ${INTERACT[screen]} } catch (e) { return 'interaction error: ' + e.message; }
      })()` });
      interaction = r.result.value || '';
      await sleep(800);
      const r3 = await S('Runtime.evaluate', { returnByValue: true, expression: `(() => { const m = document.getElementById('main');
        return !!(m && /This screen failed to render/.test(m.innerText)); })()` });
      if (r3.result.value && state) state.failedRender = true;
    }

    // legibility, target size and keyboard checks
    const checkProblems = [];
    if (!QUICK) {
      await S('Runtime.evaluate', { expression: 'window.scrollTo(0, 0); document.querySelectorAll(".gl-pop").forEach((n) => n.remove());' });
      const sz = (await S('Runtime.evaluate', { returnByValue: true, expression: SIZE_CHECK })).result.value;
      if (sz.nSmall) checkProblems.push(`${sz.nSmall} text runs under 14px: ${sz.small.join('; ')}`);
      if (sz.nTiny) checkProblems.push(`${sz.nTiny} targets under 44px: ${sz.tiny.join('; ')}`);
      // keyboard only: Tab through the page; every stop must be visible and show a focus ring
      await S('Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0);' });
      const seen = new Set();
      let noRing = 0;
      for (let k = 0; k < 18; k++) {
        await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        const f = (await S('Runtime.evaluate', { returnByValue: true, expression: FOCUS_PROBE })).result.value;
        if (!f) continue;
        seen.add(f.id);
        if (!f.ring) noRing++;
      }
      if (seen.size < 6) checkProblems.push(`keyboard: only ${seen.size} distinct focus stops in 18 Tab presses`);
      if (noRing) checkProblems.push(`keyboard: ${noRing} focus stops without a visible focus ring`);
    }

    // a 404 for a results file is how the dashboard learns that a file is absent: allowed, reported
    const fatal = events.filter((e) => !((e.kind === 'http' || e.kind === 'log.error') && /\/results\/.*\.json/.test(e.url || '') && /404/.test(e.text + (e.kind === 'log.error' ? ' 404' : ''))));
    const problems = [];
    if (/^interaction error/.test(interaction)) problems.push(interaction);
    if (!state || !state.ready) problems.push('screen never rendered');
    if (state && state.failedRender) problems.push('"This screen failed to render" shown');
    if (state && state.text < 40) problems.push(`screen almost empty (${state.text} characters)`);
    problems.push(...fatal.map((e) => `${e.kind}: ${e.text}`));
    problems.push(...checkProblems);
    const ok = problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${screen.padEnd(20)} ${state ? `${state.text} chars, ${state.na} not-available notices` : ''}${interaction ? `; ${interaction}` : ''}`);
    for (const p of problems) console.log(`        ${p}`);
  }
  if (!QUICK) {
    // flows: Beginner and Expert toggle, a glossary term, the guided tour (on the Scoreboard)
    events = [];
    query.set('smoke', 'flows');
    await S('Page.navigate', { url: `http://127.0.0.1:${port}/ui/?${query}#/results/scoreboard` });
    await sleep(WAIT_MS + 800);
    const flow = (await S('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: FLOW_SCRIPT })).result.value;
    const flowFatal = events.filter((e) => !((e.kind === 'http' || e.kind === 'log.error') && /\/results\/.*\.json/.test(e.url || '')));
    const fp = [...(flow || ['flow script failed']), ...flowFatal.map((e) => `${e.kind}: ${e.text}`)];
    if (fp.length) failed++;
    console.log(`${fp.length ? 'FAIL' : 'PASS'}  ${'flows'.padEnd(20)} Expert and Beginner, glossary card, 8-step tour`);
    for (const p of fp) console.log(`        ${p}`);
  }
  if (resultsArg === null) {
    const r = await S('Runtime.evaluate', { returnByValue: true, expression: 'document.getElementById("status").textContent' });
    console.log(`status bar: ${r.result.value}`);
  }
  console.log(`screenshots: ${OUT}${sep}`);
  console.log(failed ? `ui_smoke: ${failed} check(s) FAILED` : `ui_smoke: all ${SCREENS.length} screens passed${QUICK ? '' : ' (size, target, keyboard and flow checks included)'}`);
  try { await cdp.send('Browser.close'); } catch (e) { /* already closing */ }
  proc.kill();
  server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows may hold the profile briefly */ }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ui_smoke crashed:', e); process.exit(1); });
