// Shared helpers for the Vercel serverless functions (api/*.js).
// Kept outside /api so Vercel doesn't treat it as its own endpoint.
import https from 'https';

export const OUTCODES = {
  HA0: 1053, HA1: 1054, HA2: 1055, HA3: 1056, HA4: 1057,
  HA5: 1058, HA6: 1059, HA7: 1060, HA8: 1061, HA9: 1062,
};

export const EPC_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          fetchText(r.headers.location).then(resolve, reject);
          return;
        }
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => resolve({ status: r.statusCode, body }));
      })
      .on('error', reject);
  });
}

export function extractProperties(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  function find(o) {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) {
      for (const x of o) { const r = find(x); if (r) return r; }
      return null;
    }
    if (Array.isArray(o.properties) && o.properties[0] && o.properties[0].propertyUrl !== undefined) return o.properties;
    for (const k in o) { const r = find(o[k]); if (r) return r; }
    return null;
  }
  return find(data) || [];
}

export function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* leave null */ }
          resolve({ status: r.statusCode, json, body });
        });
      })
      .on('error', reject);
  });
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 5_000_000) { req.destroy(); reject(new Error('Request body too large')); }
    });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

export function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Reverse-geocode a lat/lon to the nearest real postcodes (free, no key).
// Rightmove offsets its map pins, so we return several nearby postcodes and
// let the caller pick the one whose street actually matches the listing.
export function reverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) { resolve([]); return; }
    const url = `https://api.postcodes.io/postcodes?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&limit=10&radius=2000`;
    https
      .get(url, (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => {
          try { resolve(((JSON.parse(b) || {}).result || []).map((x) => x.postcode).filter(Boolean)); }
          catch { resolve([]); }
        });
      })
      .on('error', () => resolve([]));
  });
}

// Full UK postcode matcher, e.g. "HA1 1BA".
export const FULL_POSTCODE = /^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/;
