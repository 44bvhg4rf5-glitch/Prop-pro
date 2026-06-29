import { sendJson, guardOrigin } from '../lib/helpers.js';
import { findOwner } from '../lib/owner.js';

// Owner research from FREE public records only (Companies House + PlanIt). Names
// are for postal personalisation; always verify before use and screen against
// MPS + the do-not-mail list.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const address = (u.searchParams.get('address') || '').trim();
  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const line1 = (u.searchParams.get('line1') || address.split(',')[0] || '').trim();
  if (!postcode && !address) { sendJson(res, 400, { error: 'address or postcode is required' }); return; }

  const { owners, planning, sources } = await findOwner(line1, postcode);
  const result = {
    address, postcode, owners, planning, sources,
    links: {
      landRegistry: 'https://search-property-information.service.gov.uk/',
      companiesHouse: 'https://find-and-update.company-information.service.gov.uk/search?q=' + encodeURIComponent(address || postcode),
      planning: 'https://www.planit.org.uk/find/applics?search=' + encodeURIComponent(((line1 ? line1 + ' ' : '') + postcode).trim()),
      openRegister: 'https://www.192.com/atoz/people/?search=' + encodeURIComponent(postcode),
    },
    note: owners.length
      ? 'Names from public records — verify before posting. Postal use only; screen against MPS and your do-not-mail list.'
      : 'No owner found in free records. Use the public-record links to look it up, or a Land Registry title (~£7) for the registered owner.',
  };
  sendJson(res, 200, result);
}
