// Listing sources — fetch + normalise property listings from each portal into
// one shape, so the search and the EPC resolver treat them identically.
import { OUTCODES, fetchText, extractProperties } from './helpers.js';

// Parse a "1,001 sq. ft." / "93 sq m" string into square feet.
export function parseSqft(displaySize) {
  if (!displaySize) return null;
  const m = String(displaySize).replace(/,/g, '').match(/([\d.]+)\s*sq\.?\s*(ft|m)/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (Number.isNaN(val)) return null;
  return /m/i.test(m[2]) ? Math.round(val * 10.7639) : Math.round(val);
}

const priceNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
const fullPc = (s) => (String(s).match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i) || [])[0] || '';

// ── Rightmove ──
export async function rightmoveListings(district, { channel = 'sale', minBeds = 0, maxPrice = 0, index = 0 } = {}) {
  const outcode = OUTCODES[district];
  if (!outcode) return [];
  const seg = channel === 'rent' || channel === 'let' ? 'property-to-rent' : 'property-for-sale';
  const q = new URLSearchParams({ locationIdentifier: `OUTCODE^${outcode}`, index: String(index), includeSSTC: 'false' });
  if (minBeds) q.set('minBedrooms', String(minBeds));
  if (maxPrice) q.set('maxPrice', String(maxPrice));
  const { status, body } = await fetchText(`https://www.rightmove.co.uk/${seg}/find.html?${q.toString()}`);
  if (status !== 200) return [];
  return extractProperties(body)
    .filter((p) => p && p.propertyUrl)
    .map((p) => {
      const id = String(p.id || (p.propertyUrl.match(/(\d+)/) || [])[1] || '');
      const price = (p.price && (p.price.amount || (p.price.displayPrices && p.price.displayPrices[0] && p.price.displayPrices[0].displayPrice))) || '';
      const disp = p.displayAddress || '';
      return {
        propertyId: id, address: disp, displayAddress: disp,
        postcode: fullPc(disp).toUpperCase(),
        lat: (p.location && p.location.latitude) || null,
        lon: (p.location && p.location.longitude) || null,
        haCode: district,
        price: typeof price === 'number' ? price : priceNum(price),
        priceLabel: typeof price === 'string' ? price : price ? '£' + Number(price).toLocaleString() : '',
        beds: p.bedrooms || 0,
        type: p.propertySubType || p.propertyTypeFullDescription || 'Property',
        status: seg === 'property-to-rent' ? 'To Rent' : 'For Sale',
        agent: (p.customer && p.customer.branchDisplayName) || '',
        addedDate: (p.addedOrReduced || p.firstVisibleDate || '').replace('T', ' ').slice(0, 16),
        sizeSqft: parseSqft(p.displaySize),
        hasFloorplan: (p.numberOfFloorplans || 0) > 0,
        url: 'https://www.rightmove.co.uk/properties/' + id,
        source: 'Rightmove',
      };
    })
    .filter((p) => p.propertyId);
}

// Recursively find the listings array in OnTheMarket's __NEXT_DATA__.
function findOtm(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) {
    if (o.length && o[0] && o[0]['details-url'] !== undefined && o[0].address !== undefined) return o;
    for (const x of o) { const r = findOtm(x); if (r) return r; }
    return null;
  }
  for (const k in o) { const r = findOtm(o[k]); if (r) return r; }
  return null;
}

// ── OnTheMarket ──
export async function onTheMarketListings(district, { channel = 'sale', minBeds = 0, maxPrice = 0 } = {}) {
  const seg = channel === 'rent' || channel === 'let' ? 'to-rent' : 'for-sale';
  const { status, body } = await fetchText(`https://www.onthemarket.com/${seg}/property/${district.toLowerCase()}/`);
  if (status !== 200) return [];
  let data;
  try { data = JSON.parse((body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]); } catch { return []; }
  const arr = findOtm(data) || [];
  return arr
    .filter((p) => p && p['details-url'] && p.address)
    .map((p) => {
      const id = String(p.id || (String(p['details-url']).match(/(\d+)/) || [])[1] || '');
      const disp = p.address || '';
      return {
        propertyId: id, address: disp, displayAddress: disp,
        postcode: fullPc(disp).toUpperCase(),
        lat: (p.location && p.location.lat) || null,
        lon: (p.location && p.location.lon) || null,
        haCode: district,
        price: priceNum(p.price || p['short-price']),
        priceLabel: p.price || p['short-price'] || '',
        beds: p.bedrooms || 0,
        type: p['humanised-property-type'] || 'Property',
        status: seg === 'to-rent' ? 'To Rent' : 'For Sale',
        agent: (p.agent && (p.agent.name || p.agent['branch-name'])) || '',
        addedDate: p['days-since-added-reduced'] || '',
        sizeSqft: null, hasFloorplan: false,
        url: 'https://www.onthemarket.com' + p['details-url'],
        source: 'OnTheMarket',
      };
    })
    .filter((p) => p.propertyId && (!minBeds || p.beds >= minBeds) && (!maxPrice || !p.price || p.price <= maxPrice));
}

// Merge listings from several sources, removing the same property listed on
// more than one portal (keep the copy that has a floor size for better EPC
// matching).
export function mergeListings(lists) {
  const all = [].concat(...lists);
  const byKey = new Map();
  for (const p of all) {
    const street = (p.address || '').split(',')[0].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const geo = (p.lat != null && p.lon != null) ? `${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : p.propertyId;
    const key = street + '|' + geo;
    const ex = byKey.get(key);
    if (!ex || (!ex.sizeSqft && p.sizeSqft)) byKey.set(key, p);
  }
  return [...byKey.values()];
}
