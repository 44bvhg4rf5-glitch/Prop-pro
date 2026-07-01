import https from 'https';
import { getJSON, setJSON, storeConfigured } from './store.js';

// ── Free/near-free geocoded address grid ────────────────────────────────────
// The paid-grade "address list + exact coordinate" grid that makes portal-pin →
// exact-house matching reliable (the piece Spectre pays PAF/AddressBase for).
// Built from the OS Places API (DPA = Royal Mail PAF) which the account already
// has a key for. Crucially we keep each address's COORDINATE (output_srs=4326)
// so we can pick the address nearest the listing's map pin — an exact match, not
// a guess. KV-cached per postcode so each postcode is fetched from OS once ever.

const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function getJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'PropMailPro/1.0' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(b) }); } catch { resolve({ status: r.statusCode, json: null }); } });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, json: null }); });
  });
}

function mapDpa(d) {
  const cls = (d.CLASSIFICATION_CODE || '').toUpperCase();
  // With output_srs=EPSG:4326, X_COORDINATE = longitude, Y_COORDINATE = latitude.
  const lon = d.LNG != null ? +d.LNG : (d.X_COORDINATE != null ? +d.X_COORDINATE : null);
  const lat = d.LAT != null ? +d.LAT : (d.Y_COORDINATE != null ? +d.Y_COORDINATE : null);
  return {
    line1: tc([d.SUB_BUILDING_NAME, d.BUILDING_NAME, d.BUILDING_NUMBER, d.THOROUGHFARE_NAME].filter(Boolean).join(' ').trim()),
    fullAddress: tc(d.ADDRESS || ''),
    postcode: d.POSTCODE || '',
    uprn: d.UPRN ? String(d.UPRN) : '',
    street: norm((d.THOROUGHFARE_NAME || '') + ' ' + (d.DEPENDENT_THOROUGHFARE_NAME || '')),
    lat, lon,
    commercial: cls.startsWith('C'),
  };
}

// Grid for one postcode: every delivery-point address with its coordinate.
export async function geoGridForPostcode(pc, osKey) {
  const key = String(pc || '').toUpperCase().replace(/\s+/g, '');
  if (!key) return [];
  const ck = 'grid:' + key;
  if (storeConfigured()) { const c = await getJSON(ck, null); if (Array.isArray(c)) return c; }
  if (!osKey) return [];
  const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(pc)}&dataset=DPA&maxresults=100&output_srs=EPSG:4326&key=${encodeURIComponent(osKey)}`;
  const { status, json } = await getJson(url);
  if (status !== 200 || !json || !Array.isArray(json.results)) return [];
  const grid = json.results.map((r) => r.DPA).filter(Boolean).map(mapDpa).filter((a) => a.fullAddress && !a.commercial);
  if (grid.length && storeConfigured()) setJSON(ck, grid).catch(() => {});
  return grid;
}

// Metres between two lat/lon points (haversine).
export function distM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const toR = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const la1 = a.lat * toR, la2 = b.lat * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pick the grid address nearest the listing pin. Returns the best match plus a
// confidence: 'high' when one address is clearly closest (near the pin AND well
// clear of the runner-up), else 'medium'/'low'.
export function nearestInGrid(grid, lat, lon, { street = '' } = {}) {
  if (!grid || !grid.length || lat == null || lon == null) return null;
  const want = norm(street);
  let pool = grid.filter((g) => g.lat != null);
  if (want) { const on = pool.filter((g) => g.street.includes(want) || norm(g.fullAddress).includes(want)); if (on.length) pool = on; }
  if (!pool.length) return null;
  const ranked = pool.map((g) => ({ ...g, distM: distM({ lat, lon }, g) })).sort((a, b) => a.distM - b.distM);
  const best = ranked[0], next = ranked[1];
  let confidence = 'low';
  if (best.distM <= 25) confidence = 'high';
  else if (best.distM <= 60 && (!next || next.distM - best.distM >= 20)) confidence = 'high';
  else if (best.distM <= 120) confidence = 'medium';
  return { ...best, confidence, runnerUpM: next ? Math.round(next.distM) : null, candidates: ranked.slice(0, 8) };
}
