import https from 'https';
import { FULL_POSTCODE, reverseGeocode, sendJson, guardOrigin, EPC_BASE, fetchJson } from '../lib/helpers.js';
import { epcResolve } from './epc.js';
import { rightmoveProperty } from '../lib/sources.js';

export const config = { maxDuration: 20 };

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
  const epcConfident = !!(epc && (epc.sizeMatched || epcCands.length === 1));

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
    confirmed = epcConfident || epcCands.length === 1;
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

  sendJson(res, 200, {
    confirmed, source: source || null, street: wantStreet || null,
    epcMatch: source === 'EPC register',
    sizeMatched: !!(epc && epc.sizeMatched),
    enriched, postcode: postcodeIn || null,
    total: candidates.length, candidates: candidates.slice(0, 60),
    note: candidates.length ? undefined : 'No exact address — open the listing on Rightmove to read the house number.',
  });
}
