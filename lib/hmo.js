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

const flatOf = (s) => ((String(s || '').match(/\b(?:flat|apt|apartment|unit|room)\s+([0-9]+[a-z]?|[a-z])\b/i) || [])[1] || '').toLowerCase();

// Is this exact address a licensed property? Returns the register record (with the
// landlord) or null. STRICT match — same postcode AND same house number, with
// consistent flat designators — so a single licensed property never spreads its
// landlord's name across the rest of the street (a wrong name on a letter is far
// worse than no name).
export function hmoLookup(line1, postcode) {
  const pc = pcNorm(postcode);
  if (!pc || !_byPc.has(pc)) return null;
  const num = numOf(line1);
  if (!num) return null;
  const inFlat = flatOf(line1);
  for (const r of _byPc.get(pc)) {
    if (numOf(r.a) !== num) continue;                 // different house number → not this property
    const rFlat = flatOf(r.a);
    if (inFlat && rFlat && inFlat !== rFlat) continue; // both name a flat but a different one → skip
    return { ...r, council: 'Brent', label: licenceLabel(r.t) };
  }
  return null;
}

export function hmoByDistrict(area) {
  const a = (area || '').toUpperCase();
  return HMO_HA.filter((r) => pcNorm(r.p).startsWith(a)).map((r) => ({ ...r, council: 'Brent', label: licenceLabel(r.t) }));
}

export function hmoCount() { return HMO_HA.length; }
