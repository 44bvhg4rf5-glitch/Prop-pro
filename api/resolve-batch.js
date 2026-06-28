import { sendJson, guardOrigin, readBody, reverseGeocode, EPC_BASE, fetchJson, FULL_POSTCODE } from '../lib/helpers.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { rightmoveProperty } from '../lib/sources.js';

export const config = { maxDuration: 60 };

// Batch address resolver. Processes a whole search in one server call, sharing
// caches so each postcode is looked up once. The core signal: a property gets a
// FRESH EPC certificate when it's put on the market, so among the buildings on a
// street the one with the newest certificates is the one being marketed — which
// pins the right building (not a wrong neighbour) and often the exact flat.
// Returns ONLY precise results, never a bare street name.

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const leadNum = (s) => ((String(s || '').trim().match(/^(\d+[a-z]?)/i) || [])[1] || '').toLowerCase();
const ROADS = 'road|street|avenue|lane|close|drive|way|gardens?|grove|crescent|place|terrace|hill|park|rise|walk|row|green|square|vale|parade|broadway';
function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '').replace(/^(flat|apartment|apt|unit|plot)\s+\w+\s+/, '');
}
const BLD_WORD = /\b(house|court|lodge|apartments?|point|mansions?|heights|towers?|building|lofts?|wharf|hall|manor|residence|development|villas?|mews|chase|gate|quarter|works|mill)\b/i;
function buildingNameOf(display) {
  let seg = (display || '').split(',')[0].trim().replace(/^\s*(flat|apartment|apt|unit|room|studio)\s+[\w-]+\s*/i, '').trim();
  if (!seg || seg.length < 3) return '';
  const last = seg.split(/\s+/).slice(-1)[0];
  if (new RegExp('\\b(' + ROADS + ')\\b', 'i').test(last) && !BLD_WORD.test(seg)) return '';
  return seg;
}
const stripFlat = (s) => (s || '').replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '');
// A stable key for the BUILDING an address belongs to ("Flat 4, 403 Pinner Road,
// Harrow, HA1 4HN" → "403 pinner road"), so we can group a postcode's flats by
// their building and score each building's certificate freshness.
function buildingKey(full) {
  const s = stripFlat(full);
  const m = s.match(new RegExp('(\\d+[a-z]?)\\s+([a-z][a-z\'’ ]*?\\s(?:' + ROADS + '))', 'i'));
  if (m) return norm(m[1] + ' ' + m[2]);
  const nb = s.match(new RegExp('([a-z][a-z\'’ ]*?\\b(?:' + BLD_WORD.source.replace(/\\b|\(|\)/g, '') + '))', 'i'));
  return norm(nb ? nb[1] : s.split(',')[0]);
}

const _mem = new Map();
async function epcPostcode(pc) {
  const KEY = process.env.EPC_API_KEY || '';
  if (!KEY) return [];
  const mk = pc.toUpperCase().replace(/\s+/g, '');
  if (_mem.has(mk)) return _mem.get(mk);
  if (storeConfigured()) { const c = await getJSON('pce:' + mk, null); if (c) { _mem.set(mk, c); return c; } }
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
      const certDate = r.registrationDate || r.lodgementDate || '';
      const ex = seen.get(k);
      if (full && (!ex || certDate > ex.certDate)) seen.set(k, { line1: tcAddr(r.addressLine1 || lines[0] || ''), fullAddress: full, postcode: p, certDate });
    }
    out = [...seen.values()];
  } catch { out = []; }
  _mem.set(mk, out);
  if (storeConfigured() && out.length) await setJSON('pce:' + mk, out).catch(() => {});
  return out;
}

const _memRev = new Map();
async function nearby(lat, lon, area) {
  const k = lat.toFixed(4) + ',' + lon.toFixed(4);
  let pcs = _memRev.get(k);
  if (!pcs) { pcs = await reverseGeocode(lat, lon); _memRev.set(k, pcs); }
  return pcs.filter((pc) => !area || (pc || '').toUpperCase().startsWith(area)).slice(0, 4);
}

