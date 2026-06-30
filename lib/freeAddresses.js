import https from 'https';
import { EPC_BASE, fetchJson } from './helpers.js';
import { councilTaxAddresses } from './counciltax.js';

// ── Free, no-key address enumeration ────────────────────────────────────────
// Maximises address coverage for the Success-Letters finder WITHOUT the paid
// Royal Mail / OS Places key, by unioning the open sources:
//   • VOA Council Tax  — every residential dwelling per postcode (incl. flats)
//   • EPC register     — every property with an energy certificate (+ UPRN/type)
//   • postcodes.io     — the open postcode↔geo backbone, used to expand an
//                        outcode/sector/street into the set of postcodes to scan
// Deduped by (house-number + street), this gets us close to PAF completeness
// for £0. Council Tax is the backbone; EPC enriches matches with a UPRN.

const tcAddr = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
const normKey = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normPc = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const tidyPc = (s) => { const m = String(s || '').toUpperCase().match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/); if (!m) return ''; const p = m[0].replace(/\s+/g, ''); return p.slice(0, -3) + ' ' + p.slice(-3); };

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'PropMailPro/1.0' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}

// A council-tax row → our address shape. The address ends "…, TOWN, POSTCODE".
function mapCt(r) {
  const full = tcAddr(r.address);
  const pc = tidyPc(r.address) || '';
  const flatish = !!r.flat || /\b(flat|apartment|maisonette)\b/i.test(r.address);
  // Dedupe key: flat + building-number + street (so "Flat 1 at 34 Pinner Road"
  // and "34 Pinner Road" are kept as distinct dwellings).
  const key = normKey([r.flat, r.buildingNo, r.street].filter(Boolean).join(' '));
  return { line1: tcAddr(r.address.split(',')[0]), fullAddress: full, postcode: pc, uprn: '', type: 'Residential', kind: flatish ? 'flat' : 'house', band: r.band || '', source: 'Council Tax', _key: key, _street: normKey(r.street) };
}

// EPC certificates for a postcode → our address shape (adds a UPRN).
async function epcByPostcode(pc, key) {
  if (!key) return [];
  try {
    const url = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(pc).replace(/%20/g, '+')}&page_size=500`;
    const { status, json } = await fetchJson(url, key);
    const data = (status === 200 && json && Array.isArray(json.data)) ? json.data : [];
    const seen = new Map();
    for (const r of data) {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const p = (r.postcode || '').replace(/\+/g, ' ');
      const full = [...lines, r.postTown, p].filter(Boolean).join(', ');
      if (!full) continue;
      const line1 = r.addressLine1 || lines[0] || '';
      const k = normKey(line1);
      if (!seen.has(k)) seen.set(k, { line1: tcAddr(line1), fullAddress: tcAddr(full), postcode: tidyPc(p) || p, uprn: r.uprn ? String(r.uprn) : '', type: 'Residential', kind: /\b(flat|apartment|maisonette)\b/i.test(full) ? 'flat' : 'house', band: '', source: 'EPC register', _key: k, _street: '' });
    }
    return [...seen.values()];
  } catch { return []; }
}

// Union the free sources for ONE postcode. Council Tax is the backbone; an EPC
// row is added only if Council Tax didn't already list that dwelling, and a
// matching Council-Tax row inherits the EPC's UPRN.
export async function freeAddressesForPostcode(pc, { epcKey = '' } = {}) {
  const [ct, epc] = await Promise.all([
    councilTaxAddresses(pc).then((r) => (r.rows || []).map(mapCt)).catch(() => []),
    epcByPostcode(pc, epcKey),
  ]);
  const byKey = new Map();
  for (const a of ct) byKey.set(a._key, a);
  for (const e of epc) {
    const hit = [...byKey.values()].find((a) => a._key === e._key || (e.line1 && a.line1 && normKey(a.line1) === normKey(e.line1)));
    if (hit) { if (!hit.uprn && e.uprn) hit.uprn = e.uprn; }
    else byKey.set('epc:' + e._key, e);
  }
  return [...byKey.values()];
}

// ── postcodes.io: expand an outcode / sector into its live postcodes ─────────
// Scans nearest-postcode lookups around the outcode centroid. Free + open.
const _pcCache = new Map();
export async function postcodesInArea(token) {
  const t = normPc(token);
  if (!t) return [];
  if (_pcCache.has(t)) return _pcCache.get(t);
  const outcode = t.match(/^[A-Z]{1,2}\d[A-Z\d]?/)?.[0] || t;
  const oc = await getJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
  const c = oc.json && oc.json.result;
  if (!c || c.latitude == null) { _pcCache.set(t, []); return []; }
  const set = new Map();
  // Sweep several radii so we pick up the whole outcode, not just the centre.
  for (const radius of [800, 1600, 2000]) {
    const r = await getJson(`https://api.postcodes.io/postcodes?lon=${c.longitude}&lat=${c.latitude}&limit=100&radius=${radius}`);
    for (const p of (r.json && r.json.result) || []) {
      const code = normPc(p.postcode);
      if (code.startsWith(outcode) && (t === outcode || code.startsWith(t))) set.set(code, tidyPc(p.postcode));
    }
  }
  const out = [...set.values()];
  _pcCache.set(t, out);
  return out;
}

