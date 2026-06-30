import { EPC_BASE, fetchJson } from './helpers.js';

// ── EPC-tenure rental signal (borough-wide) ─────────────────────────────────
// The EPC SEARCH response doesn't carry tenure — only the full CERTIFICATE does
// (integer-coded: 1=owner-occupied, 2=rented social, 3=rented private). So we
// take the street's EPC list, SAMPLE a handful of certificates, read their
// tenure, and extrapolate a private-rental RATE. This works everywhere (unlike
// the licence register, which only covers selective/HMO areas) — the key
// lettings signal for HA1/2/3. Free; uses the EPC key already configured.

const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tidyPc = (s) => { const m = String(s || '').toUpperCase().match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/); if (!m) return ''; const p = m[0].replace(/\s+/g, ''); return p.slice(0, -3) + ' ' + p.slice(-3); };

export function decodeTenure(t) {
  const s = String(t == null ? '' : t).toLowerCase().trim();
  if (s === '1' || /owner/.test(s)) return 'owner';
  if (s === '3' || /rental \(private\)|rented \(private\)|private rent/.test(s)) return 'private-rented';
  if (s === '2' || /rental \(social\)|rented \(social\)|social/.test(s)) return 'social-rented';
  return 'unknown';
}

// EPC search rows (address + certificate number) for a postcode, latest per address.
async function epcRows(pc, key) {
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
      const line1 = r.addressLine1 || lines[0] || '';
      if (!full || !r.certificateNumber) continue;
      const k = norm(line1);
      const date = (r.registrationDate || '').slice(0, 10);
      const street = norm((line1.replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '').replace(/^\d+[a-z]?\s*/i, '')) || r.addressLine2 || '');
      const rec = { cert: r.certificateNumber, line1: tcAddr(line1), fullAddress: tcAddr(full), postcode: tidyPc(p) || p, uprn: r.uprn ? String(r.uprn) : '', kind: /\b(flat|apartment|maisonette)\b/i.test(full) ? 'flat' : 'house', street, date };
      const ex = byAddr.get(k);
      if (!ex || (date && date > ex.date)) byAddr.set(k, rec);
    }
    return [...byAddr.values()];
  } catch { return []; }
}

// Tenure for one certificate (cached per cert on the warm instance).
const _certTenure = new Map();
async function certTenure(cert, key) {
  if (_certTenure.has(cert)) return _certTenure.get(cert);
  let t = 'unknown';
  try {
    const url = `${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`;
    let r = await fetchJson(url, key);
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 400)); r = await fetchJson(url, key); }
    const b = (r.json && r.json.data) ? r.json.data : r.json;
    if (b) t = decodeTenure(b.tenure ?? b.TENURE);
  } catch { /* ignore */ }
  if (_certTenure.size > 4000) _certTenure.clear();
  _certTenure.set(cert, t);
  return t;
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j]); }
  }));
  return out;
}

// Private-rental RATE for a street, by sampling certificates. Returns the rate,
// the tenure sample size, and the addresses sampled-and-confirmed private-rented.
export async function rentalStatsForStreet(streetName, postcodes, key, { sample = 18, pcCap = 12, conc = 6 } = {}) {
  if (!key) return { withTenure: 0, privateRented: 0, rentalRate: null, rentedAddresses: [], epcOnStreet: 0 };
  const want = norm(streetName);
  // 1. gather the street's EPC rows across its postcodes
  const rowsByPc = await mapLimit((postcodes || []).slice(0, pcCap), conc, (pc) => epcRows(pc, key));
  let rows = [];
  for (const rs of rowsByPc) for (const r of rs) {
    if (!want || r.street === want || (r.street && r.street.includes(want)) || norm(r.fullAddress).includes(want)) rows.push(r);
  }
  const epcOnStreet = rows.length;
  if (!epcOnStreet) return { withTenure: 0, privateRented: 0, rentalRate: null, rentedAddresses: [], epcOnStreet: 0 };
  // 2. sample certificates for tenure (evenly across the list)
  const step = Math.max(1, Math.floor(rows.length / sample));
  const picks = []; for (let i = 0; i < rows.length && picks.length < sample; i += step) picks.push(rows[i]);
  const tenures = await mapLimit(picks, conc, (r) => certTenure(r.cert, key));
  let withT = 0, priv = 0; const rented = [];
  picks.forEach((r, i) => { const t = tenures[i]; if (t !== 'unknown') withT++; if (t === 'private-rented') { priv++; rented.push({ line1: r.line1, fullAddress: r.fullAddress, postcode: r.postcode, uprn: r.uprn, kind: r.kind }); } });
  const rate = withT >= 5 ? Math.round((priv / withT) * 100) : null;
  return { withTenure: withT, privateRented: priv, rentalRate: rate, sampled: picks.length, epcOnStreet, rentedAddresses: rented };
}
