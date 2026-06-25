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

// All addresses at a postcode. Uses the OS Places API (Royal Mail PAF) when an
// OS_PLACES_KEY is configured; otherwise falls back to the EPC register.
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!postcode) { sendJson(res, 400, { error: 'postcode is required' }); return; }

  // 1. OS Places — full Royal Mail PAF address list.
  const OS = process.env.OS_PLACES_KEY || '';
  const debug = u.searchParams.get('debug') === '1';
  let osDiag = { osKeyPresent: !!OS, osStatus: null, osError: null };
  if (OS) {
    try {
      const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(postcode)}`
        + `&dataset=DPA&maxresults=100&key=${encodeURIComponent(OS)}`;
      const { status, json } = await getJson(url);
      osDiag.osStatus = status;
      if (status === 200 && json && Array.isArray(json.results)) {
        const addresses = json.results.map((r) => r.DPA).filter(Boolean).map((d) => {
          const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
          const line1 = tcAddr([d.SUB_BUILDING_NAME, d.BUILDING_NAME, d.BUILDING_NUMBER, d.THOROUGHFARE_NAME].filter(Boolean).join(' ').trim());
          return {
            line1,
            fullAddress: tcAddr(d.ADDRESS || ''),
            postcode: d.POSTCODE || postcode,
            type: cls.startsWith('R') ? 'Residential' : cls.startsWith('C') ? 'Commercial' : 'Other',
          };
        }).filter((a) => a.fullAddress);
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