const FLAT = /flat|apartment|maisonette|studio/i;
const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

async function resolveOne(p) {
  const disp = p.displayAddress || p.address || '';
  if (p.lat == null || p.lon == null) return null;
  const seg0 = disp.split(',')[0].trim();
  const num = leadNum(seg0);
  const isFlat = FLAT.test(p.type || '') || /^(flat|apartment)/i.test(seg0);
  const building = isFlat ? buildingNameOf(disp) : '';
  const street = streetOf(disp);
  const listDate = (p.listDate || '').slice(0, 10);
  const area = String(p.haCode || '').toUpperCase().replace(/\d.*$/, '');
  const pcs = await nearby(p.lat, p.lon, area);

  // Look at every nearby postcode, and within EACH (never mixing postcodes) group
  // the street/building matches by building. Each building is a candidate, scored
  // by its newest EPC certificate — the marketed property has the freshest cert.
  const cands = [];
  for (const pc of pcs) {
    const units = await epcPostcode(pc);
    if (!units.length) continue;
    let m;
    if (building) m = units.filter((u) => norm(u.fullAddress).includes(norm(building)));
    else if (street) m = units.filter((u) => norm(u.fullAddress).includes(street));
    else continue;
    if (!m || !m.length) continue;
    const groups = new Map();
    for (const u of m) { const k = buildingKey(u.fullAddress); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
    for (const us of groups.values()) cands.push({ us, latest: us.reduce((x, u) => (u.certDate > x ? u.certDate : x), '') });
    if (building && cands.length) break; // a named building is unambiguous
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.latest.localeCompare(a.latest));

  let chosen, why;
  if (building) { chosen = cands[0].us; why = 'building named on the listing'; }
  else {
    const top = cands[0];
    // Street-only: only trust the freshest building when it's CLEARLY freshest
    // and the cert lines up with the listing going live — else skip (no guess).
    const gapDays = cands.length > 1 ? daysBetween(top.latest, cands[1].latest) : 999;
    const nearList = listDate && top.latest ? daysBetween(top.latest, listDate) <= 180 : false;
    if (!top.latest || gapDays < 45 || (listDate && !nearList)) return null;
    chosen = top.us; why = 'freshest EPC on the street (being marketed)';
  }
  chosen.sort((a, b) => b.certDate.localeCompare(a.certDate));

  // Pinpoint the exact unit within the chosen building.
  // 1) listing publishes the number; 2) only one unit; 3) one unit's cert is
  // clearly the freshest AND lines up with the listing date.
  let exact = null;
  if (num) exact = chosen.find((u) => leadNum(u.line1) === num || leadNum(stripFlat(u.fullAddress)) === num);
  if (!exact && chosen.length === 1) exact = chosen[0];
  if (!exact && chosen.length > 1) {
    const a = chosen[0], b = chosen[1];
    const fresherByDays = a.certDate && b.certDate ? daysBetween(a.certDate, b.certDate) : 0;
    const nearList = listDate && a.certDate ? daysBetween(a.certDate, listDate) <= 120 : false;
    if (fresherByDays >= 30 && (nearList || !listDate)) exact = a; // uniquely fresh = the marketed unit
  }

  if (exact) {
    return { id: p.id, level: 'exact', deliverable: true, address: exact.fullAddress, postcode: exact.postcode, units: [exact.fullAddress], why };
  }
  // Right building, but can't single out the flat — return the building + its
  // real units (deliverable only by mailing the block). Not counted as "exact".
  const addr = stripFlat(chosen[0].fullAddress);
  return { id: p.id, level: 'building', deliverable: false, address: addr, postcode: chosen[0].postcode, building: tcAddr(building || street), units: chosen.map((u) => u.fullAddress), why };
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
  const listings = Array.isArray(body.listings) ? body.listings.slice(0, 50) : [];
  if (!listings.length) { sendJson(res, 400, { error: 'Send { listings: [...] }' }); return; }
  const results = (await mapLimit(listings, 6, resolveOne)).filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { requested: listings.length, resolved: results.length, exact: results.filter((r) => r.deliverable).length, results });
}
