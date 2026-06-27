import https from 'https';
import { FULL_POSTCODE, reverseGeocode, sendJson, guardOrigin, EPC_BASE, fetchJson } from '../lib/helpers.js';
import { epcResolve } from './epc.js';
import { rightmoveProperty } from '../lib/sources.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';

export const config = { maxDuration: 30 };

// Resolve a live listing to a confirmed full address. Strategy:
//   1. EPC pinpoint — when the home has a certificate, floor-area matching nails
//      the exact house (high confidence).
//   2. OS Places rescue — for everything EPC can't cover (~half the stock), pull
//      the REAL Royal Mail addresses on the listing's street so the listing is
//      still matched, flagged for a one-tap confirm instead of being dropped.

const ROADS = 'Road|Street|Avenue|Lane|Close|Drive|Way|Gardens|Grove|Crescent|Place|Court|Terrace|Hill|Park|Rise|Walk|Mews|Row|Green|Square|Vale|Parade|Broadway';
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function streetOf(s) {
  const seg = (s || '').split(',')[0];
  return norm(seg).replace(/^\d+[a-z]?\s+/, '').replace(/^(flat|apartment|apt|unit|plot)\s+\w+\s+/, '');
}
function tcAddr(s) {
  return (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
}
// Tier-1 #3: pull a likely street name out of free text (listing title/description).
function extractStreet(text) {
  if (!text) return '';
  const re = new RegExp(`\\b([A-Z][a-zA-Z'’]+(?:\\s+[A-Z][a-zA-Z'’]+){0,3}\\s+(?:${ROADS}))\\b`);
  const m = text.match(re);
  return m ? streetOf(m[1]) : '';
}
function osGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}
// Distance in metres between two lat/lon points (haversine).
function distM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const la1 = a.lat * toR, la2 = b.lat * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// UPRN → exact lat/lon via OS Places. Gives each candidate a real coordinate so
// we can rank by how close it is to the listing's own map pin — an independent
// signal from floor area, so when both agree we can be confident.
const leadNum = (s) => ((String(s || '').trim().match(/^(\d+[a-z]?)/i) || [])[1] || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// House-level geocode via OpenStreetMap Nominatim — free, keyless and (unlike our
// rate-limited OS Places key) reliably available. Gives each candidate a real
// coordinate so we can rank by distance to the listing's own map pin: a signal
// fully independent of floor area, so when the two agree we can be confident.
const NOMI_UA = 'PropMailPro/1.0 (+https://prop-pro-theta.vercel.app; edbrown0606@gmail.com)';
function nominatim(street, postcode) {
  return new Promise((resolve) => {
    const qs = `street=${encodeURIComponent(street)}&postalcode=${encodeURIComponent(postcode)}&country=gb&format=json&limit=1`;
    https.get('https://nominatim.openstreetmap.org/search?' + qs, { headers: { 'User-Agent': NOMI_UA, Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { try { const j = JSON.parse(b); const h = Array.isArray(j) && j[0]; resolve(h ? { lat: parseFloat(h.lat), lon: parseFloat(h.lon), type: h.type } : null); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}
// Geocode the top size-ranked candidates (those most worth confirming), one
// request per second per Nominatim's usage policy, cached permanently in KV so
// repeat confirms are instant and we stay polite. Attaches c._geo.
async function geocodeCandidates(cands, fallbackPc) {
  const cache = storeConfigured();
  let issued = 0;
  for (const c of cands.slice(0, 5)) {
    const num = leadNum(c.line1) || leadNum(c.fullAddress);
    if (!num) continue;
    const street = (c.fullAddress.split(',')[0] || '').trim(); // e.g. "92 Sudbury Court Drive"
    const pc = c.postcode || fallbackPc || '';
    const key = 'geo:' + (street + '|' + pc).toLowerCase().replace(/\s+/g, ' ');
    let co = cache ? await getJSON(key, null) : null;
    if (!co) {
      if (issued++) await sleep(1100);          // ≤1 req/sec
      co = await nominatim(street, pc);
      if (co && cache) await setJSON(key, co);
    }
    if (co && co.lat != null && !Number.isNaN(co.lat)) c._geo = co;
  }
}
const fmtN = (n) => Number(n).toLocaleString();
// Combine independent signals (floor area + distance to the map pin) into a
// best pick, a confidence level and a plain-English explanation, so the user
// can trust or quickly verify the result instead of guessing.
function scoreEvidence(cands, { listingSqft, pin, isFlat }) {
  const haveSize = listingSqft > 0 && cands.some((c) => c.sizeSqft);
  const havePin = pin && cands.some((c) => c._distM != null);
  cands.forEach((c) => {
    let score = 0, wsum = 0;
    if (haveSize && c.sizeSqft) {
      const rel = Math.abs(c.sizeSqft - listingSqft) / Math.max(listingSqft, 1);
      score += Math.max(0, 1 - rel / 0.4) * 0.6; wsum += 0.6;   // full credit within ~0% off, none past 40%
    }
    if (havePin && c._distM != null) {
      score += Math.max(0, 1 - c._distM / 120) * 0.4; wsum += 0.4; // within 120m of the pin
    }
    c._score = wsum ? score / wsum : 0;
  });
  // Order: best evidence first; fall back to the existing (size/cert) order.
  if (haveSize || havePin) cands.sort((a, b) => (b._score || 0) - (a._score || 0));

  const top = cands[0], second = cands[1];
  const reasons = [];
  let confidence = 'low';
  if (top) {
    const multiFlat = isFlat && cands.length > 1;
    if (!multiFlat && haveSize && top.sizeSqft) reasons.push(`Floor area ${fmtN(top.sizeSqft)} sq ft vs listing ${fmtN(listingSqft)} (closest of ${cands.length})`);
    if (!multiFlat && havePin && top._distM != null) reasons.push(`${top._distM} m from the listing's map pin (nearest of ${cands.length})`);
    if (cands.length === 1) { reasons.push('The only address of this type on this postcode'); confidence = 'high'; }
    else if (isFlat) {
      // Flats in a block are near-identical in size and the listing never says
      // which flat — so no signal can pick one. Always leave it to the user.
      confidence = 'low';
      reasons.push('Several flats here look alike — pick the right one or read the flat number on the listing');
    } else {
      const gap = (top._score || 0) - (second ? (second._score || 0) : 0);
      const sizeClose = haveSize && top.sizeSqft && Math.abs(top.sizeSqft - listingSqft) / Math.max(listingSqft, 1) <= 0.12;
      const pinClose = havePin && top._distM != null && top._distM <= 40;
      const signals = (sizeClose ? 1 : 0) + (pinClose ? 1 : 0);
      // House + two independent signals agreeing on a clear winner = high.
      if (signals >= 2 && gap >= 0.18) confidence = 'high';
      else if (signals >= 1 && gap >= 0.12) confidence = 'medium';
      else confidence = 'low';
    }
  }
  return { confidence, reasons, pinMatched: havePin };
}
function mapDpa(d) {
  const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
  const line1 = tcAddr([d.SUB_BUILDING_NAME, d.BUILDING_NAME, d.BUILDING_NUMBER, d.THOROUGHFARE_NAME].filter(Boolean).join(' ').trim());
  return {
    line1, fullAddress: tcAddr(d.ADDRESS || ''), postcode: d.POSTCODE || '',
    uprn: d.UPRN ? String(d.UPRN) : '',
    _thoro: norm((d.THOROUGHFARE_NAME || '') + ' ' + (d.DEPENDENT_THOROUGHFARE_NAME || '')),
    _commercial: cls.startsWith('C'),
  };
}
// Real Royal Mail addresses on a street, within the candidate postcodes.
async function osStreetAddresses(OS, pcList, wantStreet, area) {
  const inArea = (pc) => !area || (pc || '').toUpperCase().startsWith(area);
  const seen = new Map();
  for (const pc of pcList) {
    if (!inArea(pc)) continue;
    const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(pc)}&dataset=DPA&maxresults=100&key=${encodeURIComponent(OS)}`;
    const { status, json } = await osGet(url);
    if (status === 200 && json && Array.isArray(json.results)) {
      json.results.map((r) => r.DPA).filter(Boolean).map(mapDpa).forEach((a) => {
        if (a._commercial || !a.fullAddress) return;
        if (wantStreet && !a._thoro.includes(wantStreet) && !norm(a.fullAddress).includes(wantStreet)) return;
        const k = a.fullAddress.toLowerCase();
        if (!seen.has(k)) seen.set(k, a);
      });
    }
    if (seen.size) break; // nearest postcode that actually has the street is enough
  }
  return [...seen.values()].map((a) => { delete a._thoro; delete a._commercial; return a; })
    .sort((x, y) => x.fullAddress.localeCompare(y.fullAddress, undefined, { numeric: true }));
}
// Every real residential address on an exact postcode (no street filter) — used
// when we have the listing's confident full postcode but the displayed street
// name is approximate, so the property is guaranteed to be in this list.
async function osPostcodeAll(OS, postcode) {
  const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(postcode)}&dataset=DPA&maxresults=100&key=${encodeURIComponent(OS)}`;
  const { status, json } = await osGet(url);
  if (status !== 200 || !json || !Array.isArray(json.results)) return [];
  return json.results.map((r) => r.DPA).filter(Boolean).map(mapDpa)
    .filter((a) => !a._commercial && a.fullAddress)
    .map((a) => { delete a._thoro; delete a._commercial; return a; })
    .sort((x, y) => x.fullAddress.localeCompare(y.fullAddress, undefined, { numeric: true }));
}
// Every certificated address on an exact postcode, via the EPC register (the
// source actually configured here). Used as the enriched-postcode fallback.
async function epcPostcodeAll(postcode) {
  const KEY = process.env.EPC_API_KEY || '';
  if (!KEY) return [];
  try {
    const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, '+')}&page_size=500`;
    const { status, json } = await fetchJson(url, KEY);
    const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
    const seen = new Map();
    data.forEach((r) => {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const pc = (r.postcode || '').replace(/\+/g, ' ');
      const full = tcAddr([...lines, r.postTown, pc].filter(Boolean).join(', '));
      const key = full.toLowerCase();
      if (full && !seen.has(key)) seen.set(key, { line1: tcAddr(r.addressLine1 || lines[0] || ''), fullAddress: full, postcode: pc, uprn: r.uprn ? String(r.uprn) : '' });
    });
    return [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
  } catch { return []; }
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const OS = process.env.OS_PLACES_KEY || '';
  let postcodeIn = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  let streetIn = (u.searchParams.get('street') || '').trim();
  const hint = (u.searchParams.get('hint') || '').trim();
  let rmType = (u.searchParams.get('type') || '').trim();
  let listingSqft = parseInt(u.searchParams.get('size') || '0', 10) || 0;
  let lat = parseFloat(u.searchParams.get('lat'));
  let lon = parseFloat(u.searchParams.get('lon'));
  const area = (u.searchParams.get('district') || '').toUpperCase().replace(/[0-9].*$/, '');

  // Accuracy boost: when we only have an outcode, fetch the listing's own page to
  // pull the FULL postcode, exact pin and floor area — far more to resolve with.
  const url = (u.searchParams.get('url') || '').trim();
  let enriched = false;
  if (url && !FULL_POSTCODE.test(postcodeIn)) {
    const p = await rightmoveProperty(url).catch(() => null);
    if (p) {
      if (FULL_POSTCODE.test(p.postcode)) { postcodeIn = p.postcode.toUpperCase(); enriched = true; }
      if (Number.isNaN(lat) && p.lat != null) lat = p.lat;
      if (Number.isNaN(lon) && p.lon != null) lon = p.lon;
      if (!listingSqft && p.sizeSqft) listingSqft = p.sizeSqft;
      if (!streetIn && p.displayAddress) streetIn = p.displayAddress;
      if (!rmType && p.type) rmType = p.type;
    }
  }

  const wantStreet = streetOf(streetIn) || extractStreet(streetIn) || extractStreet(hint);

  // 1. EPC pinpoint (exact house via floor-area when a certificate exists).
  const epc = await epcResolve({ postcodeIn, street: streetIn, rmType, listingSqft, lat, lon, area });
  const epcCands = (epc && Array.isArray(epc.candidates)) ? epc.candidates : [];
  // Only a SINGLE certificated address on the street is a genuine confirmation.
  // Floor-area "closest match" is a useful ranking, not proof — a multi-house
  // street must never be auto-confirmed (that wrongly turned 83 into 108).
  const epcConfident = !!(epc && epcCands.length === 1);

  // Candidate postcodes (reuse EPC's; otherwise compute from postcode + pin).
  let pcList = (epc && epc.pcList && epc.pcList.length) ? epc.pcList : [];
  if (!pcList.length) {
    if (FULL_POSTCODE.test(postcodeIn)) pcList.push(postcodeIn.replace(/\s+/, ' '));
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) pcList.push(...await reverseGeocode(lat, lon));
    pcList = [...new Set(pcList)].filter((pc) => !area || (pc || '').toUpperCase().startsWith(area)).slice(0, 14);
  }

  // 2. Merge. EPC is preferred — its candidates are real, certified,
  // house-numbered addresses. We only fall back to OS Places when EPC has
  // nothing on the street, and even then it auto-matches ONLY when the street
  // has a single address (an exact match); a multi-house street is not a usable
  // "this is the property" result, so it's left unmatched rather than guessed.
  let confirmed = false, candidates = [], source = '';
  if (epcCands.length) {
    source = 'EPC register';
    confirmed = epcCands.length === 1; // single address = exact; otherwise user picks
    candidates = epcCands;
  } else if (OS && pcList.length && wantStreet) {
    const osCands = await osStreetAddresses(OS, pcList, wantStreet, area);
    // A single match is the exact address; with the enriched full postcode we
    // also surface multiple real addresses on the street for a one-tap confirm.
    if (osCands.length) { source = 'Royal Mail / OS Places'; candidates = osCands; confirmed = osCands.length === 1; }
  }
  // Enriched full postcode but nothing matched the (approximate) street → return
  // every real address on the exact postcode so the right one is always present.
  // Prefer EPC (the source configured here); fall back to OS Places if present.
  if (!candidates.length && enriched && FULL_POSTCODE.test(postcodeIn)) {
    let all = await epcPostcodeAll(postcodeIn.replace(/\s+/, ' '));
    if (!all.length && OS) all = await osPostcodeAll(OS, postcodeIn.replace(/\s+/, ' '));
    if (all.length) { source = all[0].uprn && OS ? 'Royal Mail / OS Places' : 'EPC register'; candidates = all; confirmed = all.length === 1; }
  }

  // 3. Second independent signal: rank the candidates by how close each one's
  // real coordinate (via its UPRN) is to the listing's own map pin. Floor area
  // and map-pin distance are independent — when they agree on the same house we
  // can be confident; when they disagree we lower confidence and ask the user.
  // Fast mode (bulk auto-resolve over many listings): skip the per-house geocode,
  // which is rate-limited to 1/sec and far too slow for a whole page of results.
  const fast = !!u.searchParams.get('fast');
  const pin = (!Number.isNaN(lat) && !Number.isNaN(lon)) ? { lat, lon } : null;
  const isFlat = /flat|apartment|maisonette|studio/i.test(rmType) || candidates.some((c) => /\bflat|apartment\b/i.test(c.line1 || ''));
  let evidence = { confidence: candidates.length === 1 ? 'high' : 'low', reasons: [], pinMatched: false };
  let resolveDbg = null;
  if (candidates.length > 1) {
    if (pin && !isFlat && !fast) {
      await geocodeCandidates(candidates, postcodeIn).catch(() => {});
      candidates.forEach((c) => { c._distM = c._geo ? distM(pin, c._geo) : null; delete c._geo; });
      resolveDbg = { geocoded: candidates.filter((c) => c._distM != null).length };
    }
    evidence = scoreEvidence(candidates, { listingSqft, pin, isFlat });
  } else if (candidates.length === 1) {
    evidence.reasons = ['The only matching address on this postcode'];
  }
  // 4. Building-level resolution for flats. The listing names a block but hides
  // the unit — we can't know the exact flat, but we CAN list every real flat in
  // that building from the register. All genuine, mailable owner addresses.
  // A house we could pinpoint by floor area + map pin needs no pooling.
  const housePinpointed = !isFlat && (evidence.confidence === 'high' || evidence.confidence === 'medium');
  let buildingResolved = false, building = null, units = [], blockLevel = null;
  if (!housePinpointed && candidates.length) {
    const bn = isFlat ? (buildingNameOf(streetIn) || buildingNameOf(hint)) : '';
    let u = [];
    if (bn) u = candidates.filter((c) => norm(c.fullAddress).includes(norm(bn)));
    if (u.length) {
      // Named block — the tight, premium result ("Apex House" → its flats).
      blockLevel = 'building';
      const first = u[0].fullAddress.replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '');
      building = { name: tcAddr(bn), address: first, unitCount: u.length };
    } else if (wantStreet) {
      // Street-level: every real home on the listing's street/postcode. Looser
      // than a unit, but all genuine, mailable owner addresses (street farming).
      u = candidates;
      blockLevel = 'street';
      building = { name: tcAddr(wantStreet), address: (postcodeIn || (candidates[0] && candidates[0].postcode) || ''), unitCount: u.length };
    }
    if (u.length) { buildingResolved = true; units = u.map((c) => c.fullAddress); }
  }

  // Expose the distance per candidate (handy for the UI) and strip internals.
  const out = candidates.slice(0, 60).map((c) => {
    const o = { ...c }; if (c._distM != null) o.distM = c._distM;
    delete o._distM; delete o._score; return o;
  });

  sendJson(res, 200, {
    confirmed, source: source || null, street: wantStreet || null,
    epcMatch: source === 'EPC register',
    sizeMatched: !!(epc && epc.sizeMatched),
    confidence: evidence.confidence, reasons: evidence.reasons, pinMatched: evidence.pinMatched,
    buildingResolved, building, blockLevel, units: units.slice(0, 300), unitCount: units.length,
    enriched, postcode: postcodeIn || null,
    total: candidates.length, candidates: out,
    note: candidates.length ? undefined : 'No exact address — open the listing on Rightmove to read the house number.',
    ...(u.searchParams.get('osdebug') ? { resolveDebug: resolveDbg } : {}),
  });
}

// Pull a named building out of a listing's address ("Apex House, Harrow" →
// "Apex House"; "Lyon Road, Harrow" → "" because that's a street, not a block).
const ROAD_WORD = /\b(road|street|avenue|lane|close|drive|way|gardens?|grove|crescent|place|terrace|hill|park|rise|walk|row|green|square|vale|parade|broadway)\b/i;
const BLD_WORD = /\b(house|court|lodge|apartments?|point|mansions?|heights|towers?|building|lofts?|wharf|hall|manor|residence|development|villas?|mews|chase|gate|quarter|works|mill)\b/i;
function buildingNameOf(display) {
  let seg = (display || '').split(',')[0].trim().replace(/^\s*(flat|apartment|apt|unit|room|studio)\s+[\w-]+\s*/i, '').trim();
  if (!seg || seg.length < 3) return '';
  const last = seg.split(/\s+/).slice(-1)[0];
  if (ROAD_WORD.test(last) && !BLD_WORD.test(seg)) return ''; // it's a street, not a building
  return seg;
}
