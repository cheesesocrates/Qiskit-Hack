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
const SCREENS = ['plan', 'compare', 'audit', 'replay', 'risk', 'scale', 'forecast'];
const OUT = join(ROOT, 'results', 'tmp', 'ui_smoke');
const args = process.argv.slice(2);
const resultsArg = args.includes('--results') ? args[args.indexOf('--results') + 1] : null;
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 2500);

// Per-screen interactions (run in the page; `main`, `byText`, `wait` are in scope). Each returns
// a short description of what it did. A missing control is not an error when the screen shows
// "not available" instead (the control does not exist then).
const INTERACT = {
  plan: `const play = main.querySelector('.play-btn'); if (!play) return 'no play button';
         play.click(); await wait(2200); play.click();
         const d = main.querySelector('.details-toggle'); if (d) { d.click(); await wait(400); }
         return 'played hours, opened details';`,
  compare: `main.querySelectorAll('details').forEach((x) => { x.open = true; }); return 'opened details';`,
  audit: `const edit = byText('button', /Edit this plan/); if (!edit) return 'no edit button';
          edit.click(); await wait(200);
          const cell = main.querySelector('button.pg-cell'); if (!cell) return 'interaction error: no editable cell';
          cell.click(); await wait(200);
          const rr = byText('button', /Round-robin/); if (rr) rr.click(); await wait(200);
          return 'edited a cell, switched example';`,
  replay: `const play = main.querySelector('.btn--primary'); if (!play) return 'no play button';
           play.click(); await wait(3500); play.click(); return 'played frames';`,
  risk: `main.querySelectorAll('details').forEach((x) => { x.open = true; }); return 'opened notes';`,
  forecast: `const all = byText('button', /All hours/); if (!all) return 'no period control';
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

  const query = new URLSearchParams({ tiles: 'off' });
  if (resultsArg) query.set('results', resultsArg);
  let failed = 0;
  console.log(`ui_smoke: ${browser}`);
  for (const screen of SCREENS) {
    events = [];
    query.set('smoke', screen);  // unique query string forces a full load per screen
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
    const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(OUT, `${screen}.png`), Buffer.from(shot.data, 'base64'));

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

    // a 404 for a results file is how the dashboard learns that a file is absent: allowed, reported
    const fatal = events.filter((e) => !((e.kind === 'http' || e.kind === 'log.error') && /\/results\/.*\.json/.test(e.url || '') && /404/.test(e.text + (e.kind === 'log.error' ? ' 404' : ''))));
    const problems = [];
    if (/^interaction error/.test(interaction)) problems.push(interaction);
    if (!state || !state.ready) problems.push('screen never rendered');
    if (state && state.failedRender) problems.push('"This screen failed to render" shown');
    if (state && state.text < 40) problems.push(`screen almost empty (${state.text} characters)`);
    problems.push(...fatal.map((e) => `${e.kind}: ${e.text}`));
    const ok = problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${screen.padEnd(9)} ${state ? `${state.text} chars, ${state.na} not-available notices` : ''}${interaction ? `; ${interaction}` : ''}`);
    for (const p of problems) console.log(`        ${p}`);
  }
  if (resultsArg === null) {
    const r = await S('Runtime.evaluate', { returnByValue: true, expression: 'document.getElementById("status").textContent' });
    console.log(`status bar: ${r.result.value}`);
  }
  console.log(`screenshots: ${OUT}${sep}`);
  console.log(failed ? `ui_smoke: ${failed} of ${SCREENS.length} screens FAILED` : `ui_smoke: all ${SCREENS.length} screens passed`);
  try { await cdp.send('Browser.close'); } catch (e) { /* already closing */ }
  proc.kill();
  server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows may hold the profile briefly */ }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ui_smoke crashed:', e); process.exit(1); });
