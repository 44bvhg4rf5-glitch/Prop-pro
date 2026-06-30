import { HMO_HA } from './data/hmo-ha.js';
import { ppdByPostcode } from './landreg.js';
import { rentalStatsForStreet } from './rentals.js';

// ── Street / postcode market intelligence ───────────────────────────────────
// A quick, free read on a street so the user knows who to target BEFORE posting:
//   • homes        — residential dwellings found (Council Tax denominator)
//   • rentals      — licensed rentals on the street (selective + HMO register);
//                    a FLOOR, since only licensable lets appear
//   • sold (5 yrs) — distinct addresses sold in the last 5 years (Land Registry)
// From these we suggest landlord-letter vs vendor-letter targeting.

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normPc = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

// Licensed rentals (Brent register). Street mode matches the WHOLE street by
// name within its outcode (the register is local/instant, so we count the full
// street, not just the address-scan segment). Postcode mode matches the exact
// postcode(s).
function licensedRentals(streetName, postcodes, outcode) {
  const want = norm(streetName);
  const pcSet = new Set((postcodes || []).map(normPc));
  if (!want && !pcSet.size) return [];
  return HMO_HA.filter((r) => {
    const pc = normPc(r.p);
    if (want) {
      if (!norm(r.a).includes(want)) return false;
      if (outcode && !pc.startsWith(outcode)) return false;
      return true;
    }
    return pcSet.has(pc);
  });
}

// Distinct addresses on the street sold in the last 5 years, across its postcodes.
async function recentSales(streetName, postcodes, { lrBudget = 12, sinceISO } = {}) {
  const want = norm(streetName);
  const ctx = { lrBudget };
  let n = 0;
  for (const pc of (postcodes || [])) {
    const rows = await ppdByPostcode(pc, ctx).catch(() => []);
    n += rows.filter((r) => (!want || norm(r.street).includes(want) || want.includes(norm(r.street))) && r.date >= sinceISO).length;
  }
  return n;
}

function fiveYearsAgoISO() {
  const d = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function streetIntel({ streetName = '', postcodes = [], homes = 0, outcode = '', epcKey = '', lrBudget = 12 }) {
  const oc = (outcode || (postcodes[0] || '').toUpperCase().match(/^[A-Z]{1,2}\d[A-Z\d]?/)?.[0] || '').toUpperCase();
  const [lic, sold, epc] = await Promise.all([
    Promise.resolve(licensedRentals(streetName, postcodes, oc)),
    recentSales(streetName, postcodes, { lrBudget, sinceISO: fiveYearsAgoISO() }),
    rentalStatsForStreet(streetName, postcodes, epcKey).catch(() => ({ withTenure: 0, privateRented: 0, rentedAddresses: [] })),
  ]);
  const companies = lic.filter((r) => /ltd|limited|llp|plc|properties|holdings|investments|housing/i.test(r.h || '')).length;
  const soldPct = homes ? Math.round((sold / homes) * 100) : 0;
  // EPC tenure gives a borough-wide rental rate (works where licensing doesn't).
  // Only trust the % when the tenure sample is big enough to be meaningful.
  const epcSample = epc.withTenure || 0;
  const rentalRate = epcSample >= 6 ? Math.round((epc.privateRented / epcSample) * 100) : null;
  // Combined rental target count: licensed lets ∪ EPC-rented (deduped roughly).
  const rentedTargets = Math.max(lic.length, epc.privateRented || 0);

  let verdict, focus;
  if (lic.length >= 5 || (rentalRate != null && rentalRate >= 30)) { verdict = 'High rental density — a prime street for landlord letters.'; focus = 'landlord'; }
  else if (lic.length >= 1 || (rentalRate != null && rentalRate >= 12)) { verdict = 'A mix of lettings here — worth both landlord and vendor letters.'; focus = 'mixed'; }
  else if (soldPct >= 10) { verdict = 'Active sales market — good for vendor (sales) letters.'; focus = 'vendor'; }
  else { verdict = 'Looks mostly owner-occupied & settled — best for vendor letters.'; focus = 'vendor'; }

  return {
    homes, licensedRentals: lic.length, rentalCompanies: companies, sold5y: sold, soldPct,
    epcRented: epc.privateRented || 0, epcSample, rentalRate, rentedTargets,
    rentedAddresses: (epc.rentedAddresses || []).slice(0, 60),
    focus, verdict,
    lines: [
      homes ? `${homes} homes here` : null,
      rentalRate != null ? `~${rentalRate} in 100 privately rented (EPC)` : null,
      lic.length ? `${lic.length} licensed rental${lic.length === 1 ? '' : 's'}${companies ? ` (${companies} companies)` : ''}` : null,
      sold ? `${sold} sold in 5 yrs${homes ? ` (~${soldPct} in 100)` : ''}` : null,
    ].filter(Boolean),
  };
}
