// Leaflet map of the (synthetic) feeders. Offline-safe: a canvas tile-grid layer is always drawn; OpenStreetMap
// tiles are tried on top at low opacity and dropped silently on the first tile error. Feeder markers are labelled
// (name + state icon + state label), coloured by state, cross-fade between states and avoid overlapping labels.
// Options for a full-screen map with floating panels: `padding()` returns {tl:[x,y], br:[x,y]} in pixels so the
// feeders are fitted (and popups auto-panned) clear of the panels; `obstacles()` returns the floating elements
// that labels must not sit under; `zoomPosition` and `tileOpacity` style it.
import { el } from '../util.js';
import { STATE, iconSvg } from '../icons.js';
import * as motion from '../motion.js';

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function stateColors() {
  return {
    on: { fg: cssVar('--on'), tint: cssVar('--on-tint') },
    off: { fg: cssVar('--off'), tint: cssVar('--off-tint') },
    protected: { fg: cssVar('--protected'), tint: cssVar('--protected-tint') },
  };
}

function makeGridLayer() {
  const L = window.L;
  const Grid = L.GridLayer.extend({
    createTile(coords) {
      const size = this.getTileSize();
      const tile = L.DomUtil.create('canvas', 'leaflet-tile');
      const dpr = window.devicePixelRatio || 1;
      tile.width = size.x * dpr; tile.height = size.y * dpr;
      tile.style.width = size.x + 'px'; tile.style.height = size.y + 'px';
      const ctx = tile.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 1;
      for (let p = 0; p < size.x; p += 64) { // minor lines
        ctx.strokeStyle = p === 0 ? 'rgba(138,148,168,0.20)' : 'rgba(138,148,168,0.08)';
        ctx.beginPath(); ctx.moveTo(p + 0.5, 0); ctx.lineTo(p + 0.5, size.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p + 0.5); ctx.lineTo(size.x, p + 0.5); ctx.stroke();
      }
      return tile;
    },
  });
  return new Grid({ tileSize: 256, className: 'grid-tiles', pane: 'tilePane' });
}

