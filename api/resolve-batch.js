import https from 'https';
import { sendJson, guardOrigin, readBody, reverseGeocode, EPC_BASE, fetchJson, FULL_POSTCODE } from '../lib/helpers.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { rightmoveProperty } from '../lib/sources.js';
import { councilTaxAddresses, councilTaxCached } from '../lib/counciltax.js';

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
      if (full && (!ex || certDate > ex.certDate)) seen.set(k, { line1: tcAddr(r.addressLine1 || lines[0] || ''), fullAddress: full, postcode: p, certDate, cert: r.certificateNumber || '' });
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
  return pcs.filter((pc) => !area || (pc || '').toUpperCase().startsWith(area)).slice(0, 8);
}

// One certificate's floor area (sq ft), cached — used to match a flat to the
// listing's published size. Only ever called for an already-chosen building.
const SQFT = 10.7639;
const _memCert = new Map();
async function certSqft(cert) {
  if (!cert) return null;
  if (_memCert.has(cert)) return _memCert.get(cert);
  let v = null;
  try {
    const KEY = process.env.EPC_API_KEY || '';
    const { json } = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`, KEY);
    const body = (json && json.data) ? json.data : json;
    const m2 = parseFloat(body && body.total_floor_area);
    if (!Number.isNaN(m2) && m2 > 0) v = Math.round(m2 * SQFT);
  } catch { /* ignore */ }
  _memCert.set(cert, v);
  return v;
}

// OpenStreetMap Overpass — free, keyless crowdsourced addresses near a point.
// Independent of EPC, so it resolves buildings/houses the register doesn't cover.
const _memOv = new Map();
function overpassNear(lat, lon) {
  const k = lat.toFixed(4) + ',' + lon.toFixed(4);
  if (_memOv.has(k)) return Promise.resolve(_memOv.get(k));
  const q = `[out:json][timeout:18];(node["addr:housenumber"](around:140,${lat},${lon});way["addr:housenumber"](around:140,${lat},${lon}););out tags center 120;`;
  return new Promise((resolve) => {
    https.get('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), { headers: { 'User-Agent': 'PropMailPro/1.0 (edbrown0606@gmail.com)', Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => {
        let els = [];
        try {
          els = ((JSON.parse(b) || {}).elements || []).map((e) => ({
            num: String(e.tags['addr:housenumber'] || '').toLowerCase(),
            unit: e.tags['addr:unit'] || e.tags['addr:flats'] || '',
            street: norm(e.tags['addr:street'] || ''),
            lat: e.lat != null ? e.lat : (e.center && e.center.lat),
            lon: e.lon != null ? e.lon : (e.center && e.center.lon),
          })).filter((x) => x.num && x.street && x.lat != null);
        } catch {}
        _memOv.set(k, els); resolve(els);
      });
    }).on('error', () => { _memOv.set(k, []); resolve([]); });
  });
}
const distM = (a, b) => { const R = 6371000, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t, la1 = a.lat * t, la2 = b.lat * t; return Math.round(2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2))); };

const FLAT = /flat|apartment|maisonette|studio/i;
const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// ── Council Tax (VOA) — authoritative residential unit list per postcode ──
// Used only to ADD: complete a block's unit list and confirm a resolved address.
// It never overrides the EPC-freshness choice of building/flat.
function addrParts(full) {
  const flat = (String(full).match(/\b(?:flat|apartment|apt|unit|room|studio|maisonette)\s+([0-9a-z]+)/i) || [])[1] || '';
  const m = stripFlat(full).match(new RegExp('(\\d+[a-z]?)\\s+([a-z][a-z\'’ ]*?\\s(?:' + ROADS + '))', 'i'));
  return { flat: flat.toLowerCase(), no: m ? m[1].toLowerCase() : '', street: m ? norm(m[2]) : '' };
}
const ctStreetMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
// Does a Council Tax row refer to the same dwelling as these parsed parts?
function ctSame(r, parts) {
  return !!parts.no && r.flat === parts.flat && r.buildingNo === parts.no && ctStreetMatch(r.street, parts.street);
}
// Council Tax rows for a postcode. Cached fetches are free; only NEW postcodes
// cost the per-request budget, so a big search can't hammer the public service.
async function councilTaxFor(pc, ctx) {
  if (!pc) return [];
  const cached = councilTaxCached(pc);
  if (cached) return cached;
  if (!ctx || ctx.ctBudget <= 0) return [];
  ctx.ctBudget--;
  const r = await councilTaxAddresses(pc).catch(() => ({ rows: [] }));
  return r.rows || [];
}

async function resolveOne(p, ctx) {
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
  // Fallback: EPC has nothing on this street here. Try OpenStreetMap (free,
  // independent) for a building on the listing's street nearest the map pin.
  // Budgeted so a big search can't overload the public Overpass server.
  if (!cands.length) {
    if (!street || !ctx || ctx.ovBudget <= 0) return null;
    ctx.ovBudget--;
    const els = await overpassNear(p.lat, p.lon).catch(() => []);
    const onStreet = els.filter((e) => e.street.includes(street) || street.includes(e.street));
    if (!onStreet.length) return null;
    onStreet.forEach((e) => { e._d = distM({ lat: p.lat, lon: p.lon }, e); });
    onStreet.sort((a, b) => a._d - b._d);
    const e = onStreet[0];
    if (e._d > 120) return null; // too far from the pin to trust
    const addr = tcAddr([e.num + (e.unit ? e.unit : ''), street].join(' ')) + (pcs[0] ? ', ' + pcs[0] : '');
    const deliverable = !isFlat || !!e.unit; // a house number is deliverable; a flat needs a unit
    return { id: p.id, level: deliverable ? 'exact' : 'building', deliverable, address: addr, postcode: pcs[0] || '', units: [addr], why: 'OpenStreetMap address nearest the map pin' };
  }
  cands.sort((a, b) => b.latest.localeCompare(a.latest));

  let chosen, why;
  if (building) { chosen = cands[0].us; why = 'building named on the listing'; }
  else if (cands.length === 1) {
    // Only one building on the listing's street here — unambiguous, no guess.
    chosen = cands[0].us; why = 'the only building on this street/postcode';
  } else {
    // Several buildings on the street → trust the freshest only when it's CLEARLY
    // freshest and lines up with the listing going live; else skip (no guess).
    const top = cands[0];
    const gapDays = daysBetween(top.latest, cands[1].latest);
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
  // Floor-area match: when the listing publishes a size, the flat whose certified
  // floor area matches it (and clearly differs from the others) is the one listed.
  const listSqft = parseInt(p.sizeSqft || 0, 10) || 0;
  if (!exact && listSqft > 0 && chosen.length > 1) {
    const sized = [];
    for (const u of chosen.slice(0, 25)) { const s = await certSqft(u.cert); if (s) sized.push({ u, s, diff: Math.abs(s - listSqft) }); }
    sized.sort((x, y) => x.diff - y.diff);
    if (sized.length > 1) {
      const best = sized[0], next = sized[1];
      const relBest = best.diff / listSqft;
      if (relBest <= 0.08 && next.diff >= best.diff + Math.max(60, listSqft * 0.12)) exact = best.u; // tight + clearly unique
    }
  }

  if (exact) {
    // Cross-check against the Council Tax register: if the dwelling is listed
    // there too, mark it confirmed (extra confidence, never used to reject).
    const ctRows = await councilTaxFor(exact.postcode, ctx);
    const verified = ctRows.length ? ctRows.some((r) => ctSame(r, addrParts(exact.fullAddress))) : undefined;
    return { id: p.id, level: 'exact', deliverable: true, address: exact.fullAddress, postcode: exact.postcode, units: [exact.fullAddress], verified, why: verified ? why + '; confirmed on the Council Tax register' : why };
  }
  // Right building, but can't single out the flat — return the building + its
  // real units (deliverable only by mailing the block). Not counted as "exact".
  // Prefer the COMPLETE unit list from Council Tax (every flat in the block),
  // falling back to the EPC-known units when Council Tax has nothing.
  const addr = stripFlat(chosen[0].fullAddress);
  const bparts = addrParts(chosen[0].fullAddress);
  const ctRows = await councilTaxFor(chosen[0].postcode, ctx);
  const ctUnits = ctRows.filter((r) => (bparts.no && r.buildingNo === bparts.no && ctStreetMatch(r.street, bparts.street)) || (building && norm(r.address).includes(norm(building))));
  const units = ctUnits.length ? ctUnits.map((r) => tcAddr(r.address).replace(/\bAt\b/g, 'at')) : chosen.map((u) => u.fullAddress);
  return { id: p.id, level: 'building', deliverable: false, address: addr, postcode: chosen[0].postcode, building: tcAddr(building || street), units, unitSource: ctUnits.length ? 'councilTax' : 'epc', why: ctUnits.length ? why + `; full unit list from Council Tax (${ctUnits.length})` : why };
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
  const ctx = { ovBudget: 4, ctBudget: 20 }; // cap free OpenStreetMap + Council Tax fetches per request
  const results = (await mapLimit(listings, 6, (p) => resolveOne(p, ctx))).filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { requested: listings.length, resolved: results.length, exact: results.filter((r) => r.deliverable).length, results });
}
