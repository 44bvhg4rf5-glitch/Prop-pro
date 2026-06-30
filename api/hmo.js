import { sendJson, guardOrigin } from '../lib/helpers.js';
import { hmoLookup, hmoByDistrict, hmoCount } from '../lib/hmo.js';

// Free named-landlord data from council HMO licence registers (s.232 Housing Act
// 2004 public register). GET ?postcode=&line1=  → is this a licensed HMO + who
// holds the licence (the landlord). GET ?district=HA1 → list HMOs in a district.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const postcode = (u.searchParams.get('postcode') || '').trim();
  const line1 = (u.searchParams.get('line1') || '').trim();
  const note = 'Private-rented-sector licence registers (selective + HMO) are public under s.232 Housing Act 2004 — the licence holder is the landlord. Published for licensing transparency, NOT marketing — keep mail property-addressed ("The Landlord") and confirm a lawful basis before naming an individual.';

  if (postcode || line1) {
    const hit = hmoLookup(line1, postcode);
    sendJson(res, 200, { match: !!hit, record: hit || null, note });
    return;
  }
  if (district) {
    const list = hmoByDistrict(district);
    sendJson(res, 200, { district, total: list.length, records: list.slice(0, 1500), note });
    return;
  }
  sendJson(res, 200, { loaded: hmoCount(), councils: ['Brent'], note, usage: 'Pass ?district=HA1 or ?postcode=&line1=' });
}
