import { rightmoveListings, onTheMarketListings, mergeListings } from '../lib/sources.js';
import { sendJson } from '../lib/helpers.js';

// Combined live search across Rightmove + OnTheMarket for one HA district.
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const channel = (u.searchParams.get('channel') || 'sale').toLowerCase();
  const minBeds = parseInt(u.searchParams.get('minBeds') || '0', 10) || 0;
  const maxPrice = parseInt(u.searchParams.get('maxPrice') || '0', 10) || 0;
  const opts = { channel, minBeds, maxPrice };

  const [rm, otm] = await Promise.all([
    rightmoveListings(district, opts).catch(() => []),
    onTheMarketListings(district, opts).catch(() => []),
  ]);

  const properties = mergeListings([rm, otm]);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, {
    district, channel,
    sources: { rightmove: rm.length, onthemarket: otm.length },
    total: properties.length,
    properties,
  });
}
