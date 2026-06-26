import { fetchText, sendJson, guardOrigin } from '../lib/helpers.js';

// Fetch ONE Rightmove property page by its URL and return the listing details
// the AI Intel pipeline needs (display address, postcode, lat/lon, type, beds,
// price, floor area). This is the first step of the chain:
//   property URL → THIS → /api/resolve (exact address) → /api/owner (research)
// Everything here is real, scraped from the public listing — nothing invented.
//
// Rightmove embeds the listing as `window.PAGE_MODEL = { data: "<json>", … }`
// where `data` is a FLATTENED index pool (flatted-style): every value is an
// integer index into a shared array, resolved recursively. We parse that pool
// and dereference the propertyData subtree.

// Balanced-brace JSON parse of the object literal that follows `marker`.
function jsonAfter(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const s = text.indexOf('{', i);
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = s; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) { try { return JSON.parse(text.slice(s, j + 1)); } catch { return null; } } }
  }
  return null;
}

// Resolve a flatted index reference into its real value (depth-capped, and
// cycle-safe along the current path so shared nodes still resolve).
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

const priceNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const url = (u.searchParams.get('url') || '').trim();
  if (!/^https?:\/\/(www\.)?rightmove\.co\.uk\//i.test(url)) {
    sendJson(res, 400, { error: 'Provide a Rightmove property URL (https://www.rightmove.co.uk/properties/…).' });
    return;
  }

  let page;
  try { page = await fetchText(url); } catch (e) { sendJson(res, 502, { error: 'Could not fetch the listing: ' + e.message }); return; }
  if (page.status !== 200) { sendJson(res, 502, { error: 'The listing returned HTTP ' + page.status + '.' }); return; }

  const model = jsonAfter(page.body, 'PAGE_MODEL =') || jsonAfter(page.body, 'window.PAGE_MODEL');
  let pd = null;
  try {
    if (model && typeof model.data === 'string') {
      const arr = JSON.parse(model.data);
      const root = Array.isArray(arr) ? arr[0] : null;
      if (root && typeof root.propertyData === 'number') pd = makeDeref(arr)(root.propertyData, 0, new Set());
    } else if (model && model.propertyData) {
      pd = model.propertyData; // legacy (non-flattened) shape
    }
  } catch { /* fall through to found:false */ }

  if (!pd || !pd.address) {
    sendJson(res, 200, { found: false, note: 'Could not read this listing automatically. Open it on Rightmove and paste the postcode or full address into the search box instead.' });
    return;
  }

  const addr = pd.address || {};
  const loc = pd.location || {};
  const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();

  // Prefer the listing's own square-feet sizing; convert from sq m if that's all there is.
  let sizeSqft = null;
  if (Array.isArray(pd.sizings)) {
    const sf = pd.sizings.find((s) => s && /sqft|sq\.?\s*ft/i.test((s.unit || s.displayUnit || '')));
    const sm = pd.sizings.find((s) => s && /sqm|sq\.?\s*m/i.test((s.unit || s.displayUnit || '')));
    if (sf && (sf.maximumSize || sf.minimumSize)) sizeSqft = Math.round(sf.maximumSize || sf.minimumSize);
    else if (sm && (sm.maximumSize || sm.minimumSize)) sizeSqft = Math.round((sm.maximumSize || sm.minimumSize) * 10.7639);
  }

  const price = (pd.prices && pd.prices.primaryPrice) || pd.price || '';
  const channel = /rent|let/i.test(pd.transactionType || '') ? 'rent' : 'sale';

  sendJson(res, 200, {
    found: true,
    propertyId: String(pd.id || (url.match(/(\d{5,})/) || [])[1] || ''),
    displayAddress: addr.displayAddress || '',
    postcode,
    lat: loc.latitude != null ? loc.latitude : null,
    lon: loc.longitude != null ? loc.longitude : null,
    type: pd.propertySubType || pd.propertyType || 'Property',
    beds: pd.bedrooms || 0,
    price: typeof price === 'number' ? price : priceNum(price),
    priceLabel: typeof price === 'string' ? price : price ? '£' + Number(price).toLocaleString() : '',
    sizeSqft,
    channel,
    url,
    source: 'Rightmove',
  });
}
