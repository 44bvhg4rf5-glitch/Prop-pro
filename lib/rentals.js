import { EPC_BASE, fetchJson } from './helpers.js';

// ── EPC-tenure rental signal ────────────────────────────────────────────────
// The EPC register records each certificate's TENURE — "Owner-occupied",
// "Rented (private)", "Rented (social)". Privately-rented dwellings are
// landlord-owned, so this is a borough-wide rental finder that works EVERYWHERE
// (unlike the licence register, which only covers selective/HMO-designated
// areas). Free — uses the EPC key already configured.

const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tidyPc = (s) => { const m = String(s || '').toUpperCase().match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/); if (!m) return ''; const p = m[0].replace(/\s+/g, ''); return p.slice(0, -3) + ' ' + p.slice(-3); };

// Classify a raw EPC tenure string.
export function tenureKind(t) {
  const s = String(t || '').toLowerCase();
  if (/rental \(private\)|rented \(private\)|private rental|landlord/.test(s)) return 'private-rented';
  if (/rental \(social\)|rented \(social\)|social/.test(s)) return 'social-rented';
  if (/owner/.test(s)) return 'owner';
  return 'unknown';
}

// EPC rows for a postcode with tenure, de-duped to the LATEST cert per address.
export async function epcTenureByPostcode(pc, key) {
  if (!key) return [];
  try {
    const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
    const { status, json } = await fetchJson(url, key);
    const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
    const byAddr = new Map();
    for (const r of data) {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const p = (r.postcode || pc).replace(/\+/g, ' ');
      const full = [...lines, r.postTown, p].filter(Boolean).join(', ');
      if (!full) continue;
      const line1 = r.addressLine1 || lines[0] || '';
      const k = norm(line1);
      const date = (r['lodgement-date'] || r.lodgementDate || r.lodgement_datetime || '').slice(0, 10);
      const rec = {
        line1: tcAddr(line1), fullAddress: tcAddr(full), postcode: tidyPc(p) || p,
        uprn: r.uprn ? String(r.uprn) : '', tenure: tenureKind(r.tenure), tenureRaw: r.tenure || '',
        kind: /\b(flat|apartment|maisonette)\b/i.test(full) ? 'flat' : 'house', date,
        street: norm((r.addressLine1 || '').replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '').replace(/^\d+[a-z]?\s*/i, '') || r.addressLine2 || ''),
      };
      const ex = byAddr.get(k);
      if (!ex || (date && date > ex.date)) byAddr.set(k, rec);
    }
    return [...byAddr.values()];
  } catch { return []; }
}

// Rental stats + the privately-rented addresses for a postcode.
export async function rentalStatsForPostcode(pc, key) {
  const rows = await epcTenureByPostcode(pc, key);
  const withTenure = rows.filter((r) => r.tenure !== 'unknown');
  const privateRented = rows.filter((r) => r.tenure === 'private-rented');
  return {
    epcTotal: rows.length, withTenure: withTenure.length,
    privateRented: privateRented.length,
    ownerOcc: rows.filter((r) => r.tenure === 'owner').length,
    rentedAddresses: privateRented.map((r) => ({ line1: r.line1, fullAddress: r.fullAddress, postcode: r.postcode, uprn: r.uprn, kind: r.kind })),
    rows,
  };
}

// Aggregate rental stats across several postcodes (a street), street-filtered.
export async function rentalStatsForStreet(streetName, postcodes, key, { cap = 12 } = {}) {
  const want = norm(streetName);
  let total = 0, withT = 0, priv = 0; const rented = [];
  for (const pc of (postcodes || []).slice(0, cap)) {
    const rows = await epcTenureByPostcode(pc, key).catch(() => []);
    for (const r of rows) {
      if (want && !(r.street === want || (r.street && r.street.includes(want)) || norm(r.fullAddress).includes(want))) continue;
      total++;
      if (r.tenure !== 'unknown') withT++;
      if (r.tenure === 'private-rented') { priv++; rented.push({ line1: r.line1, fullAddress: r.fullAddress, postcode: r.postcode, uprn: r.uprn, kind: r.kind }); }
    }
  }
  return { epcTotal: total, withTenure: withT, privateRented: priv, rentedAddresses: rented };
}
