// Data layer: loads every results file listed in schemas/index.json, validates it with validate.js
// and returns { data, status: 'ok' | 'missing' | 'invalid', errors } per file.
// The UI reads nothing else. A file that is missing or invalid is reported, never faked.
import { validate } from './validate.js';

/**
 * Directory listing of a static server (python http.server returns an HTML index). It lets us
 * avoid probing files that do not exist, which would log a 404 per file in the browser console.
 * Returns a Set of entry names, or null if the server gives no usable listing.
 */
async function listDir(url, fetchFn) {
  try {
    const res = await fetchFn(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) return null;
    const html = await res.text();
    const names = new Set();
    for (const m of html.matchAll(/href="([^"?#]+)"/g)) {
      let n = decodeURIComponent(m[1]);
      if (n.startsWith('/') || n.startsWith('.')) continue;
      names.add(n);
    }
    return names.size ? names : null;
  } catch (e) {
    return null;
  }
}

async function fetchJson(url, fetchFn) {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (res.status === 404) return { missing: true };
  if (!res.ok) return { error: `HTTP ${res.status}` };
  try {
    return { json: await res.json() };
  } catch (e) {
    return { error: `not valid JSON (${e.message})` };
  }
}

/** results/foo.json -> "results/foo.json"; tests/fixtures/ -> "ui/tests/fixtures/foo.json" */
function displayPrefix(base) {
  const clean = base.replace(/^(\.\.\/)+/, '');
  return clean.startsWith('results') ? clean : 'ui/' + clean;
}

/**
 * @param {{base:string, schemasBase:string, scenarios:string[], fetchFn?:Function}} opts
 * @returns {Promise<{base:string, files:Object, loadedAt:Date, get:Function, ok:Function, problems:Array}>}
 */
export async function loadResults({ base, schemasBase, scenarios, fetchFn }) {
  const f = fetchFn || ((u, o) => fetch(u, o));
  const prefix = displayPrefix(base);

  // schemas
  let index = null;
  const schemas = {};
  const idx = await fetchJson(schemasBase + 'index.json', f);
  if (idx.json) index = idx.json.files;

  // build the target list from the index (plans/*.json is expanded to the scenarios we look for)
  const targets = [];
  if (index) {
    for (const [pattern, schemaName] of Object.entries(index)) {
      if (pattern.includes('*')) {
        const dir = pattern.split('*')[0]; // "plans/"
        for (const s of scenarios) targets.push({ rel: `${dir}${s}.json`, schemaName });
      } else {
        targets.push({ rel: pattern, schemaName });
      }
    }
  }
  await Promise.all([...new Set(targets.map((t) => t.schemaName))].map(async (name) => {
    const r = await fetchJson(`${schemasBase}${name}.schema.json`, f);
    schemas[name] = r.json || null;
  }));

  // directory listings (root and each sub folder) to skip probing absent files
  const listings = {};
  const dirs = [...new Set(targets.map((t) => (t.rel.includes('/') ? t.rel.split('/')[0] + '/' : '')))];
  await Promise.all(dirs.map(async (d) => { listings[d] = await listDir(base + d, f); }));

  const files = {};
  await Promise.all(targets.map(async ({ rel, schemaName }) => {
    const key = rel.replace(/\.json$/, '');
    const entry = { key, rel, path: prefix + rel, schemaName, status: 'missing', data: null, errors: [] };
    files[key] = entry;
    const dir = rel.includes('/') ? rel.split('/')[0] + '/' : '';
    const listing = listings[dir];
    if (listing && !listing.has(rel.slice(dir.length))) return; // absent for sure, no request needed
    const r = await fetchJson(base + rel, f);
    if (r.missing) return;
    if (r.error) { entry.status = 'invalid'; entry.errors = [r.error]; return; }
    const schema = schemas[schemaName];
    entry.data = r.json;
    if (!schema) { entry.status = 'ok'; entry.unvalidated = true; return; }
    const errors = validate(schema, r.json);
    if (errors.length) { entry.status = 'invalid'; entry.errors = errors; entry.data = null; } else { entry.status = 'ok'; }
  }));

  const problems = Object.values(files).filter((e) => e.status !== 'ok').sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    base, prefix, files, problems, indexLoaded: !!index, loadedAt: new Date(),
    get: (key) => files[key] || { key, rel: key + '.json', path: prefix + key + '.json', status: 'missing', data: null, errors: [] },
    /** data of a file if it is ok, else null */
    ok: (key) => (files[key] && files[key].status === 'ok' ? files[key].data : null),
  };
}
