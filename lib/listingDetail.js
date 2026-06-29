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

export async function listingDetail(url) {
  if (!url || !/rightmove\.co\.uk\/properties\/\d/i.test(url)) return null;
  if (_mem.has(url)) return _mem.get(url);
  let page;
  try { page = await fetchText(url); } catch { _mem.set(url, null); return null; }
  if (!page || page.status !== 200 || !page.body) { _mem.set(url, null); return null; }
  const model = jsonAfter(page.body, 'PAGE_MODEL =') || jsonAfter(page.body, 'window.PAGE_MODEL');
  let pd = null;
  try {
    if (model && typeof model.data === 'string') {
      const arr = JSON.parse(model.data);
      const root = Array.isArray(arr) ? arr[0] : null;
      if (root && typeof root.propertyData === 'number') pd = makeDeref(arr)(root.propertyData, 0, new Set());
    } else if (model && model.propertyData) pd = model.propertyData;
  } catch { /* ignore */ }
  if (!pd || !pd.address) { _mem.set(url, null); return null; }
  const addr = pd.address || {}, loc = pd.location || {};
  const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();
  let sqft = null;
  if (Array.isArray(pd.sizings)) {
    const sf = pd.sizings.find((s) => s && /sqft|sq\.?\s*ft/i.test(s.unit || s.displayUnit || ''));
    const sm = pd.sizings.find((s) => s && /sqm|sq\.?\s*m/i.test(s.unit || s.displayUnit || ''));
    if (sf && (sf.maximumSize || sf.minimumSize)) sqft = Math.round(sf.maximumSize || sf.minimumSize);
    else if (sm && (sm.maximumSize || sm.minimumSize)) sqft = Math.round((sm.maximumSize || sm.minimumSize) * 10.7639);
  }
  const out = {
    postcode: FULLPC.test(postcode) ? postcode : '',
    sqft: sqft || 0,
    type: pd.propertySubType || pd.propertyType || '',
    beds: pd.bedrooms || 0,
    displayAddress: addr.displayAddress || '',
  };
  if (_mem.size > 1500) _mem.clear();
  _mem.set(url, out);
  return out;
}