export function createFeederMap(host, opts) {
  const L = window.L;
  if (!L) throw new Error('Leaflet is not loaded');
  const { debug = false, tiles = true, buildPopup, zoomPosition = 'bottomleft', tileOpacity = 0.32 } = opts;
  const pad = () => (opts.padding ? opts.padding() : { tl: [110, 90], br: [110, 90] });
  let focusIdx = null;
  let feeders = opts.feeders;
  let colors = stateColors();
  let userMoved = false;
  let selected = null;
  let markers = [];
  let lastStates = null;
  let lastMeta = {};
  let popup = null;
  let destroyed = false;

  const map = L.map(host, { zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 8, maxZoom: 16, keyboard: true });
  map.setView([24.88, 67.07], 11);
  L.control.zoom({ position: zoomPosition }).addTo(map);
  makeGridLayer().addTo(map);

  // optional OSM tiles, dropped silently when offline or on the first error
  let tileLayer = null;
  let attribution = null;
  function dropTiles() {
    if (!tileLayer) return;
    map.removeLayer(tileLayer); tileLayer = null;
    if (attribution) { map.removeControl(attribution); attribution = null; }
  }
  if (tiles && navigator.onLine !== false) {
    tileLayer = L.tileLayer(OSM, { opacity: tileOpacity, maxZoom: 19, className: 'osm-tiles', crossOrigin: true, errorTileUrl: '' });
    tileLayer.on('tileerror', dropTiles);
    tileLayer.addTo(map);
    attribution = L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('Map tiles: OpenStreetMap contributors').addTo(map);
  }

  map.on('dragstart zoomstart', (e) => { if (e.originalEvent || e.type === 'dragstart') userMoved = true; });

  function fit(animate = false) {
    if (!feeders.length) return;
    const pts = feeders.map((f) => [f.lat, f.lon]);
    const b = L.latLngBounds(pts);
    if (b.getNorthEast().equals(b.getSouthWest())) { map.setView(pts[0], 12); return; }
    const p = pad();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: 13.5, animate: animate && !reduce, duration: 0.45 });
  }

  // ---------- markers ----------
  function buildMarker(f, i) {
    const dot = el('span', { class: 'fm-dot' });
    const lead = el('span', { class: 'fm-lead' });
    const iconLayers = ['on', 'off', 'protected'].map((k) => el('span', { class: `fm-ic fm-ic--${k}`, html: iconSvg(STATE[k].icon, 16) }));
    const stateLayers = ['on', 'off', 'protected'].map((k) => el('span', { class: `fm-st fm-st--${k}` }, STATE[k].label));
    const dbg = debug ? el('span', { class: 'fm-dbg' }, '') : null;
    const chip = el('button', { type: 'button', class: 'fm-chip', 'aria-label': f.name },
      el('span', { class: 'fm-row' }, el('span', { class: 'fm-icons' }, iconLayers), el('span', { class: 'fm-name' }, f.name)),
      el('span', { class: 'fm-states' }, stateLayers), dbg);
    const root = el('div', { class: 'fm', dataset: { id: f.id } }, lead, dot, chip);
    const marker = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: 'fm-root', html: root, iconSize: [0, 0] }), keyboard: false, riseOnHover: true });
    marker.on('click', () => openFor(i));
    marker.addTo(map);
    return { f, i, marker, root, chip, dot, lead, iconLayers, stateLayers, dbg, state: null, dx: 0, dy: 0 };
  }

  function clearMarkers() { markers.forEach((m) => map.removeLayer(m.marker)); markers = []; }

  function paintFocus() { markers.forEach((m, i) => m.root.classList.toggle('is-focus', i === focusIdx)); }

  function build() {
    clearMarkers();
    markers = feeders.map(buildMarker);
    paintFocus();
    if (!userMoved) fit();
    if (lastStates) applyStates(lastStates, lastMeta, false);
    requestAnimationFrame(layoutLabels);
  }

  function paintState(m, st, animate) {
    const c = colors[st.key];
    const idx = ['on', 'off', 'protected'].indexOf(st.key);
    const first = m.state === null;
    m.state = st.key;
    m.root.classList.remove('is-on', 'is-off', 'is-protected');
    m.root.classList.add(st.cls);
    m.chip.setAttribute('aria-label', `${m.f.name}: ${st.label}`);
    const dur = animate && !first ? 0.28 : 0;
    m.iconLayers.forEach((n, k) => motion.to(n, { opacity: k === idx ? 1 : 0, duration: dur }));
    m.stateLayers.forEach((n, k) => motion.to(n, { opacity: k === idx ? 1 : 0, duration: dur }));
    motion.to(m.chip, { borderColor: c.fg, backgroundColor: c.tint, duration: dur });
    motion.to(m.dot, { backgroundColor: c.fg, duration: dur });
    m.chip.style.color = c.fg;
    if (first) { // no tween on first paint: set directly so nothing flashes
      m.chip.style.borderColor = c.fg; m.chip.style.backgroundColor = c.tint; m.dot.style.backgroundColor = c.fg;
      m.iconLayers.forEach((n, k) => { n.style.opacity = k === idx ? 1 : 0; });
      m.stateLayers.forEach((n, k) => { n.style.opacity = k === idx ? 1 : 0; });
    }
  }

  function applyStates(states, meta, animate) {
    markers.forEach((m, i) => {
      const st = states[i];
      if (st && m.state !== st.key) paintState(m, st, animate);
      const changed = meta.changed && meta.changed.has(i);
      m.root.classList.toggle('changed', !!changed);
      if (changed && animate) {
        motion.set(m.chip, { outlineOffset: 11 });
        motion.to(m.chip, { outlineOffset: 3, duration: 0.4 });
      }
      if (m.dbg && meta.hour !== undefined && meta.N !== undefined) {
        m.dbg.textContent = `q=${meta.hour * meta.N + m.f.id}  bit=${meta.bits ? meta.bits[meta.hour * meta.N + m.f.id] : '-'}`;
      }
    });
  }

  // ---------- label placement: greedy, avoids overlap among labels and dots ----------
  function layoutLabels() {
    if (destroyed || !markers.length) return;
    const size = map.getSize();
    const pts = markers.map((m) => map.latLngToContainerPoint([m.f.lat, m.f.lon]));
    const boxes = [];
    const dots = pts.map((p) => ({ x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 }));
    // floating cards and panels over the map, in map-container pixels (closed panels sit off-screen)
    const hostR = host.getBoundingClientRect();
    const blocks = (opts.obstacles ? opts.obstacles() : []).filter(Boolean).map((n) => n.getBoundingClientRect())
      .filter((r) => r.width && r.height).map((r) => ({ x0: r.left - hostR.left - 6, y0: r.top - hostR.top - 6, x1: r.right - hostR.left + 6, y1: r.bottom - hostR.top + 6 }));
    const overlap = (a, b) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
    const order = markers.map((_, i) => i).sort((a, b) => pts[a].y - pts[b].y);
    for (const i of order) {
      const m = markers[i];
      const w = m.chip.offsetWidth || 130;
      const h = m.chip.offsetHeight || 44;
      const gap = 14;
      const cands = [];
      for (const k of [1, 1.9, 2.8, 3.8]) {
        const dx = (w / 2 + gap) * k, dy = (h / 2 + gap) * k;
        cands.push([dx, 0], [-dx, 0], [0, -dy], [0, dy], [dx * 0.8, -dy * 0.8], [-dx * 0.8, -dy * 0.8], [dx * 0.8, dy * 0.8], [-dx * 0.8, dy * 0.8]);
      }
      let best = null, bestScore = Infinity;
      for (const [dx, dy] of cands) {
        const box = { x0: pts[i].x + dx - w / 2, y0: pts[i].y + dy - h / 2, x1: pts[i].x + dx + w / 2, y1: pts[i].y + dy + h / 2 };
        let score = 0;
        for (const b of boxes) if (overlap(box, b)) score += 1000;
        for (const b of blocks) if (overlap(box, b)) score += 900;
        dots.forEach((d, j) => { if (overlap(box, d)) score += j === i ? 500 : 800; });
        if (box.x0 < 4 || box.y0 < 4 || box.x1 > size.x - 4 || box.y1 > size.y - 4) score += 1100; // off-screen is worse than a small overlap
        score += Math.hypot(dx, dy) * 0.05;
        if (score < bestScore) { bestScore = score; best = { dx, dy, box }; }
        if (score < 20) break;
      }
      boxes.push(best.box);
      m.dx = best.dx; m.dy = best.dy;
      m.chip.style.transform = `translate(calc(-50% + ${best.dx}px), calc(-50% + ${best.dy}px))`;
      const len = Math.hypot(best.dx, best.dy);
      const ang = Math.atan2(best.dy, best.dx) * 180 / Math.PI;
      m.lead.style.width = Math.max(0, len - 8) + 'px';
      m.lead.style.transform = `rotate(${ang}deg)`;
    }
  }
  map.on('zoomend moveend resize', layoutLabels);

  // ---------- popup ----------
  function openFor(i) {
    selected = i;
    const m = markers[i];
    if (!m || !buildPopup) return;
    if (popup) map.closePopup(popup);
    const p = pad();
    popup = L.popup({ className: 'fs-popup', maxWidth: 360, minWidth: 300, offset: [m.dx * 0, -4], autoPanPaddingTopLeft: p.tl, autoPanPaddingBottomRight: p.br, closeButton: true })
      .setLatLng([m.f.lat, m.f.lon]).setContent(buildPopup(i));
    popup.on('remove', () => { if (selected === i) selected = null; });
    popup.openOn(map);
  }

  const ro = new ResizeObserver(() => { if (destroyed) return; map.invalidateSize({ pan: false }); if (!userMoved) fit(); layoutLabels(); });
  ro.observe(host);

  build();

  return {
    map,
    setStates(states, meta = {}, animate = true) { lastStates = states; lastMeta = meta; applyStates(states, meta, animate); },
    setFeeders(newFeeders) { feeders = newFeeders; selected = null; if (popup) map.closePopup(popup); build(); },
    refreshPopup() { if (selected !== null && popup && map.hasLayer(popup)) popup.setContent(buildPopup(selected)); },
    closePopup() { if (popup) map.closePopup(popup); },
    /** Open the reason popup of feeder index i (used by the "This hour" list). */
    open(i) { openFor(i); },
    /** Ring one feeder (the reader's own area); null clears it. */
    focus(i) { focusIdx = i; paintFocus(); },
    /** Fly to one feeder, keeping it clear of the panels; with {open: true} its popup opens once the map arrives. */
    flyTo(i, { open = false } = {}) {
      const m = markers[i]; if (!m) return;
      if (open) map.once('moveend', () => { if (!destroyed) openFor(i); });
      userMoved = true;
      const p = pad();
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const z = Math.max(map.getZoom(), 13);
      const target = map.unproject(map.project([m.f.lat, m.f.lon], z).add([(p.br[0] - p.tl[0]) / 2, (p.br[1] - p.tl[1]) / 2]), z);
      if (reduce) map.setView(target, z); else map.flyTo(target, z, { duration: 0.6 });
    },
    /** Fit every feeder again (after a panel opens or closes), unless the reader moved the map. */
    refit(force = false) { map.invalidateSize({ pan: false }); if (force) userMoved = false; if (!userMoved) fit(true); }, // size first: the area may just have narrowed
    selected: () => selected,
    relayout: layoutLabels,
    destroy() { destroyed = true; ro.disconnect(); map.remove(); },
  };
}
