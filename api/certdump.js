import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// TEMP diagnostic: dump the rich fields of a few EPC certificates for a postcode
// so we know which attributes are populated + matchable against a listing.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const pc = (u.searchParams.get('postcode') || 'HA1 3UH').toUpperCase().trim();
  const KEY = process.env.EPC_API_KEY || '';
  const surl = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=8`;
  const s = await fetchJson(surl, KEY);
  const rows = (s.json && Array.isArray(s.json.data)) ? s.json.data : [];
  const out = [];
  for (const r of rows.slice(0, 4)) {
    const cert = r.certificateNumber || '';
    const c = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`, KEY);
    const b = (c.json && c.json.data) ? c.json.data : c.json;
    if (!b) { out.push({ addr: r.addressLine1, cert, note: 'no cert body' }); continue; }
    out.push({
      addr: r.addressLine1,
      transaction_type: b.transaction_type,
      lodgement_date: b.lodgement_date,
      inspection_date: b.inspection_date,
      total_floor_area: b.total_floor_area,
      property_type: b.property_type,
      built_form: b.built_form,
      number_habitable_rooms: b.number_habitable_rooms,
      number_heated_rooms: b.number_heated_rooms,
      floor_level: b.floor_level,
      flat_top_storey: b.flat_top_storey,
      tenure: b.tenure,
      construction_age_band: b.construction_age_band,
    });
  }
  sendJson(res, 200, { postcode: pc, searchStatus: s.status, count: rows.length, certs: out });
}
