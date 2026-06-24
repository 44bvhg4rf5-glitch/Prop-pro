import { rightmoveListings } from '../lib/sources.js';
import { sendJson } from '../lib/helpers.js';

// Rightmove-only live search for one HA district (kept for compatibility;
// the app now uses /api/listings, which also includes OnTheMarket).
export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const channel = (u.searchParams.get('channel') || 'sale').toLowerCase();
  const minBeds = parseInt(u.searchParams.get('minBeds') || '0', 10) || 0;
  const maxPrice = parseInt(u.searchParams.get('maxPrice') || '0', 10) || 0;

  try {
    const properties = await rightmoveListings(district, { channel, minBeds, maxPrice });
    res.setHeader('Access-Control-Allow-Origin', '*');
    sendJson(res, 200, { district, channel, total: properties.length, properties });
  } catch (e) {
    sendJson(res, 502, { error: 'Could not fetch Rightmove: ' + e.message });
  }
}
