import https from 'https';
import { sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// "Head of free data" audit — probes each candidate FREE address source against a
// real postcode/point and reports whether it returns usable addresses, so we can
// see what to wire in. ?postcode=HA1 3WU&lat=..&lon=..
function getJson(url, headers) {
  return new Promise((resolve) => {
    https.get(url, { headers: headers || {} }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', (e) => resolve({ status: 0, error: e.message }));
  });
}
function postJson(host, path, body, headers) {
  return new Promise((resolve) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname: host, path, method: 'POST', headers: { 'Content-Length': Buffer.byteLength(data), ...headers } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.write(data); req.end();
  });
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || 'HA1 3WU').toUpperCase().trim();
  const lat = parseFloat(u.searchParams.get('lat') || '51.579'), lon = parseFloat(u.searchParams.get('lon') || '-0.338');
  const out = {};

  // 1. OS Places — postcode endpoint (Royal Mail PAF: every delivery address).
  const OS = process.env.OS_PLACES_KEY || '';
  if (OS) {
    const r = await getJson(`https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(postcode)}&dataset=DPA&maxresults=100&key=${encodeURIComponent(OS)}`, { Accept: 'application/json' });
    const rows = (r.json && r.json.results) || [];
    out.os_places_postcode = { status: r.status, count: rows.length, sample: rows.slice(0, 4).map((x) => x.DPA && x.DPA.ADDRESS) };
  } else out.os_places_postcode = { status: 'no key' };

  // 2. OpenStreetMap Overpass — crowdsourced house numbers near the pin.
  const oq = `[out:json][timeout:15];(node["addr:housenumber"](around:90,${lat},${lon});way["addr:housenumber"](around:90,${lat},${lon}););out tags 60;`;
  const ov = await postJson('overpass-api.de', '/api/interpreter', 'data=' + encodeURIComponent(oq), { 'Content-Type': 'application/x-www-form-urlencoded' });
  const els = (ov.json && ov.json.elements) || [];
  out.osm_overpass = { status: ov.status, count: els.length, sample: els.slice(0, 5).map((e) => [e.tags['addr:housenumber'], e.tags['addr:unit'] || e.tags['addr:flats'] || '', e.tags['addr:street']].filter(Boolean).join(' ')) };

  // 3. FHRS food-hygiene — full addresses for commercial premises on the postcode.
  const fh = await getJson(`https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(postcode)}&pageSize=20`, { 'x-api-version': '2', Accept: 'application/json' });
  const est = (fh.json && fh.json.establishments) || [];
  out.fhrs = { status: fh.status, count: est.length, sample: est.slice(0, 3).map((e) => [e.BusinessName, e.AddressLine1, e.PostCode].filter(Boolean).join(', ')) };

  // 4. Companies House — companies registered at this postcode (freeholders / SPVs).
  const CH = process.env.COMPANIES_HOUSE_KEY || process.env.CH_API_KEY || '';
  if (CH) {
    const auth = 'Basic ' + Buffer.from(CH + ':').toString('base64');
    const r = await getJson(`https://api.company-information.service.gov.uk/advanced-search/companies?location=${encodeURIComponent(postcode)}&size=20`, { Authorization: auth, Accept: 'application/json' });
    const items = (r.json && r.json.items) || [];
    out.companies_house = { status: r.status, count: items.length, sample: items.slice(0, 3).map((c) => c.company_name + ' — ' + ((c.registered_office_address || {}).address_line_1 || '')) };
  } else out.companies_house = { status: 'no key' };

  sendJson(res, 200, { postcode, point: [lat, lon], sources: out });
}
