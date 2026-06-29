import https from 'https';
import { sendJson, guardOrigin, readBody, reverseGeocode, EPC_BASE, fetchJson, FULL_POSTCODE } from '../lib/helpers.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { rightmoveProperty } from '../lib/sources.js';
import { councilTaxAddresses, councilTaxCached } from '../lib/counciltax.js';
import { listingDetail } from '../lib/listingDetail.js';

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

// One certificate's details (floor area in sq ft + property type + built form),
// cached. The EPC SEARCH response lacks these, so they need the certificate.
const SQFT = 10.7639;
const _memCert = new Map();
async function certDetails(cert) {
  if (!cert) return null;
  if (_memCert.has(cert)) return _memCert.get(cert);
  let v = null;
  try {
    const KEY = process.env.EPC_API_KEY || '';
    const url = `${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`;
    let r = await fetchJson(url, KEY);
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 500)); r = await fetchJson(url, KEY); } // ride out a rate limit
    const b = (r.json && r.json.data) ? r.json.data : r.json;
    if (b) {
      const m2 = parseFloat(b.total_floor_area ?? b.totalFloorArea);
      v = {
        sqft: (!Number.isNaN(m2) && m2 > 0) ? Math.round(m2 * SQFT) : null,
        ptype: String(b.property_type ?? b.propertyType ?? '').toLowerCase(),
        bform: String(b.built_form ?? b.builtForm ?? '').toLowerCase(),
      };
    }
  } catch { /* ignore */ }
  _memCert.set(cert, v);
  return v;
}

