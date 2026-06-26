import { fetchText, sendJson, guardOrigin } from '../lib/helpers.js';

// Fetch ONE Rightmove property page by its URL and return the listing details
// the AI Intel pipeline needs (display address, postcode, lat/lon, type, beds,
// price, floor area). This is the first step of the chain:
//   property URL → THIS → /api/resolve (exact address) → /api/owner (research)
// Everything here is real, scraped from the public listing — nothing invented.

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

// Deep-find the first node that looks like Rightmove's propertyData.
function findPropertyData(o, seen = new Set()) {
  if (!o || typeof o !== 'object' || seen.has(o)) return null;
  seen.add(o);
  if (o.address && o.address.displayAddress !== undefined && o.location) return o;
  for (const k in o) { const r = findPropertyData(o[k], seen); if (r) return r; }
  return null;
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

  const model = jsonAfter(page.body, 'window.PAGE_MODEL') || jsonAfter(page.body, 'PAGE_MODEL =');
  const pd = (model && (model.propertyData || findPropertyData(model))) || null;
  if (!pd) {
    sendJson(res, 200, { found: false, note: 'Could not read this listing automatically. Open it on Rightmove and paste the postcode or full address into the search box instead.' });
    return;
  }

  const addr = pd.address || {};
  const loc = pd.location || {};
  const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();
  const sizing = Array.isArray(pd.sizings) ? pd.sizings.find((s) => s && (s.maximumSize || s.minimumSize)) : null;
  let sizeSqft = null;
  if (sizing) {
    const v = sizing.maximumSize || sizing.minimumSize;
    sizeSqft = /sq\.?\s*m/i.test(sizing.unit || '') ? Math.round(v * 10.7639) : Math.round(v);
  }
  const price = (pd.prices && (pd.prices.primaryPrice || pd.prices.price)) || pd.price || '';

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
    channel: pd.transactionType && /rent|let/i.test(pd.transactionType) ? 'rent' : 'sale',
    url,
    source: 'Rightmove',
  });
}
