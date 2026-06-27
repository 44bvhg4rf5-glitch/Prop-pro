import { rightmoveListings, rightmoveListingsByLocation, onTheMarketListings, mergeListings } from '../lib/sources.js';
import { sendJson } from '../lib/helpers.js';

// Combined live search across Rightmove + OnTheMarket.
//   ?district=HA1                       → HA quick-pick (back-compat)
//   ?location=REGION^904&label=Manchester → any UK postcode / town / area
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const location = (u.searchParams.get('location') || '').trim();
  const label = (u.searchParams.get('label') || '').trim();
  const channel = (u.searchParams.get('channel') || 'sale').toLowerCase();
  const minBeds = parseInt(u.searchParams.get('minBeds') || '0', 10) || 0;
  const maxPrice = parseInt(u.searchParams.get('maxPrice') || '0', 10) || 0;
  const pages = Math.min(parseInt(u.searchParams.get('pages') || '1', 10) || 1, 5);
  const opts = { channel, minBeds, maxPrice };

  let rm = [], otm = [];
  if (location) {
    // Best-effort OnTheMarket slug from the area label (works for many towns).
    const slug = (label.split(',')[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    [rm, otm] = await Promise.all([
      rightmoveListingsByLocation(location, { ...opts, pages }, label || district).catch(() => []),
      (slug ? onTheMarketListings(slug, opts).catch(() => []) : Promise.resolve([])),
    ]);
  } else {
    [rm, otm] = await Promise.all([
      rightmoveListings(district, { ...opts, pages }).catch(() => []),
      onTheMarketListings(district, opts).catch(() => []),
    ]);
  }

  const properties = mergeListings([rm, otm]);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, {
    district: district || label, channel, location: location || null,
    sources: { rightmove: rm.length, onthemarket: otm.length },
    total: properties.length,
    properties,
  });
}
