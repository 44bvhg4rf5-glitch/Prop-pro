import { HMO_HA } from './data/hmo-ha.js';

// Free named-landlord lookup from council Private Rented Sector licence registers
// (currently Brent, HA postcodes — the statutory s.232 public register). Covers
// BOTH selective licences (every private rental in the designated area) and HMO
// licences (mandatory/additional). The licence holder is the landlord. Published
// for licensing transparency, NOT marketing — callers should keep mail
// property-addressed and confirm a lawful basis before naming.

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const numOf = (s) => ((String(s || '').match(/\d+[a-z]?/i) || [''])[0]).toLowerCase();
const pcNorm = (s) => (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
// Human label for the licence type → describes the kind of landlord.
export const licenceLabel = (t) => /selective/i.test(t || '') ? 'selective licence' : 'HMO licence';

// Index by postcode for fast lookup.
const _byPc = new Map();
for (const r of HMO_HA) {
  const pc = pcNorm(r.p);
  if (!_byPc.has(pc)) _byPc.set(pc, []);
  _byPc.get(pc).push(r);
}

// Is this address a licensed HMO? Returns the register record (with landlord) or null.
export function hmoLookup(line1, postcode) {
  const pc = pcNorm(postcode);
  if (!pc || !_byPc.has(pc)) return null;
  const cands = _byPc.get(pc);
  const num = numOf(line1);
  const hay = norm(line1);
  // Prefer a house-number match within the postcode; fall back to a building-name
  // overlap (for "Flat X, Some Court").
  for (const r of cands) { if (num && numOf(r.a) === num) return { ...r, council: 'Brent', label: licenceLabel(r.t) }; }
  for (const r of cands) { const ra = norm(r.a); if (hay && (ra.includes(hay) || hay.includes(ra.replace(/\d+[a-z]?\s*/, '').split(',')[0].trim()))) return { ...r, council: 'Brent', label: licenceLabel(r.t) }; }
  return null;
}

export function hmoByDistrict(area) {
  const a = (area || '').toUpperCase();
  return HMO_HA.filter((r) => pcNorm(r.p).startsWith(a)).map((r) => ({ ...r, council: 'Brent', label: licenceLabel(r.t) }));
}

export function hmoCount() { return HMO_HA.length; }
