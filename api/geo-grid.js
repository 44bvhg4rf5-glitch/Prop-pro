import { sendJson, guardOrigin } from '../lib/helpers.js';
import { geoGridForPostcode, nearestInGrid } from '../lib/geoGrid.js';

export const config = { maxDuration: 20 };

// Geocoded address grid for a postcode (address + exact coordinate + UPRN).
//   GET ?postcode=HA1 3TD                    → full grid
//   GET ?postcode=HA1 3TD&lat=..&lon=..&street=.. → nearest address to a pin
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const osKey = process.env.OS_PLACES_KEY || '';
  const url = new URL(req.url, 'http://x');
  const pc = (url.searchParams.get('postcode') || '').trim();
  if (!pc) { sendJson(res, 400, { error: 'Send ?postcode=' }); return; }
  const grid = await geoGridForPostcode(pc, osKey);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const street = (url.searchParams.get('street') || '').trim();
  const out = { postcode: pc, osKey: !!osKey, count: grid.length, withCoords: grid.filter((g) => g.lat != null).length };
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) out.nearest = nearestInGrid(grid, lat, lon, { street });
  else out.grid = grid.slice(0, 100);
  sendJson(res, 200, out);
}
