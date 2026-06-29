import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 60 };

// TEMP: derive the EPC `tenure` integer-code mapping. Address tells us flat/house;
// flats skew rented, houses skew owner-occupied — enough to fix the code values.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const pcs = (u.searchParams.get('postcodes') || 'HA1 2HA,HA1 3UH,HA0 4UB,HA1 1ER,HA2 0AN').split(',').map((s) => s.trim().toUpperCase());
  const KEY = process.env.EPC_API_KEY || '';
  const rows = [];
  for (const pc of pcs) {
    const e = encodeURIComponent(pc).replace(/%20/g, '+');
    const s = await fetchJson(`${EPC_BASE}/api/domestic/search?postcode=${e}&page_size=10`, KEY);
    const data = (s.json && Array.isArray(s.json.data)) ? s.json.data : [];
    for (const r of data.slice(0, 6)) {
      const c = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(r.certificateNumber)}`, KEY);
      const b = (c.json && c.json.data) ? c.json.data : c.json;
      if (!b) continue;
      rows.push({ addr: `${r.addressLine1} ${r.addressLine2 || ''}`.trim(), tenure: b.tenure, ptype: b.property_type });
    }
  }
  // tally tenure by flat/house
  const tally = {};
  for (const x of rows) {
    const kind = /^(flat|apartment|apt|unit|\d+[a-z]\b)/i.test(x.addr) ? 'flat' : 'house';
    const k = kind + ':tenure=' + x.tenure;
    tally[k] = (tally[k] || 0) + 1;
  }
  sendJson(res, 200, { rows, tally });
}
