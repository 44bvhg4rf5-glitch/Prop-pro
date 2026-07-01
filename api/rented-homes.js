import { sendJson, guardOrigin } from '../lib/helpers.js';
import { postcodesInArea } from '../lib/freeAddresses.js';
import { rentedHomesForPostcode, rentedHomesForArea, rankByStreet } from '../lib/rentedHomes.js';

export const config = { maxDuration: 60 };

// Rented-Homes finder — confirmed private-rented (landlord-owned) addresses via
// EPC tenure. The free landlord target list for HA1/2/3/5/7/8 where we have no
// owner name (unlike the Brent-register named landlords in HA0/HA9).
//
//   GET ?postcode=HA1 2XX          → rented homes in that postcode
//   GET ?area=HA1&start=0&batch=8  → rented homes across a page of the outcode
//        (returns nextStart / done so the caller can page through the outcode)
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const key = process.env.EPC_API_KEY || '';
  if (!key) { sendJson(res, 503, { error: 'No EPC_API_KEY configured — the rented-homes signal needs the EPC register key.' }); return; }

  const url = new URL(req.url, 'http://x');
  const postcode = (url.searchParams.get('postcode') || '').trim();
  const area = (url.searchParams.get('area') || '').trim();
  const debug = url.searchParams.get('debug');

  // TEMP diagnostic: dump the raw certificate JSON for one postcode's first few
  // certs so we can see the actual tenure field name/values.
  if (debug) {
    const { EPC_BASE, fetchJson } = await import('../lib/helpers.js');
    const gap = Math.max(0, parseInt(url.searchParams.get('gap') || '150', 10) || 0);
    const n = Math.min(60, Math.max(1, parseInt(url.searchParams.get('n') || '40', 10) || 40));
    const search = await fetchJson(`${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(debug).replace(/%20/g, '+')}&page_size=500`, key);
    const rows = (search.json && search.json.data) || [];
    const t0 = Date.now();
    const tally = { 200: 0, 429: 0, other: 0 }; const tenures = {}; let first429At = -1;
    const picks = rows.slice(0, n);
    for (let i = 0; i < picks.length; i++) {
      const d = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(picks[i].certificateNumber)}`, key);
      if (d.status === 200) tally[200]++; else if (d.status === 429) { tally[429]++; if (first429At < 0) first429At = i; } else tally.other++;
      const b = (d.json && d.json.data) ? d.json.data : d.json;
      const tv = b && (b.tenure ?? b.TENURE);
      if (tv != null) tenures[String(tv)] = (tenures[String(tv)] || 0) + 1;
      if (gap) await new Promise((s) => setTimeout(s, gap));
    }
    sendJson(res, 200, { debug, gap, requested: picks.length, ms: Date.now() - t0, tally, first429At, tenures });
    return;
  }

  try {
    if (postcode) {
      const r = await rentedHomesForPostcode(postcode, key);
      sendJson(res, 200, { source: 'EPC tenure', mode: 'postcode', ...r, byStreet: rankByStreet(r.rented) });
      return;
    }
    if (area) {
      const start = Math.max(0, parseInt(url.searchParams.get('start') || '0', 10) || 0);
      const batch = Math.min(8, Math.max(1, parseInt(url.searchParams.get('batch') || '4', 10) || 4));
      const pcs = await postcodesInArea(area);
      if (!pcs.length) { sendJson(res, 404, { error: `No postcodes found for ${area}.` }); return; }
      const r = await rentedHomesForArea(pcs, key, { start, batch });
      sendJson(res, 200, { source: 'EPC tenure', mode: 'area', area, ...r, byStreet: rankByStreet(r.rented) });
      return;
    }
    sendJson(res, 400, { error: 'Send ?postcode=HA1 2XX or ?area=HA1' });
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
}