// Does an EPC certificate's property type / built form match the listing's type?
// Used to narrow floor-area matching so it can uniquely pin on uniform streets.
// Conservative: only rejects on a CLEAR mismatch (unknowns pass through).
function epcTypeMatches(listingType, d) {
  if (!d) return false;
  const t = String(listingType || '').toLowerCase(), pt = d.ptype || '', bf = d.bform || '';
  if (/flat|apartment|studio/.test(t)) return !pt || /flat/.test(pt);
  if (/maisonette/.test(t)) return !pt || /maisonette|flat/.test(pt);
  if (/bungalow/.test(t)) return !pt || /bungalow/.test(pt);
  if (/house|detached|terrace|semi|town|mews|cottage|link|end/.test(t)) {
    if (pt && !/house|bungalow/.test(pt)) return false;           // listing is a house but EPC says flat
    if (/semi/.test(t)) { if (bf && !/semi/.test(bf)) return false; }
    else if (/detached/.test(t)) { if (bf && !(/detached/.test(bf) && !/semi/.test(bf))) return false; }
    else if (/end of terrace|end terrace/.test(t)) { if (bf && !/end/.test(bf)) return false; }
    else if (/terrace/.test(t)) { if (bf && !/terrace/.test(bf)) return false; }
    return true;
  }
  return true; // unknown listing type → don't filter on type
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

// PRECISION-FIRST resolver. We only return an address when free public data can
// actually IDENTIFY the specific listed property — never a bare street/block name,
// never a guessed flat. When the data can't single it out, we withhold it.
// The three things that genuinely identify a property:
//   1) the listing already states the number/flat (confirm it on Council Tax),
//   2) its published floor area uniquely matches one EPC certificate,
//   3) there is genuinely only one candidate address.
// CONFIRM the exact property from a given set of postcodes + size, via the three
// proof tiers. Returns a confirmed result or null. Called first with the map
// pin's nearby postcodes, then (on a miss) scoped to the EXACT postcode read off
// the listing's own detail page.
async function tryConfirm(p, pcs, listSqft, ctx) {
  const disp = p.displayAddress || p.address || '';
  const seg0 = disp.split(',')[0].trim();
  // The number the listing itself states (often empty — Rightmove usually hides it).
  const num = leadNum(seg0) || ((seg0.match(/\b(?:flat|apartment|apt|unit)\s+([0-9]+[a-z]?)/i) || [])[1] || '').toLowerCase();
  const isFlat = FLAT.test(p.type || '') || /^(flat|apartment)/i.test(seg0);
  const building = isFlat ? buildingNameOf(disp) : '';
  const street = streetOf(disp);
  if ((!street && !building) || !pcs || !pcs.length) return null;
  const tc = (a) => tcAddr(a).replace(/\bAt\b/g, 'at');

  // The authoritative set of REAL dwellings on this street (house) or in this
  // building (flat), from Council Tax across the nearby postcodes. This is our
  // denominator: it tells us whether a pick is genuinely unique or just a guess.
  const ct = [];
  for (const pc of pcs) {
    for (const r of await councilTaxFor(pc, ctx)) {
      if (building ? norm(r.address).includes(norm(building)) : ctStreetMatch(r.street, street)) ct.push({ ...r, postcode: pc });
    }
  }

  // ── TIER 1 — the listing states the number/flat → confirm it on Council Tax. ──
  if (num) {
    const hit = ct.find((r) => r.buildingNo === num || r.flat === num);
    if (hit) return { id: p.id, level: 'exact', deliverable: true, confidence: 'high', address: tc(hit.address), postcode: hit.postcode, units: [tc(hit.address)], verified: true, why: 'number stated on the listing, confirmed on the Council Tax register' };
  }

  // EPC dwellings on the street/building, for floor-area matching.
  const epc = [];
  for (const pc of pcs) {
    for (const u of await epcPostcode(pc)) {
      if (building ? norm(u.fullAddress).includes(norm(building)) : norm(u.fullAddress).includes(street)) epc.push(u);
    }
  }

  // ── TIER 2 — floor area (+ property type) uniquely identifies the dwelling.
  // When the listing publishes a size, fetch each candidate's EPC details, keep
  // only those whose property type / built form match the listing (so identical
  // terraces of a different type are ruled out), then take the one whose floor
  // area matches and is clearly closer than any other. ──
  if (listSqft > 0 && epc.length && epc.length <= 25) {
    const sized = [];
    for (const u of epc) {
      if (ctx && ctx.certBudget <= 0) break;        // bound total cert lookups per request (avoid timeouts)
      if (ctx) ctx.certBudget--;
      const d = await certDetails(u.cert);
      if (d && d.sqft && epcTypeMatches(p.type, d)) sized.push({ u, s: d.sqft, diff: Math.abs(d.sqft - listSqft) });
    }
    sized.sort((a, b) => a.diff - b.diff);
    if (sized.length) {
      const best = sized[0], next = sized[1];
      // Listing sqft and EPC floor area are measured differently, so allow ~13%.
      // Safeguard: the match must be clearly closer than any other candidate.
      const tight = best.diff / listSqft <= 0.13;
      const unique = !next || next.diff >= best.diff + Math.max(50, listSqft * 0.10);
      if (tight && unique) {
        const ok = ct.some((r) => ctSame(r, addrParts(best.u.fullAddress)));
        return { id: p.id, level: 'exact', deliverable: true, confidence: ok ? 'high' : 'medium', address: tc(best.u.fullAddress), postcode: best.u.postcode, units: [tc(best.u.fullAddress)], verified: ok, why: 'floor area + property type match the listing' + (ok ? ', confirmed on the Council Tax register' : '') };
      }
    }
  }

  // ── TIER 3 — there is only ONE candidate, so nothing is being guessed.
  // House: the street has a single address across the nearby postcodes.
  // Flat: the building contains a single dwelling. ──
  const ctAddrs = [...new Set(ct.map((r) => r.address))];
  if (ctAddrs.length === 1) {
    const r = ct.find((x) => x.address === ctAddrs[0]);
    return { id: p.id, level: 'exact', deliverable: true, confidence: 'high', address: tc(r.address), postcode: r.postcode, units: [tc(r.address)], verified: true, why: 'the only address on this street/postcode (Council Tax)' };
  }
  if (!ct.length && !isFlat && epc.length === 1) {
    const u = epc[0];
    return { id: p.id, level: 'exact', deliverable: true, confidence: 'medium', address: tc(u.fullAddress), postcode: u.postcode, units: [tc(u.fullAddress)], why: 'the only address found on this street (EPC)' };
  }

  return null;
}

// Resolve ONE listing: confirm via the map pin's postcodes; on a miss, enrich
// from the listing's detail page (EXACT postcode) and retry confirm; else fall
// back to a flagged best-estimate (Likely).
async function resolveOne(p, ctx) {
  if (p.lat == null || p.lon == null) return null;
  const area = String(p.haCode || '').toUpperCase().replace(/\d.*$/, '');
  const listSqft = parseInt(p.sizeSqft || 0, 10) || 0;
  const pcs = await nearby(p.lat, p.lon, area);
  if (!pcs.length) return null;
  const tc = (a) => tcAddr(a).replace(/\bAt\b/g, 'at');

  // 1) Confirm using the map pin's nearby postcodes.
  let r = await tryConfirm(p, pcs, listSqft, ctx);
  if (r) return r;

  // 2) Enrich from the listing's own detail page — the EXACT postcode collapses
  // the candidate pool to ONE postcode, where the proof tiers confirm far more
  // often. Budgeted + cached; degrades to Likely on any miss.
  if (p.url && ctx && ctx.detailBudget > 0) {
    ctx.detailBudget--;
    const d = await listingDetail(p.url).catch(() => null);
    if (d && d.postcode) {
      // Option 2: the detail page's own displayAddress sometimes states a
      // house/flat number the card hid — prefer it when it carries a number so
      // Tier 1 can confirm it; otherwise keep the card's address.
      const detailNum = leadNum((d.displayAddress || '').split(',')[0].trim());
      const disp = detailNum ? d.displayAddress : (p.displayAddress || p.address || d.displayAddress);
      const r2 = await tryConfirm({ ...p, displayAddress: disp, type: d.type || p.type }, [d.postcode], d.sqft || listSqft, ctx);
      if (r2) { r2.confidence = 'high'; r2.why += ' (exact postcode from the listing page)'; return r2; }
    }
  }

  // 3) LIKELY — best estimate from nearby EPC, clearly flagged to verify.
  // A property gets a fresh EPC when it's marketed, so the EPC lodged CLOSEST to
  // the listing date is the most likely listing; we sanity-check the top
  // candidate's property type so we never estimate a flat for a house.
  const disp = p.displayAddress || p.address || '';
  const seg0 = disp.split(',')[0].trim();
  const isFlat = FLAT.test(p.type || '') || /^(flat|apartment)/i.test(seg0);
  const building = isFlat ? buildingNameOf(disp) : '';
  const street = streetOf(disp);
  if (!street && !building) return null;
  const epc = [];
  for (const pc of pcs) { for (const u of await epcPostcode(pc)) { if (building ? norm(u.fullAddress).includes(norm(building)) : norm(u.fullAddress).includes(street)) epc.push(u); } }
  if (epc.length) {
    const listDate = (p.listDate || '').slice(0, 10);
    const groups = new Map();
    for (const u of epc) { const k = buildingKey(u.fullAddress); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
    const cands = [...groups.values()].map((us) => { us.sort((a, b) => b.certDate.localeCompare(a.certDate)); return { us, latest: us[0].certDate || '' }; });
    // Rank by EPC-date closeness to the listing date (marketing signal); if we
    // have no listing date, fall back to the freshest certificate.
    if (listDate) cands.sort((a, b) => (a.latest && b.latest) ? (daysBetween(a.latest, listDate) - daysBetween(b.latest, listDate)) : b.latest.localeCompare(a.latest));
    else cands.sort((a, b) => b.latest.localeCompare(a.latest));

    let chosen = null, why = '';
    if (building) { chosen = cands[0].us; why = 'building named on the listing'; }
    else if (cands.length === 1) { chosen = cands[0].us; why = 'the only building on this street'; }
    else {
      // Walk the ranked candidates; verify TYPE with a bounded number of cert
      // lookups and take the first whose type matches the listing (or unknown).
      let pick = null, checks = 0, typed = false;
      for (const c of cands) {
        if (checks >= 3 || !ctx || ctx.certBudget <= 0) break;
        checks++; ctx.certBudget--;
        const d = await certDetails(c.us[0].cert);
        if (!d) { pick = pick || c; continue; }
        if (epcTypeMatches(p.type, d)) { pick = c; typed = !!d.ptype; break; }
      }
      pick = pick || cands[0];
      const near = listDate && pick.latest && daysBetween(pick.latest, listDate) <= 150;
      const gap = cands[1] && pick.latest && cands[1].latest ? daysBetween(pick.latest, cands[1].latest) : 999;
      // Only surface a best-estimate when there's a REAL signal — near the listing
      // date, a clearly freshest cert, or a type match. Otherwise it's a near-random
      // guess among similar houses, so withhold it rather than show a weak pick.
      if (near || typed || gap >= 30) {
        chosen = pick.us;
        why = [near ? 'EPC lodged near the listing date' : 'freshest EPC on the street', typed ? 'property type matches' : ''].filter(Boolean).join(' + ');
      }
    }
    if (chosen && chosen.length) {
      // Pick the unit: floor-area-closest when the listing has a size (bounded
      // cert lookups), otherwise the freshest certificate in the building.
      let unit = chosen[0];
      if (listSqft > 0 && chosen.length > 1 && ctx && ctx.certBudget > 0) {
        let best = null, n = 0;
        for (const u of chosen) {
          if (n >= 8 || ctx.certBudget <= 0) break; n++; ctx.certBudget--;
          const d = await certDetails(u.cert);
          if (d && d.sqft) { const diff = Math.abs(d.sqft - listSqft); if (!best || diff < best.diff) best = { u, diff }; }
        }
        if (best) { unit = best.u; why += ' + closest floor area'; }
      }
      return { id: p.id, level: 'likely', deliverable: false, confidence: 'likely', address: tc(unit.fullAddress), postcode: unit.postcode, units: [tc(unit.fullAddress)], why: 'best estimate — ' + (why || 'freshest EPC near the listing') + ' (verify before posting)' };
    }
  }

  // Truly nothing to go on — withhold (no bare street/block names, no guesses).
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
  const listings = Array.isArray(body.listings) ? body.listings.slice(0, 50) : [];
  if (!listings.length) { sendJson(res, 400, { error: 'Send { listings: [...] }' }); return; }
  const ctx = { ovBudget: 4, ctBudget: 20, certBudget: 450, detailBudget: 18 }; // cap free lookups per request (Council Tax + EPC details + listing detail pages)
  const results = (await mapLimit(listings, 6, (p) => resolveOne(p, ctx))).filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { requested: listings.length, resolved: results.length, exact: results.filter((r) => r.deliverable).length, results });
}
