import { sendJson, guardOrigin } from '../lib/helpers.js';
import { landlordsForStreet, landlordsForPostcodes, landlordsForArea, portfolioLandlords, landlordSources } from '../lib/landlords.js';

// Named-landlord finder (licence registers + Land Registry company owners).
//   GET ?status=1                 → source counts
//   GET ?street=Kenton Road&area=HA3
//   GET ?postcode=HA0 4BP
//   GET ?area=HA9  [&portfolio=1] → all landlords (or only multi-property ones)
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');

  if (u.searchParams.get('status')) { sendJson(res, 200, { sources: landlordSources() }); return; }

  const street = (u.searchParams.get('street') || '').trim();
  const postcode = (u.searchParams.get('postcode') || '').trim();
  const area = (u.searchParams.get('area') || '').trim();
  const portfolioOnly = u.searchParams.get('portfolio') === '1';

  let landlords = [];
  if (street) landlords = landlordsForStreet(street, u.searchParams.get('area') || '');
  else if (postcode) landlords = landlordsForPostcodes([postcode]);
  else if (area) landlords = portfolioOnly ? portfolioLandlords(area, { min: 2 }) : landlordsForArea(area);
  else { sendJson(res, 400, { error: 'Pass street=, postcode=, or area=' }); return; }

  // De-dupe a landlord that appears on several of their properties into one row
  // per (name+property) but keep the portfolio count.
  const seen = new Set();
  landlords = landlords.filter((l) => { const k = (l.name + '|' + l.property).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.portfolio - a.portfolio);

  const companies = landlords.filter((l) => l.company).length;
  sendJson(res, 200, { total: landlords.length, companies, individuals: landlords.length - companies, landlords: landlords.slice(0, 300) });
}
