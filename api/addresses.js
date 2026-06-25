import https from 'https';
import { EPC_BASE, fetchJson, sendJson } from '../lib/helpers.js';

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}

// Title-case an UPPER-CASE PAF address for letters: capitalise each word, but
// keep any token containing a digit fully upper (house numbers like 75A and
// postcode parts like HA2 / 8AB stay correct).
function tcAddr(s) {
  return (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) =>
    /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
}

// Normalise a street/town for loose comparison.
function norm(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

// Map an OS Places DPA record to our address shape.
function mapDpa(d, fallbackPc) {
  const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
  const line1 = tcAddr([d.SUB_BUILDING_NAME, d.BUILDING_NAME, d.BUILDING_NUMBER, d.THOROUGHFARE_NAME].filter(Boolean).join(' ').trim());
  return {
    line1,
    fullAddress: tcAddr(d.ADDRESS || ''),
    postcode: d.POSTCODE || fallbackPc || '',
    type: cls.startsWith('R') ? 'Residential' : cls.startsWith('C') ? 'Commercial' : 'Other',
  };
}

// Street search: every address on a named street, across all its postcodes,
// via the OS Places free-text "find" endpoint (paged). OS key required.
async function streetSearch(res, street, OS) {
  if (!OS) {
    sendJson(res, 200, { street, total: 0, addresses: [], error: 'Street search needs an OS Places key (the EPC register can only look up by postcode).' });
    return;
  }
  const parts = street.split(',').map((s) => s.trim()).filter(Boolean);
  const streetName = norm(parts[0]);
  const town = norm(parts.slice(1).join(' '));
  const wanted = [];
  let total = 0;
  for (let offset = 0; offset < 500; offset += 100) {
    const url = `https://api.os.uk/search/places/v1/find?query=${encodeURIComponent(street)}`
      + `&dataset=DPA&maxresults=100&offset=${offset}&key=${encodeURIComponent(OS)}`;
    const { status, json } = await getJson(url);
    if (status !== 200 || !json || !Array.isArray(json.results)) break;
    json.results.map((r) => r.DPA).filter(Boolean).forEach((d) => {
      const thoro = norm(d.THOROUGHFARE_NAME);
      const depThoro = norm(d.DEPENDENT_THOROUGHFARE_NAME);
      const onStreet = streetName && (thoro === streetName || depThoro === streetName);
      const inTown = !town || norm(d.POST_TOWN).includes(town) || norm(d.ADDRESS).includes(town);
      if (onStreet && inTown) wanted.push(mapDpa(d));
    });
    total = (json.header && json.header.totalresults) || 0;
    if (offset + 100 >= total) break;
  }
  // De-duplicate and drop commercial (we only post to homes).
  const seen = new Map();
  wanted.filter((a) => a.type !== 'Commercial' && a.fullAddress).forEach((a) => {
    const k = a.fullAddress.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  });
  const addresses = [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
  const postcodes = [...new Set(addresses.map((a) => a.postcode).filter(Boolean))];
  sendJson(res, 200, {
    street, source: 'Royal Mail / OS Places', total: addresses.length, addresses, postcodes,
    note: addresses.length ? `${addresses.length} homes across ${postcodes.length} postcode(s).`
      : 'No matching addresses — check the street name and include the town (e.g. "Roxeth Green Avenue, Harrow").',
  });
}

// All addresses at a postcode (or street). Uses the OS Places API (Royal Mail
// PAF) when an OS_PLACES_KEY is configured; otherwise falls back to the EPC
// register for postcode lookups.
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const OS_KEY = process.env.OS_PLACES_KEY || '';

  // Street mode takes precedence when a ?street= is supplied.
  const street = (u.searchParams.get('street') || '').trim();
  if (street) { await streetSearch(res, street, OS_KEY); return; }

  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!postcode) { sendJson(res, 400, { error: 'postcode or street is required' }); return; }

  // 1. OS Places — full Royal Mail PAF address list.
  const OS = OS_KEY;
  const debug = u.searchParams.get('debug') === '1';
  let osDiag = { osKeyPresent: !!OS, osStatus: null, osError: null };
  if (OS) {
    try {
      const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(postcode)}`
        + `&dataset=DPA&maxresults=100&key=${encodeURIComponent(OS)}`;
      const { status, json } = await getJson(url);
      osDiag.osStatus = status;
      if (status === 200 && json && Array.isArray(json.results)) {
        const addresses = json.results.map((r) => r.DPA).filter(Boolean)
          .map((d) => mapDpa(d, postcode)).filter((a) => a.fullAddress);
        sendJson(res, 200, { postcode, source: 'Royal Mail / OS Places', total: addresses.length, addresses });
        return;
      }
      // Non-200 or unexpected shape — capture the OS message (no key leaked).
      osDiag.osError = (json && (json.error?.message || json.error || json.message)) || 'unexpected response';
    } catch (e) { osDiag.osError = e.message; }
  }
  if (debug) { sendJson(res, 200, { postcode, debug: osDiag, hasEpcKey: !!(process.env.EPC_API_KEY || '') }); return; }

  // 2. EPC register fallback (works with the existing key).
  const KEY = process.env.EPC_API_KEY || '';
  if (KEY) {
    try {
      const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, '+')}&page_size=500`;
      const { status, json } = await fetchJson(url, KEY);
      // The EPC register returns 200 with a data array when there are records,
      // and 404 (or 200 with no data) for a postcode with no certificates.
      // Both are valid "we looked, here's what's registered" answers.
      const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
      const seen = new Map();
      data.forEach((r) => {
        const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
        const pc = (r.postcode || '').replace(/\+/g, ' ');
        const full = [...lines, r.postTown, pc].filter(Boolean).join(', ');
        const key = full.toLowerCase();
        if (full && !seen.has(key)) seen.set(key, { line1: r.addressLine1 || lines[0] || '', fullAddress: full, postcode: pc, type: 'Residential' });
      });
      const addresses = [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
      sendJson(res, 200, {
        postcode, source: 'EPC register', total: addresses.length, addresses,
        note: addresses.length
          ? 'Homes with an Energy Certificate. Add a free OS Places key for the complete Royal Mail list.'
          : 'No registered Energy Certificates at this postcode (common for town-centre / commercial postcodes). Add a free OS Places key for the complete Royal Mail list.',
      });
      return;
    } catch { /* fall through to the no-source response */ }
  }

  sendJson(res, 200, { postcode, total: 0, addresses: [], error: 'No address source available. Set EPC_API_KEY or OS_PLACES_KEY.' });
}
