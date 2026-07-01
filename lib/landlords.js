import { HMO_HA } from './data/hmo-ha.js';
import { HARROW_LICENCES } from './data/harrow-licences.js';
import { CCOD_HA } from './data/ccod-ha.js';

// ── Unified landlord intelligence layer ─────────────────────────────────────
// Merges every named-landlord source into one shape and adds:
//   • PORTFOLIO size — how many properties each landlord holds in the data (#3)
//   • CORRESPONDENCE address — the landlord's OWN posting address where known,
//     so letters reach the landlord, not the tenant (#5)
// Sources: Brent licence register (HA0/HA9, have) · Harrow licence register
// (HA1/2/3, when loaded) · Land Registry CCOD company owners (when loaded).

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normPc = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
// Outcode = the postcode minus its 3-char inward part (avoids mis-splitting the
// inward digit into the district, e.g. HA0 4LL → HA0 not HA04).
const outcodeOf = (pc) => { const p = normPc(pc); return p.length > 3 ? p.slice(0, -3) : p; };
const isCompany = (n) => /\b(ltd|limited|llp|plc|inc|corp|properties|holdings|investments|housing|estates|lettings|nominee|partners?|group|homes|management|capital|developments|ventures|realty|assets)\b/i.test(n || '');
const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

// Normalise every source into: { name, propertyAddress, postcode, outcode,
// source, licence, corr, company }.
function unify() {
  const out = [];
  for (const r of HMO_HA) if (r && r.h) out.push({ name: r.h, propertyAddress: r.a, postcode: r.p, outcode: outcodeOf(r.p), source: 'Brent register', licence: r.t || 'Licence', corr: r.c || '', company: isCompany(r.h) });
  for (const r of HARROW_LICENCES) if (r && r.h) out.push({ name: r.h, propertyAddress: r.a, postcode: r.p, outcode: outcodeOf(r.p), source: 'Harrow register', licence: r.t || 'Licence', corr: r.c || '', company: isCompany(r.h) });
  for (const r of CCOD_HA) if (r && r.company) out.push({ name: r.company, propertyAddress: r.a, postcode: r.p, outcode: outcodeOf(r.p), source: 'Land Registry (company)', licence: 'company owner', corr: r.corr || '', company: true, cro: r.cro || '' });
  return out;
}

let _all = null, _byName = null;
function all() {
  if (_all) return _all;
  _all = unify();
  // Portfolio index: how many properties each landlord (by normalised name) holds.
  _byName = new Map();
  for (const l of _all) { const k = norm(l.name); if (!_byName.has(k)) _byName.set(k, []); _byName.get(k).push(l); }
  for (const l of _all) l.portfolio = (_byName.get(norm(l.name)) || []).length;
  return _all;
}

export function landlordSources() {
  const a = all();
  return { total: a.length, brent: a.filter((l) => l.source === 'Brent register').length, harrow: a.filter((l) => l.source === 'Harrow register').length, ccod: a.filter((l) => l.source === 'Land Registry (company)').length, named: new Set(a.map((l) => norm(l.name))).size };
}

// Shape a matched record for the API.
function shape(l) {
  const corr = l.corr && norm(l.corr) !== norm(l.propertyAddress) ? tc(l.corr) : '';
  return {
    name: l.name, property: tc(l.propertyAddress), postcode: (l.postcode || '').toUpperCase(),
    source: l.source, licence: l.licence, company: !!l.company, portfolio: l.portfolio || 1,
    corr, // the landlord's own posting address, when it differs from the let property
    writeTo: corr || tc(l.propertyAddress), // where a letter should actually go
  };
}

// Landlords whose licensed/owned property is in these postcodes.
export function landlordsForPostcodes(postcodes) {
  const set = new Set((postcodes || []).map(normPc));
  if (!set.size) return [];
  return all().filter((l) => set.has(normPc(l.postcode))).map(shape);
}

// Landlords on a named street (optionally within an outcode).
export function landlordsForStreet(streetName, outcode) {
  const want = norm(streetName);
  if (!want) return [];
  const oc = normPc(outcode || '');
  return all().filter((l) => norm(l.propertyAddress).includes(want) && (!oc || l.outcode.startsWith(oc) || normPc(l.postcode).startsWith(oc))).map(shape);
}

// Landlords across an outcode/sector.
export function landlordsForArea(token) {
  const t = normPc(token);
  if (!t) return [];
  return all().filter((l) => normPc(l.postcode).startsWith(t)).map(shape);
}

// The biggest portfolios in an area — one letter can win a block of management.
export function portfolioLandlords(token, { min = 2, limit = 100 } = {}) {
  const t = normPc(token || '');
  const seen = new Map();
  for (const l of all()) {
    if (t && !l.outcode.startsWith(t) && !normPc(l.postcode).startsWith(t)) continue;
    const k = norm(l.name);
    if (!seen.has(k)) seen.set(k, shape(l));
  }
  return [...seen.values()].filter((l) => l.portfolio >= min).sort((a, b) => b.portfolio - a.portfolio).slice(0, limit);
}