// ── Whole-area enumeration: Council Tax (∪ EPC) across an area's postcodes ────
// Budgeted: caps how many postcodes we hit per request to stay gentle on the
// free VOA service. Cached postcodes are free, so coverage grows across calls.
export async function freeAddressesForArea(token, { epcKey = '', maxPostcodes = 30, conc = 4 } = {}) {
  const pcs = await postcodesInArea(token);
  if (!pcs.length) return { addresses: [], postcodesScanned: 0, postcodesAvailable: 0 };
  const slice = pcs.slice(0, maxPostcodes);
  const all = [];
  for (let i = 0; i < slice.length; i += conc) {
    const batch = await Promise.all(slice.slice(i, i + conc).map((pc) => freeAddressesForPostcode(pc, { epcKey }).catch(() => [])));
    batch.forEach((rows) => all.push(...rows));
  }
  return dedupe(all, { addresses: true, postcodesScanned: slice.length, postcodesAvailable: pcs.length });
}

// Geocode a street to a point via OSM Nominatim (free; gives the seed location
// so we only Council-Tax the postcodes around the actual street).
async function geocodeStreet(name, areaHint) {
  const q = [name, areaHint, 'UK'].filter(Boolean).join(', ');
  const r = await getJson('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=json&limit=1&countrycodes=gb');
  const a = r.json && r.json[0];
  return a ? { lat: +a.lat, lon: +a.lon } : null;
}
// Live postcodes within `radius` m of a point (postcodes.io reverse geocode).
async function postcodesNearPoint(lat, lon, { radius = 1200, limit = 100, prefix = '' } = {}) {
  const r = await getJson(`https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}&limit=${limit}&radius=${radius}`);
  const out = new Set();
  for (const p of (r.json && r.json.result) || []) { const code = normPc(p.postcode); if (!prefix || code.startsWith(prefix)) out.add(tidyPc(p.postcode)); }
  return [...out];
}

// ── Street enumeration: seed a point (postcode in the query, else geocode the
// street), pull the postcodes around it, Council-Tax them and keep the rows on
// that street. Every house on the street, across its postcodes, with no OS key.
export async function freeAddressesForStreet(streetName, areaToken, { epcKey = '', maxPostcodes = 30, conc = 4 } = {}) {
  const want = normKey(streetName);
  if (!want) return { addresses: [], postcodesScanned: 0 };
  const prefix = (normPc(areaToken || '').match(/^[A-Z]{1,2}\d[A-Z\d]?\d?/) || [''])[0];
  // Seed location: a postcode in the area hint pins it exactly; else geocode.
  let pt = null;
  const pcTok = tidyPc(areaToken || '');
  if (pcTok) { const s = await getJson('https://api.postcodes.io/postcodes/' + encodeURIComponent(normPc(pcTok))); if (s.json && s.json.result) pt = { lat: s.json.result.latitude, lon: s.json.result.longitude }; }
  if (!pt) pt = await geocodeStreet(streetName, areaToken);
  if (!pt) return { addresses: [], postcodesScanned: 0, needArea: true };
  let pcs = await postcodesNearPoint(pt.lat, pt.lon, { radius: 1400, prefix });
  if (!pcs.length) pcs = await postcodesNearPoint(pt.lat, pt.lon, { radius: 1400 }); // prefix too strict → drop it
  const slice = pcs.slice(0, maxPostcodes);
  const all = [];
  for (let i = 0; i < slice.length; i += conc) {
    const batch = await Promise.all(slice.slice(i, i + conc).map((pc) => freeAddressesForPostcode(pc, { epcKey }).catch(() => [])));
    batch.forEach((rows) => all.push(...rows.filter((a) => a._street === want || (a._street && a._street.includes(want)) || normKey(a.fullAddress).includes(want))));
  }
  const out = dedupe(all, { addresses: true });
  out.postcodes = [...new Set(out.addresses.map((a) => a.postcode).filter(Boolean))];
  out.postcodesScanned = slice.length;
  return out;
}

function dedupe(list, extra) {
  const seen = new Map();
  for (const a of list) { if (!a || !a.fullAddress) continue; const k = a.fullAddress.toLowerCase(); if (!seen.has(k)) seen.set(k, a); }
  const addresses = [...seen.values()].sort((a, b) => a.fullAddress.localeCompare(b.fullAddress, undefined, { numeric: true }));
  return { ...extra, addresses };
}
