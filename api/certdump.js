import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 60 };

// TEMP validator for the "marketed sale" confirm tier: given a postcode, street,
// listing date and (optional) sqft, show every marketed-sale EPC near the date
// with its date-gap and floor area, so we can judge whether the lone match is
// genuinely THIS listing vs a different recent sale.
const SQFT = 10.7639;
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const days = (a, b) => Math.round(Math.abs((new Date(a) - new Date(b)) / 86400000));

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const pc = (u.searchParams.get('postcode') || '').toUpperCase().trim();
  const street = norm(u.searchParams.get('street') || '').replace(/^\d+[a-z]?\s+/, '');
  const listDate = (u.searchParams.get('listDate') || '').slice(0, 10);
  const listSqft = parseInt(u.searchParams.get('sqft') || '0', 10) || 0;
  const KEY = process.env.EPC_API_KEY || '';
  const e = encodeURIComponent(pc).replace(/%20/g, '+');
  const s = await fetchJson(`${EPC_BASE}/api/domestic/search?postcode=${e}&page_size=500`, KEY);
  let rows = (s.json && Array.isArray(s.json.data)) ? s.json.data : [];
  if (street) rows = rows.filter((r) => norm([r.addressLine1, r.addressLine2, r.addressLine3].filter(Boolean).join(' ')).includes(street));
  const near = rows
    .map((r) => ({ r, dd: r.registrationDate ? days(r.registrationDate, listDate) : 9999 }))
    .sort((a, b) => a.dd - b.dd).slice(0, 12);
  const out = [];
  for (const { r, dd } of near) {
    const c = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(r.certificateNumber)}`, KEY);
    const b = (c.json && c.json.data) ? c.json.data : c.json;
    const m2 = b ? parseFloat(b.total_floor_area) : NaN;
    const sqft = (!Number.isNaN(m2) && m2 > 0) ? Math.round(m2 * SQFT) : null;
    out.push({
      addr: [r.addressLine1, r.addressLine2].filter(Boolean).join(' '),
      regDate: r.registrationDate, dayGap: dd,
      tx: b ? b.transaction_type : '?', marketed: b ? b.transaction_type === 1 : false,
      sqft, sqftDiffPct: (listSqft && sqft) ? Math.round(Math.abs(sqft - listSqft) / listSqft * 100) : null,
    });
  }
  const marketedNear = out.filter((x) => x.marketed && x.dayGap <= 245);
  sendJson(res, 200, { postcode: pc, street, listDate, listSqft, marketedNearCount: marketedNear.length, candidates: out });
}
