import https from 'https';

// OS Places API (Royal Mail PAF-backed) — the authoritative address list per
// postcode, each row carrying UPRN and UDPRN. We use it to PIN the exact address
// by matching a Rightmove listing's delivery-point id against UDPRN/UPRN. Dormant
// until OS_PLACES_KEY is set, so it is safe to ship before the key is live.

const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

export function osConfigured() { return !!(process.env.OS_PLACES_KEY); }

function getJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, json: j }); });
    }).on('error', () => resolve({ status: 0, json: null }));
  });
}

const _mem = new Map();
// Every delivery-point address on a postcode (DPA dataset), cached per request.
export async function osByPostcode(pc) {
  const KEY = process.env.OS_PLACES_KEY || '';
  if (!KEY || !pc) return [];
  const mk = pc.toUpperCase().replace(/\s+/g, '');
  if (_mem.has(mk)) return _mem.get(mk);
  let out = [];
  try {
    const url = `https://api.os.uk/search/places/v1/postcode?postcode=${encodeURIComponent(pc)}&dataset=DPA&maxresults=100&key=${encodeURIComponent(KEY)}`;
    const r = await getJson(url);
    const rows = (r.json && r.json.results) || [];
    out = rows.map((x) => x.DPA).filter(Boolean).map((d) => ({
      address: tc(d.ADDRESS || ''),
      uprn: String(d.UPRN || ''),
      udprn: String(d.UDPRN || ''),
      buildingNo: String(d.BUILDING_NUMBER || '').toLowerCase(),
      postcode: d.POSTCODE || pc,
    }));
  } catch { out = []; }
  if (_mem.size > 1500) _mem.clear();
  _mem.set(mk, out);
  return out;
}

// Pin the exact address by matching the listing's delivery-point id to UDPRN
// (then UPRN as a fallback). Returns the address row or null.
export async function osMatchDeliveryPoint(pc, deliveryPointId) {
  if (!deliveryPointId) return null;
  const id = String(deliveryPointId);
  const rows = await osByPostcode(pc);
  return rows.find((r) => r.udprn && r.udprn === id) || rows.find((r) => r.uprn && r.uprn === id) || null;
}
