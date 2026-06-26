import https from 'https';
import { FULL_POSTCODE, reverseGeocode, sendJson, guardOrigin } from '../lib/helpers.js';
import { epcResolve } from './epc.js';

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

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const OS = process.env.OS_PLACES_KEY || '';
  const postcodeIn = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const streetIn = (u.searchParams.get('street') || '').trim();
  const hint = (u.searchParams.get('hint') || '').trim();
  const rmType = (u.searchParams.get('type') || '').trim();
  const listingSqft = parseInt(u.searchParams.get('size') || '0', 10) || 0;
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const area = (u.searchParams.get('district') || '').toUpperCase().replace(/[0-9].*$/, '');

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
    if (osCands.length === 1) { source = 'Royal Mail / OS Places'; candidates = osCands; confirmed = true; }
  }

  sendJson(res, 200, {
    confirmed, source: source || null, street: wantStreet || null,
    epcMatch: source === 'EPC register',
    sizeMatched: !!(epc && epc.sizeMatched),
    total: candidates.length, candidates: candidates.slice(0, 60),
    note: candidates.length ? undefined : 'No exact address — open the listing on Rightmove to read the house number.',
  });
}
