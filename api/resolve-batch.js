import { sendJson, guardOrigin, readBody, reverseGeocode, EPC_BASE, fetchJson } from '../lib/helpers.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';

export const config = { maxDuration: 60 };

// Batch address resolver — built for a whole search at once (200+ listings).
// Key wins vs resolving one-by-one from the browser:
//  · ONE server call processes every listing, sharing in-process caches, so a
//    postcode/building is looked up once no matter how many listings share it.
//  · Gets the exact postcode from the map pin's NEARBY postcodes (free, fast,
//    reliable) instead of fetching each Rightmove page (slow, gets rate-limited).
//  · Returns ONLY precise results (exact house / building / exact-postcode) —
//    never a bare street name.

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const leadNum = (s) => ((String(s || '').trim().match(/^(\d+[a-z]?)/i) || [])[1] || '').toLowerCase();
function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '').replace(/^(flat|apartment|apt|unit|plot)\s+\w+\s+/, '');
}
const ROAD_WORD = /\b(road|street|avenue|lane|close|drive|way|gardens?|grove|crescent|place|terrace|hill|park|rise|walk|row|green|square|vale|parade|broadway)\b/i;
const BLD_WORD = /\b(house|court|lodge|apartments?|point|mansions?|heights|towers?|building|lofts?|wharf|hall|manor|residence|development|villas?|mews|chase|gate|quarter|works|mill)\b/i;
function buildingNameOf(display) {
  let seg = (display || '').split(',')[0].trim().replace(/^\s*(flat|apartment|apt|unit|room|studio)\s+[\w-]+\s*/i, '').trim();
  if (!seg || seg.length < 3) return '';
  const last = seg.split(/\s+/).slice(-1)[0];
  if (ROAD_WORD.test(last) && !BLD_WORD.test(seg)) return '';
  return seg;
}

const _mem = new Map(); // shared across every listing in the batch
async function epcPostcodeAll(pc) {
  const KEY = process.env.EPC_API_KEY || '';
  if (!KEY) return [];
  const mk = pc.toUpperCase().replace(/\s+/g, '');
  if (_mem.has(mk)) return _mem.get(mk);
  if (storeConfigured()) { const c = await getJSON('pcall:' + mk, null); if (c) { _mem.set(mk, c); return c; } }
  let out = [];
  try {
    const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
    let { status, json } = await fetchJson(url, KEY);
    if (status === 429) { await new Promise((r) => setTimeout(r, 600)); ({ status, json } = await fetchJson(url, KEY)); }
    const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
    const seen = new Map();
    for (const r of data) {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const p = (r.postcode || '').replace(/\+/g, ' ');
      const full = tcAddr([...lines, r.postTown, p].filter(Boolean).join(', '));
      const k = full.toLowerCase();
      if (full && !seen.has(k)) seen.set(k, { line1: tcAddr(r.addressLine1 || lines[0] || ''), fullAddress: full, postcode: p });
    }
    out = [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
  } catch { out = []; }
  _mem.set(mk, out);
  if (storeConfigured() && out.length) await setJSON('pcall:' + mk, out).catch(() => {});
  return out;
}

const _memRev = new Map();
async function nearbyPostcodes(lat, lon, area) {
  const k = lat.toFixed(4) + ',' + lon.toFixed(4);
  let pcs = _memRev.get(k);
  if (!pcs) { pcs = await reverseGeocode(lat, lon); _memRev.set(k, pcs); }
  return pcs.filter((pc) => !area || (pc || '').toUpperCase().startsWith(area)).slice(0, 8);
}

const FLAT = /flat|apartment|maisonette|studio/i;
async function resolveOne(p) {
  const disp = p.displayAddress || p.address || '';
  if (p.lat == null || p.lon == null) return null;
  const seg0 = disp.split(',')[0].trim();
  const hasNum = /\d/.test(seg0) || /^(flat|apartment|apt|unit)/i.test(seg0);
  const num = leadNum(seg0) || ((seg0.match(/\b(\d+[a-z]?)\b/) || [])[1] || '').toLowerCase();
  const isFlat = FLAT.test(p.type || '') || /^(flat|apartment)/i.test(seg0);
  const building = isFlat ? buildingNameOf(disp) : '';
  const street = streetOf(disp);
  const area = String(p.haCode || '').toUpperCase().replace(/\d.*$/, '');
  const pcs = await nearbyPostcodes(p.lat, p.lon, area);

  for (const pc of pcs) {
    const units = await epcPostcodeAll(pc);
    if (!units.length) continue;
    let set = null, level = null;
    if (building) { const m = units.filter((u) => norm(u.fullAddress).includes(norm(building))); if (m.length) { set = m; level = 'building'; } }
    if (!set && street) { const m = units.filter((u) => norm(u.fullAddress).includes(street)); if (m.length) { set = m; level = isFlat ? 'building' : 'postcode'; } }
    if (!set) continue;

    // The listing publishes a number → exact address.
    if (hasNum && num) {
      const m = set.find((u) => leadNum(u.line1) === num || leadNum(u.fullAddress) === num);
      if (m) return { id: p.id, level: 'exact', address: m.fullAddress, postcode: m.postcode, units: [m.fullAddress] };
    }
    if (isFlat) {
      const first = set[0].fullAddress.replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '');
      return { id: p.id, level: 'building', address: first, postcode: set[0].postcode, building: tcAddr(building || street), units: set.map((u) => u.fullAddress) };
    }
    // House with no number on the listing → the homes on this exact postcode.
    // Only treat as precise when it's a short block (a few houses), else skip.
    if (set.length <= 8) {
      return { id: p.id, level: 'postcode', address: [tcAddr(street), set[0].postcode].filter(Boolean).join(', '), postcode: set[0].postcode, building: tcAddr(street), units: set.map((u) => u.fullAddress) };
    }
    return null;
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const j = i++; try { out[j] = await fn(items[j]); } catch { out[j] = null; } }
  }));
  return out;
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ }
  const listings = Array.isArray(body.listings) ? body.listings.slice(0, 60) : [];
  if (!listings.length) { sendJson(res, 400, { error: 'Send { listings: [...] }' }); return; }

  const results = (await mapLimit(listings, 6, resolveOne)).filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { requested: listings.length, resolved: results.length, results });
}
