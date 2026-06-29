import { sendJson, guardOrigin, EPC_BASE, fetchJson } from '../lib/helpers.js';
import { councilTaxAddresses } from '../lib/counciltax.js';
import { listingDetail } from '../lib/listingDetail.js';

export const config = { maxDuration: 60 };

// TEMP diagnostic: for a given listing URL, show whether floor-area + type can
// UNIQUELY confirm the dwelling within the exact postcode. Reveals the ceiling
// of the "confirmed" tier vs a bug. Remove after measuring.  ?url=...
const SQFT = 10.7639;
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function certFloor(cert) {
  if (!cert) return null;
  try {
    const r = await fetchJson(`${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`, process.env.EPC_API_KEY || '');
    const b = (r.json && r.json.data) ? r.json.data : r.json;
    if (!b) return null;
    const m2 = parseFloat(b.total_floor_area ?? b.totalFloorArea);
    return { sqft: (!Number.isNaN(m2) && m2 > 0) ? Math.round(m2 * SQFT) : null, ptype: String(b.property_type ?? '').toLowerCase(), bform: String(b.built_form ?? '').toLowerCase() };
  } catch { return null; }
}
async function epcForPc(pc) {
  const KEY = process.env.EPC_API_KEY || '';
  if (!KEY) return [];
  try {
    const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
    const { status, json } = await fetchJson(url, KEY);
    const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
    return data.map((r) => ({ full: [r.addressLine1, r.addressLine2, r.postTown, (r.postcode || '').replace(/\+/g, ' ')].filter(Boolean).join(', '), cert: r.certificateNumber || '' }));
  } catch { return []; }
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const url = u.searchParams.get('url') || '';
  const d = await listingDetail(url).catch(() => null);
  if (!d) { sendJson(res, 200, { error: 'no detail', url }); return; }
  const street = norm((d.displayAddress || '').split(',')[0]).replace(/^\d+[a-z]?\s+/, '');
  const ct = await councilTaxAddresses(d.postcode).catch(() => ({ rows: [] }));
  const ctOnStreet = (ct.rows || []).filter((r) => norm(r.address).includes(street));
  const epc = (await epcForPc(d.postcode)).filter((e) => norm(e.full).includes(street));
  const sized = [];
  for (const e of epc.slice(0, 25)) { const f = await certFloor(e.cert); if (f && f.sqft) sized.push({ full: e.full, sqft: f.sqft, ptype: f.ptype, diff: d.sqft ? Math.abs(f.sqft - d.sqft) : null }); }
  sized.sort((a, b) => (a.diff ?? 1e9) - (b.diff ?? 1e9));
  sendJson(res, 200, {
    url, postcode: d.postcode, listSqft: d.sqft, type: d.type, street,
    ctOnStreet: ctOnStreet.length, epcOnStreet: epc.length, sizedOnStreet: sized.length,
    top: sized.slice(0, 6).map((s) => ({ full: s.full, sqft: s.sqft, diff: s.diff, ptype: s.ptype })),
  });
}
