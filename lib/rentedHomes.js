import { EPC_BASE, fetchJson } from './helpers.js';
import { decodeTenure } from './rentals.js';

// ── Rented-Homes finder (EPC tenure, borough-wide) ──────────────────────────
// The licence register only names landlords in HA0/HA9 (Brent). For the rest of
// the Harrow patch (HA1/2/3/5/7/8…) the free landlord signal is EPC TENURE:
// every domestic certificate is coded owner-occupied / private-rented / social.
// Here we take a postcode's EPC list and read the tenure of EACH certificate,
// returning the ADDRESSES confirmed private-rented — i.e. landlord-owned homes,
// the real target list for landlord touting where we have no owner name.
// Free; uses the EPC key already configured on the server.

const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tidyPc = (s) => { const m = String(s || '').toUpperCase().match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/); if (!m) return ''; const p = m[0].replace(/\s+/g, ''); return p.slice(0, -3) + ' ' + p.slice(-3); };
const streetOf = (line1, line2) => norm((String(line1 || '').replace(/^\s*(flat|apartment|apt|unit|room)\s+[\w-]+,?\s*/i, '').replace(/^\d+[a-z]?\s*/i, '')) || line2 || '');

// Latest EPC row per address in a postcode.
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
      const k = norm(line1) + '|' + norm(r.addressLine2 || '');
      const date = (r.registrationDate || '').slice(0, 10);
      const rec = {
        cert: r.certificateNumber, line1: tcAddr(line1), line2: tcAddr(r.addressLine2 || ''),
        fullAddress: tcAddr(full), postcode: tidyPc(p) || p, uprn: r.uprn ? String(r.uprn) : '',
        kind: /\b(flat|apartment|maisonette)\b/i.test(full) ? 'flat' : 'house',
        street: streetOf(line1, r.addressLine2), date,
      };
      const ex = byAddr.get(k);
      if (!ex || (date && date > ex.date)) byAddr.set(k, rec);
    }
    return [...byAddr.values()];
  } catch { return []; }
}

const _certTenure = new Map();
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function certTenure(cert, key) {
  if (_certTenure.has(cert)) return _certTenure.get(cert);
  let t = 'unknown';
  // The EPC register rate-limits bursts of certificate reads with 429s. Back off
  // and retry a few times so a busy scan still resolves most tenures (a 429 that
  // falls through silently reads as "owner-occupied", biasing the rate down).
  const backoff = [300, 800, 1800, 3500];
  try {
    const url = `${EPC_BASE}/api/certificate?certificate_number=${encodeURIComponent(cert)}`;
    let r;
    for (let attempt = 0; attempt < backoff.length; attempt++) {
      r = await fetchJson(url, key);
      if (r.status !== 429) break;
      await sleep(backoff[attempt]);
    }
    const b = (r && r.json && r.json.data) ? r.json.data : (r && r.json);
    if (b) t = decodeTenure(b.tenure ?? b.TENURE);
  } catch { /* ignore */ }
  if (_certTenure.size > 6000) _certTenure.clear();
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

// Every confirmed private-rented home in a postcode. Reads the tenure of each
// EPC certificate (capped), so this is a real address list, not an estimate.
export async function rentedHomesForPostcode(pc, key, { certCap = 120, conc = 4 } = {}) {
  const rows = await epcRows(pc, key);
  const picks = rows.slice(0, certCap);
  const tenures = await mapLimit(picks, conc, (r) => certTenure(r.cert, key));
  const rented = [];
  let withTenure = 0;
  picks.forEach((r, i) => {
    const t = tenures[i];
    if (t !== 'unknown') withTenure++;
    if (t === 'private-rented') rented.push({ line1: r.line1, line2: r.line2, fullAddress: r.fullAddress, postcode: r.postcode, uprn: r.uprn, kind: r.kind, street: r.street });
  });
  return { postcode: tidyPc(pc) || pc, epcHomes: rows.length, sampled: picks.length, withTenure, rented };
}

// Group a flat list of rented homes into a ranked street table (densest first).
export function rankByStreet(homes) {
  const byStreet = new Map();
  for (const h of homes) {
    const key = h.street || norm(h.line1);
    if (!key) continue;
    const g = byStreet.get(key) || { street: h.street ? h.street.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : h.line1, postcodes: new Set(), count: 0, homes: [] };
    g.count++; g.postcodes.add(h.postcode); g.homes.push(h);
    byStreet.set(key, g);
  }
  return [...byStreet.values()]
    .map((g) => ({ street: g.street, count: g.count, postcodes: [...g.postcodes], homes: g.homes }))
    .sort((a, b) => b.count - a.count);
}

// Whole area/outcode: walk a page of its postcodes, collect confirmed rented
// homes. Paged so each request stays within the serverless time budget.
export async function rentedHomesForArea(postcodes, key, { start = 0, batch = 4, certCap = 70, conc = 4 } = {}) {
  const slice = postcodes.slice(start, start + batch);
  const all = [];
  let scanned = 0, epcHomes = 0, withTenure = 0;
  for (const pc of slice) {
    const r = await rentedHomesForPostcode(pc, key, { certCap, conc }).catch(() => null);
    if (!r) continue;
    scanned++; epcHomes += r.epcHomes; withTenure += r.withTenure;
    all.push(...r.rented);
  }
  return { postcodesScanned: scanned, postcodesAvailable: postcodes.length, nextStart: start + slice.length, done: start + slice.length >= postcodes.length, epcHomes, withTenure, rented: all };
}
