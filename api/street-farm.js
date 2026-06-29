import https from 'https';
import { sendJson, guardOrigin, reverseGeocode } from '../lib/helpers.js';
import { councilTaxAddresses } from '../lib/counciltax.js';

export const config = { maxDuration: 30 };

// Sold-Street Farming: given a registered sale, return EVERY dwelling on its
// street from the Council Tax register (a COMPLETE list — not just homes with an
// EPC) so the user can post "we just sold nearby" letters to The Homeowner at
// each. Free, exact, full coverage, and GDPR-safe (no named individuals).
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';

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

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || '').toUpperCase().trim();
  const street = (u.searchParams.get('street') || '').trim();
  const exclude = (u.searchParams.get('exclude') || '').trim();   // the sold house number/name, to skip
  const wide = u.searchParams.get('wide') !== '0';                  // street-wide (nearby postcodes) by default
  if (!postcode) { sendJson(res, 400, { error: 'postcode required' }); return; }
  const area = outcodeOf(postcode);
  const wantStreet = norm(street);

  // The postcodes to scan: the sale's own postcode, plus (street-wide) the
  // nearby postcodes in the same outcode — the rest of the street.
  let pcs = [postcode];
  if (wide) {
    try {
      const ll = await pcLatLon(postcode);
      if (ll) {
        const near = await reverseGeocode(ll.lat, ll.lon);
        pcs = [...new Set([postcode, ...near])].filter((p) => outcodeOf(p) === area).slice(0, 5);
      }
    } catch { /* postcode-level only */ }
  }

  // Gather every dwelling across those postcodes from Council Tax (cached).
  const rowsAll = [];
  for (const pc of pcs) {
    try { const ct = await councilTaxAddresses(pc); for (const r of (ct.rows || [])) rowsAll.push({ ...r, postcode: pc }); }
    catch { /* skip this postcode */ }
  }

  // Keep the sold property's street when we know it (street-wide); otherwise the
  // whole postcode is the farm.
  let rows = rowsAll;
  if (wantStreet) {
    const onStreet = rowsAll.filter((r) => norm(r.street || r.address).includes(wantStreet));
    if (onStreet.length) rows = onStreet;     // fall back to postcode-level if the street name didn't match
  }

  const exN = ((exclude.match(/\d+[a-z]?/i) || [''])[0]).toLowerCase();
  const seen = new Set();
  const neighbours = [];
  for (const r of rows) {
    const key = norm(r.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (exN && r.buildingNo && r.buildingNo === exN && (!wantStreet || norm(r.street).includes(wantStreet))) continue; // skip the sold home
    neighbours.push({ address: r.address, postcode: r.postcode, buildingNo: r.buildingNo || '', flat: r.flat || '', band: r.band || '' });
  }
  neighbours.sort((a, b) => (parseInt(a.buildingNo, 10) || 9999) - (parseInt(b.buildingNo, 10) || 9999));

  sendJson(res, 200, { postcode, street: street || null, wide, scannedPostcodes: pcs, count: neighbours.length, neighbours });
}
