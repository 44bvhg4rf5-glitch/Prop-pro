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

// First money figure only. OnTheMarket rentals pack two numbers into one string
// ("£1,950 pcm £450 pw") — stripping all non-digits would concatenate them
// (→1950450), so drop the thousands-commas then take the FIRST number group.
const priceNum = (s) => { const m = String(s).replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; };
const fullPc = (s) => (String(s).match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i) || [])[0] || '';

// ── Single Rightmove property page → richer signals (FULL postcode, exact pin,
// floor area). Search results only expose the outcode; the property page adds
// the incode, which is the key to pinning the exact address. ──
function jsonAfter(text, marker) {
  const i = text.indexOf(marker); if (i < 0) return null;
  const s = text.indexOf('{', i); if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = s; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true; else if (ch === '{') depth++;
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
    const out = {}; for (const k in node) out[k] = deref(node[k], d + 1, p); return out;
  };
}
export async function rightmoveProperty(url) {
  if (!/^https?:\/\/(www\.)?rightmove\.co\.uk\//i.test(url || '')) return null;
  let page; try { page = await fetchText(url); } catch { return null; }
  if (page.status !== 200) return null;
  const model = jsonAfter(page.body, 'PAGE_MODEL =') || jsonAfter(page.body, 'window.PAGE_MODEL');
  let pd = null;
  try {
    if (model && typeof model.data === 'string') {
      const arr = JSON.parse(model.data); const root = Array.isArray(arr) ? arr[0] : null;
      if (root && typeof root.propertyData === 'number') pd = makeDeref(arr)(root.propertyData, 0, new Set());
    } else if (model && model.propertyData) pd = model.propertyData;
  } catch { /* ignore */ }
  if (!pd || !pd.address) return null;
  const addr = pd.address || {}, loc = pd.location || {};
  const postcode = [addr.outcode, addr.incode].filter(Boolean).join(' ').toUpperCase();
  let sizeSqft = null;
  if (Array.isArray(pd.sizings)) {
    const sf = pd.sizings.find((s) => s && /sqft|sq\.?\s*ft/i.test(s.unit || s.displayUnit || ''));
    const sm = pd.sizings.find((s) => s && /sqm|sq\.?\s*m/i.test(s.unit || s.displayUnit || ''));
    if (sf && (sf.maximumSize || sf.minimumSize)) sizeSqft = Math.round(sf.maximumSize || sf.minimumSize);
    else if (sm && (sm.maximumSize || sm.minimumSize)) sizeSqft = Math.round((sm.maximumSize || sm.minimumSize) * 10.7639);
  }
  // Listing prose + bullet points — the human-written clues (corner plot, private
  // drive, "number 12", end of terrace…) the register/pin engine can't see, so an
  // AI cross-checker has an independent basis to pick the house.
  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  const text = pd.text || {};
  const description = stripHtml(text.description || text.propertyPhrase || '').slice(0, 1800);
  const keyFeatures = Array.isArray(pd.keyFeatures) ? pd.keyFeatures.map(stripHtml).filter(Boolean).slice(0, 12) : [];
  // Listing photos (front elevation usually comes first) — for the photo-based
  // address finder. Rightmove keeps them on pd.images[].{url|srcUrl}.
  const imgArr = Array.isArray(pd.images) ? pd.images : (pd.propertyImages && Array.isArray(pd.propertyImages.images) ? pd.propertyImages.images : []);
  const images = imgArr.map((im) => (im && (im.url || im.srcUrl || im.masterUrl)) || '').filter((u) => /^https?:\/\//.test(u)).slice(0, 12);
  return {
    displayAddress: addr.displayAddress || '', postcode, outcode: addr.outcode || '', incode: addr.incode || '',
    lat: loc.latitude != null ? loc.latitude : null, lon: loc.longitude != null ? loc.longitude : null,
    type: pd.propertySubType || pd.propertyType || '', beds: pd.bedrooms || 0, sizeSqft,
    description, keyFeatures, images,
  };
}

// ── Rightmove ──
// UK-wide location autocomplete (Rightmove's location-options service). Returns
// the search identifiers (OUTCODE^…, REGION^…, POSTCODE^…) for any postcode,
// town or area — the key to searching beyond the hard-coded HA districts.
const decodeXml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
export async function rightmoveTypeahead(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const { status, body } = await fetchText('https://los.rightmove.co.uk/typeahead?query=' + encodeURIComponent(q) + '&limit=10');
  if (status !== 200) return [];
  const want = new Set(['POSTCODE', 'OUTCODE', 'REGION', 'STATION']);
  let raw = [];
  try {
    raw = (JSON.parse(body).matches || []).map((m) => ({ id: m.id, type: m.type, label: m.displayName || '' }));
  } catch {
    // The service returns XML when asked with an HTML Accept header — parse each <matches> block.
    for (const block of String(body).split('<matches>').slice(1)) {
      const id = (block.match(/<id>([^<]+)<\/id>/) || [])[1];
      const type = (block.match(/<type>([^<]+)<\/type>/) || [])[1];
      const label = (block.match(/<displayName>([^<]*)<\/displayName>/) || [])[1];
      if (id && type) raw.push({ id, type, label: decodeXml(label || '') });
    }
  }
  return raw.filter((m) => want.has(m.type)).map((m) => ({ identifier: m.type + '^' + m.id, type: m.type, label: m.label }));
}

function mapRm(p, areaLabel, seg) {
  const id = String(p.id || (p.propertyUrl.match(/(\d+)/) || [])[1] || '');
  const price = (p.price && (p.price.amount || (p.price.displayPrices && p.price.displayPrices[0] && p.price.displayPrices[0].displayPrice))) || '';
  const disp = p.displayAddress || '';
  return {
    propertyId: id, address: disp, displayAddress: disp,
    postcode: fullPc(disp).toUpperCase(),
    lat: (p.location && p.location.latitude) || null,
    lon: (p.location && p.location.longitude) || null,
    haCode: areaLabel,
    price: typeof price === 'number' ? price : priceNum(price),
    priceLabel: typeof price === 'string' ? price : price ? '£' + Number(price).toLocaleString() : '',
    beds: p.bedrooms || 0,
    type: p.propertySubType || p.propertyTypeFullDescription || 'Property',
    status: seg === 'property-to-rent' ? 'To Rent' : 'For Sale',
    // Real marketing status for lifecycle touting: "" = Available, else "Sold STC"
    // / "Under Offer" / "Reserved". The `reduced` flag comes straight off the
    // "Reduced today / Reduced on …" label Rightmove publishes for free.
    liveStatus: (p.displayStatus || '').trim() || (seg === 'property-to-rent' ? 'To Let' : 'Available'),
    reduced: /reduc/i.test(p.addedOrReduced || ''),
    agent: (p.customer && p.customer.branchDisplayName) || '',
    addedDate: (p.addedOrReduced || p.firstVisibleDate || '').replace('T', ' ').slice(0, 40),
    firstListed: (p.firstVisibleDate || '').slice(0, 10),   // clean ISO date for the resolver's marketing-date signal
    sizeSqft: parseSqft(p.displaySize),
    hasFloorplan: (p.numberOfFloorplans || 0) > 0,
    url: 'https://www.rightmove.co.uk/properties/' + id,
    source: 'Rightmove',
  };
}

// Core search by any Rightmove locationIdentifier.
async function rmSearch(locationIdentifier, { channel = 'sale', minBeds = 0, maxPrice = 0, index = 0, pages = 1, includeSSTC = false, sortType = 6 } = {}, areaLabel = '') {
  if (!locationIdentifier) return [];
  const seg = channel === 'rent' || channel === 'let' ? 'property-to-rent' : 'property-for-sale';
  // Rightmove pages 24 results at a time and caps browsing at index 1008 (≈42 pages).
  const indexes = pages > 1 ? Array.from({ length: Math.min(pages, 42) }, (_, i) => i * 24) : [index];
  const pageResults = await Promise.all(indexes.map((idx) => {
    const q = new URLSearchParams({ locationIdentifier, index: String(idx), includeSSTC: includeSSTC ? 'true' : 'false', sortType: String(sortType) });
    if (seg === 'property-to-rent') q.set('includeLetAgreed', includeSSTC ? 'true' : 'false');  // capture "Let agreed" — the rental equivalent of Sold STC
    if (minBeds) q.set('minBedrooms', String(minBeds));
    if (maxPrice) q.set('maxPrice', String(maxPrice));
    return fetchText('https://www.rightmove.co.uk/' + seg + '/find.html?' + q.toString())
      .then(({ status, body }) => (status === 200 ? extractProperties(body) : []))
      .catch(() => []);
  }));
  // De-duplicate by property id across pages (deeper pagination can overlap).
  const seen = new Set();
  return pageResults.flat().filter((p) => p && p.propertyUrl).map((p) => mapRm(p, areaLabel, seg))
    .filter((p) => { if (!p.propertyId || seen.has(p.propertyId)) return false; seen.add(p.propertyId); return true; });
}

// HA-district search (back-compat) — resolves the district to its outcode.
export async function rightmoveListings(district, opts = {}) {
  const outcode = OUTCODES[district];
  if (!outcode) return [];
  return rmSearch('OUTCODE^' + outcode, opts, district);
}
// Any-location search for the UK-wide finder.
export async function rightmoveListingsByLocation(locationIdentifier, opts = {}, label = '') {
  return rmSearch(locationIdentifier, opts, label);
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
async function otmPage(slug, seg, page) {
  const url = `https://www.onthemarket.com/${seg}/property/${slug}/` + (page > 1 ? `?page=${page}` : '');
  const { status, body } = await fetchText(url);
  if (status !== 200) return [];
  let data; try { data = JSON.parse((body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]); } catch { return []; }
  return findOtm(data) || [];
}
export async function onTheMarketListings(district, { channel = 'sale', minBeds = 0, maxPrice = 0, pages = 1 } = {}) {
  const seg = channel === 'rent' || channel === 'let' ? 'to-rent' : 'for-sale';
  const slug = String(district).toLowerCase();
  const pageNums = Array.from({ length: Math.min(Math.max(pages, 1), 20) }, (_, i) => i + 1);
  const pageResults = await Promise.all(pageNums.map((p) => otmPage(slug, seg, p).catch(() => [])));
  const seen = new Set();
  return pageResults.flat()
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
        liveStatus: seg === 'to-rent' ? 'To Let' : 'Available',   // OTM doesn't expose SSTC in search; default Available
        reduced: /reduc/i.test(p['days-since-added-reduced'] || ''),
        agent: (p.agent && (p.agent.name || p.agent['branch-name'])) || '',
        addedDate: p['days-since-added-reduced'] || '',
        sizeSqft: null, hasFloorplan: false,
        url: 'https://www.onthemarket.com' + p['details-url'],
        source: 'OnTheMarket',
      };
    })
    .filter((p) => {
      if (!p.propertyId || seen.has(p.propertyId)) return false;
      if ((minBeds && p.beds < minBeds) || (maxPrice && p.price && p.price > maxPrice)) return false;
      seen.add(p.propertyId); return true;
    });
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
