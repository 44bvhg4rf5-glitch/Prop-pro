import { fetchText } from './helpers.js';

// Fetch a Rightmove listing's own detail page and pull the facts the resolver
// needs to CONFIRM an address: the EXACT full postcode (cards usually omit it),
// the floor area, property type and beds. Rightmove hides the house number, but
// the exact postcode collapses the candidate pool to one postcode — where floor
// area + type can uniquely prove the property far more often.
// Cached per URL; returns null on any failure (caller falls back gracefully).

function jsonAfter(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const s = text.indexOf('{', i);
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = s; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) { try { return JSON.parse(text.slice(s, j + 1)); } catch { return null; } } }
  }
  return null;
}
function makeDeref(arr) {
  return function deref(idx, d, path) {
    if (typeof idx !== 'number' || idx < 0 || idx >= arr.length) return null;
    if (d > 12 || path.has(idx)) return null;
    const node = arr[idx];
    if (node === null || typeof node !== 'object') return node;
    const p = new Set(path); p.add(idx);
    if (Array.isArray(node)) return node.map((x) => deref(x, d + 1, p));
    const out = {};
    for (const k in node) out[k] = deref(node[k], d + 1, p);
    return out;
  };
}
const FULLPC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/;
const _mem = new Map();
const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

// "October 21, 2024" / "21 October 2024" / "2024-10-21" → "2024-10-21".
function toISO(s) {
  if (!s) return '';
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);          // October 21, 2024
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);            // 21 October 2024
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return '';
}
function sqftFromText(s) {
  const m = String(s || '').match(/([\d,]{2,6})\s*(?:sq\.?\s*(ft|feet|metres?|m)\b|m²|ft²)/i);
  if (!m) return 0;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  if (!n) return 0;
  return /m/i.test(m[2] || m[0]) && !/ft|feet/i.test(m[0]) ? Math.round(n * 10.7639) : n;
}
const EMPTY = { postcode: '', sqft: 0, type: '', beds: 0, displayAddress: '', deliveryPointId: null, epcBand: '', epcDate: '', lat: null, lon: null };

export async function listingDetail(url) {
  if (!url) return null;
  if (_mem.has(url)) return _mem.get(url);
  let out = null;
  if (/rightmove\.co\.uk\/properties\/\d/i.test(url)) out = await rightmoveDetail(url);
  else if (/onthemarket\.com\/(details|property)\//i.test(url)) out = await onTheMarketDetail(url);
  else return null;
  if (_mem.size > 1500) _mem.clear();
  _mem.set(url, out);
  return out;
}

async function rightmoveDetail(url) {
  let page;
  try { page = await fetchText(url); } catch { return null; }
  if (!page || page.status !== 200 || !page.body) return null;
  const model = jsonAfter(page.body, 'PAGE_MODEL =') || jsonAfter(page.body, 'window.PAGE_MODEL');
  let pd = null;
  try {
    if (model && typeof model.data === 'string') {
      const arr = JSON.parse(model.data);
      const root = Array.isArray(arr) ? arr[0] : null;
      if (root && typeof root.propertyData === 'number') pd = makeDeref(arr)(root.propertyData, 0, new Set());
    } else if (model && model.propertyData) pd = model.propertyData;
  } catch { /* ignore */ }
  if (!pd || !pd.address) return null;
  const addr = pd.address || {}, loc = pd.location || {};
  const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();
  let sqft = 0;
  if (Array.isArray(pd.sizings)) {
    const sf = pd.sizings.find((s) => s && /sqft|sq\.?\s*ft/i.test(s.unit || s.displayUnit || ''));
    const sm = pd.sizings.find((s) => s && /sqm|sq\.?\s*m/i.test(s.unit || s.displayUnit || ''));
    if (sf && (sf.maximumSize || sf.minimumSize)) sqft = Math.round(sf.maximumSize || sf.minimumSize);
    else if (sm && (sm.maximumSize || sm.minimumSize)) sqft = Math.round((sm.maximumSize || sm.minimumSize) * 10.7639);
  }
  return {
    ...EMPTY,
    postcode: FULLPC.test(postcode) ? postcode : '',
    sqft: sqft || 0,
    type: pd.propertySubType || pd.propertyType || '',
    beds: pd.bedrooms || 0,
    displayAddress: addr.displayAddress || '',
    // Royal Mail delivery-point id — the only per-property unique key in the
    // source. Not the house number and not freely decodable, but if an OS
    // Places/PAF lookup is available it pins the exact address by UDPRN match.
    deliveryPointId: addr.deliveryPointId || null,
    lat: typeof loc.latitude === 'number' ? loc.latitude : null,
    lon: typeof loc.longitude === 'number' ? loc.longitude : null,
  };
}

// OnTheMarket hides the postcode and floor size, but its page exposes the EPC
// RATING + EPC DATE — a direct key into the EPC register (the address on the
// street with that band lodged on that date is the property). We also return the
// precise lat/lon so the resolver can reverse-geocode the postcode.
async function onTheMarketDetail(url) {
  let page;
  try { page = await fetchText(url); } catch { return null; }
  if (!page || page.status !== 200 || !page.body) return null;
  let prop = null;
  try {
    const m = page.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const data = m ? JSON.parse(m[1]) : null;
    prop = data && data.props && data.props.initialReduxState && data.props.initialReduxState.property;
  } catch { /* ignore */ }
  if (!prop) return null;
  const loc = prop.location || {};
  const epc = prop.epc || {};
  const text = [prop.summary, JSON.stringify(prop.features || ''), JSON.stringify(prop.description || '')].join(' ');
  return {
    ...EMPTY,
    postcode: '',                                   // OTM does not publish the property postcode
    sqft: sqftFromText(text),
    type: String(prop.humanisedPropertyType || '').replace(/^"|"$/g, ''),
    beds: parseInt(prop.bedrooms, 10) || 0,
    displayAddress: String(prop.displayAddress || '').replace(/^"|"$/g, ''),
    epcBand: String(epc.rating || '').trim().toUpperCase().slice(0, 2),
    epcDate: toISO(epc.date),
    lat: typeof loc.lat === 'number' ? loc.lat : null,
    lon: typeof loc.lon === 'number' ? loc.lon : null,
  };
}
