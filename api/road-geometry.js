import https from 'https';
import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// Proxy for OpenStreetMap road geometry (Overpass). The browser CSP is 'self'
// only, so the map fetches street shapes from here; we call Overpass server-side.
// POST { names: ["Ealing Road", ...], bbox: { s, w, n, e } }
//  → { geom: { "ealing road": [ [[lat,lon],...], ... ] } }
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function overpass(q) {
  return new Promise((resolve) => {
    const body = 'data=' + encodeURIComponent(q);
    const req = https.request({ hostname: 'overpass-api.de', path: '/api/interpreter', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'PropMailPro/1.0' } },
      (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); });
    req.on('error', () => resolve(null));
    req.setTimeout(25000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  let body = {}; try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
  const names = (Array.isArray(body.names) ? body.names : []).slice(0, 120).filter(Boolean);
  const bb = body.bbox || {};
  if (!names.length || bb.s == null || bb.w == null || bb.n == null || bb.e == null) { sendJson(res, 400, { error: 'Send { names:[...], bbox:{s,w,n,e} }' }); return; }

  const want = new Set(names.map(key));
  const esc = names.map((n) => String(n).replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')).join('|');
  const q = `[out:json][timeout:25];way[highway][name~"^(${esc})$",i](${bb.s},${bb.w},${bb.n},${bb.e});out geom;`;
  const j = await overpass(q);
  const geom = {};
  for (const el of (j && j.elements) || []) {
    if (!el.geometry || !el.tags || !el.tags.name) continue;
    const k = key(el.tags.name);
    if (!want.has(k)) continue;
    (geom[k] = geom[k] || []).push(el.geometry.map((g) => [g.lat, g.lon]));
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { geom, roads: Object.keys(geom).length });
}
