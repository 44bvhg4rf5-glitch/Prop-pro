import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 60 };

// TEMP diagnostic: dump addressLine1 + the numeric codes per certificate so we
// can derive code->meaning empirically (address tells us flat vs house).
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const pcs = (u.searchParams.get('postcodes') || 'HA1 2HA,HA1 3UH,HA2 0AN,HA3 5AB').split(',').map((s) => s.trim().toUpperCase());
  const KEY = process.env.EPC_API_KEY || '';
  const rows = [];
  for (const pc of pcs) {
    const e = encodeURIComponent(pc).replace(/%20/g, '+');
    const s = await fetchJson(`${EPC_BASE}/api/domestic/search?postcode=${e}&page_size=12`, KEY);
    const data = (s.json && Array.isArray(s.json.data)) ? s.json.data : [];
    for (const r of data.slice(0, 6)) {
      const c = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(r.certificateNumber)}`, KEY);
      const b = (c.json && c.json.data) ? c.json.data : c.json;
      if (!b) continue;
      rows.push({ addr: `${r.addressLine1} ${r.addressLine2 || ''}`.trim(), pt: b.property_type, bf: b.built_form, tx: b.transaction_type, ten: b.tenure, m2: b.total_floor_area });
    }
  }
  sendJson(res, 200, { rows });
}
