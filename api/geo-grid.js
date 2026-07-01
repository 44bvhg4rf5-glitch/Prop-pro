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
  if (url.searchParams.get('debug')) {
    const https = await import('https');
    const u = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(pc)}&dataset=DPA&maxresults=5&output_srs=EPSG:4326&key=${encodeURIComponent(osKey)}`;
    const raw = await new Promise((resolve) => {
      const r = https.get(u, (rr) => { let b = ''; rr.on('data', (c) => (b += c)); rr.on('end', () => resolve({ status: rr.statusCode, body: b.slice(0, 500) })); });
      r.on('error', (e) => resolve({ status: 0, body: String(e) })); r.setTimeout(12000, () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
    });
    sendJson(res, 200, { osKeyPresent: !!osKey, osKeyLen: osKey.length, osStatus: raw.status, osBody: raw.body });
    return;
  }
  const grid = await geoGridForPostcode(pc, osKey);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const street = (url.searchParams.get('street') || '').trim();
  const out = { postcode: pc, osKey: !!osKey, count: grid.length, withCoords: grid.filter((g) => g.lat != null).length };
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) out.nearest = nearestInGrid(grid, lat, lon, { street });
  else out.grid = grid.slice(0, 100);
  sendJson(res, 200, out);
}
