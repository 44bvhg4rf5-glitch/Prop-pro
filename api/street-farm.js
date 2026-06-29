import https from 'https';
import { sendJson, guardOrigin, reverseGeocode, EPC_BASE, fetchJson } from '../lib/helpers.js';
import { councilTaxAddresses } from '../lib/counciltax.js';

export const config = { maxDuration: 45 };

// Street farming, both directions:
//   audience=homeowner (sold)  → EVERY dwelling on the street (Council Tax),
//                                addressed to "The Homeowner" — win the SALE.
//   audience=landlord  (let)   → only the RENTED homes on the street (EPC tenure
//                                = privately/socially rented), addressed to "The
//                                Landlord" — win the LETTING/management.
// Free, exact, GDPR-safe (no named individuals). Accepts a postcode or lat/lon.
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';
const RENTED_TENURE = new Set([2, 3]);   // EPC tenure: 2 = rented (social), 3 = rented (private); 1 = owner-occupied
const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'PropMailPro/1.0', Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve(j); });
    }).on('error', () => resolve(null));
  });
}
async function pcLatLon(pc) {
  const j = await getJson('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc));
  const r = j && j.result;
  return (r && typeof r.latitude === 'number') ? { lat: r.latitude, lon: r.longitude } : null;
}
// EPC dwellings on a postcode (address + certificate), keyless via the gov API.
async function epcRecords(pc, KEY) {
  if (!KEY) return [];
  const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
  const { status, json } = await fetchJson(url, KEY);
  const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
  return data.map((r) => ({
    cert: r.certificateNumber || '',
    street: norm([r.addressLine1, r.addressLine2, r.addressLine3].filter(Boolean).join(' ')),
    full: tcAddr([r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4, r.postTown, (r.postcode || '').replace(/\+/g, ' ')].filter(Boolean).join(', ')),
    postcode: (r.postcode || '').replace(/\+/g, ' '),
  }));
}
async function tenureOf(cert, KEY) {
  if (!cert) return null;
  const r = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`, KEY);
  const b = (r.json && r.json.data) ? r.json.data : r.json;
  if (!b) return null;
  const t = b.tenure;
  if (typeof t === 'number' || /^\d+$/.test(String(t ?? ''))) return Number(t);
  return /rented/i.test(String(t || '')) ? 3 : (/owner/i.test(String(t || '')) ? 1 : null);
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  let postcode = (u.searchParams.get('postcode') || '').toUpperCase().trim();
  const street = (u.searchParams.get('street') || '').trim();
  const exclude = (u.searchParams.get('exclude') || '').trim();
  const audience = (u.searchParams.get('audience') || 'homeowner').toLowerCase() === 'landlord' ? 'landlord' : 'homeowner';
  const wide = u.searchParams.get('wide') !== '0';
  const lat = parseFloat(u.searchParams.get('lat')), lon = parseFloat(u.searchParams.get('lon'));
  const wantStreet = norm(street);

  // Resolve the postcode set to scan: from the given postcode (+ nearby for the
  // wider street) or by reverse-geocoding the listing's pin.
  let pcs = [];
  let area = '';
  if (postcode) {
    area = outcodeOf(postcode);
    pcs = [postcode];
    if (wide) { try { const ll = await pcLatLon(postcode); if (ll) { const near = await reverseGeocode(ll.lat, ll.lon); pcs = [...new Set([postcode, ...near])]; } } catch { /* */ } }
  } else if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
    try { pcs = await reverseGeocode(lat, lon); } catch { /* */ }
    area = outcodeOf(pcs[0] || '');
  }
  pcs = [...new Set(pcs)].filter(Boolean);
  if (area) pcs = pcs.filter((p) => outcodeOf(p) === area);
  pcs = pcs.slice(0, 5);
  if (!pcs.length) { sendJson(res, 400, { error: 'Could not resolve a postcode (send postcode or lat/lon)' }); return; }

  const exN = ((exclude.match(/\d+[a-z]?/i) || [''])[0]).toLowerCase();
  const seen = new Set();
  const neighbours = [];

  if (audience === 'landlord') {
    // Rentals must have an EPC to be let, so the EPC register is a near-complete
    // list of the street's lettable stock — and its tenure field flags which are
    // landlord-owned. Filter EPC to the street first, then read tenure (bounded).
    const KEY = process.env.EPC_API_KEY || '';
    let recs = [];
    for (const pc of pcs) recs.push(...await epcRecords(pc, KEY));
    if (wantStreet) { const on = recs.filter((r) => r.street.includes(wantStreet)); if (on.length) recs = on; }
    // newest cert per address
    const byAddr = new Map();
    for (const r of recs) { const k = norm(r.full); if (k && !byAddr.has(k)) byAddr.set(k, r); }
    let checked = 0;
    for (const r of byAddr.values()) {
      if (checked >= 60) break; checked++;
      const t = await tenureOf(r.cert, KEY);
      if (t == null || !RENTED_TENURE.has(t)) continue;
      const k = norm(r.full); if (seen.has(k)) continue; seen.add(k);
      const num = ((r.full.match(/\b(\d+[a-z]?)\b/i) || [])[1] || '').toLowerCase();
      if (exN && num === exN && (!wantStreet || r.street.includes(wantStreet))) continue;
      neighbours.push({ address: r.full, postcode: r.postcode, addressee: 'The Landlord' });
    }
  } else {
    // Homeowner farm — every dwelling on the street from Council Tax.
    const rowsAll = [];
    for (const pc of pcs) { try { const ct = await councilTaxAddresses(pc); for (const r of (ct.rows || [])) rowsAll.push({ ...r, postcode: pc }); } catch { /* */ } }
    let rows = rowsAll;
    if (wantStreet) { const on = rowsAll.filter((r) => norm(r.street || r.address).includes(wantStreet)); if (on.length) rows = on; }
    for (const r of rows) {
      const k = norm(r.address); if (!k || seen.has(k)) continue; seen.add(k);
      if (exN && r.buildingNo && r.buildingNo === exN && (!wantStreet || norm(r.street).includes(wantStreet))) continue;
      neighbours.push({ address: r.address, postcode: r.postcode, buildingNo: r.buildingNo || '', flat: r.flat || '', addressee: 'The Homeowner' });
    }
    neighbours.sort((a, b) => (parseInt(a.buildingNo, 10) || 9999) - (parseInt(b.buildingNo, 10) || 9999));
  }

  sendJson(res, 200, { audience, postcode: postcode || pcs[0], street: street || null, wide, scannedPostcodes: pcs, count: neighbours.length, neighbours });
}
