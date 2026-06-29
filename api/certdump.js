import { EPC_BASE, fetchJson, sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// TEMP diagnostic: probe which SEARCH filters the new EPC API accepts, so we can
// narrow candidates by type / "marketed sale" without decoding numeric codes.
async function search(qs, KEY) {
  const r = await fetchJson(`${EPC_BASE}/api/domestic/search?${qs}`, KEY);
  const rows = (r.json && Array.isArray(r.json.data)) ? r.json.data : [];
  return { status: r.status, count: rows.length, certs: rows.slice(0, 4).map((x) => `${x.addressLine1}|${x.certificateNumber}`) };
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const pc = (u.searchParams.get('postcode') || 'HA1 2HA').toUpperCase().trim();
  const KEY = process.env.EPC_API_KEY || '';
  const e = encodeURIComponent(pc).replace(/%20/g, '+');
  const out = {};
  out.base = await search(`postcode=${e}&page_size=200`, KEY);
  out.ptype_flat = await search(`postcode=${e}&property-type=Flat&page_size=200`, KEY);
  out.ptype_house = await search(`postcode=${e}&property-type=House&page_size=200`, KEY);
  out.txn_marketed = await search(`postcode=${e}&transaction-type=marketed+sale&page_size=200`, KEY);
  out.txn_marketed2 = await search(`postcode=${e}&transaction-type=1&page_size=200`, KEY);
  out.bform_semi = await search(`postcode=${e}&built-form=Semi-Detached&page_size=200`, KEY);
  sendJson(res, 200, { postcode: pc, probes: out });
}
