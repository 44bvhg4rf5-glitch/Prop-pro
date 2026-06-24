import { OUTCODES, fetchText, extractProperties, sendJson } from '../lib/helpers.js';

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const channel = (u.searchParams.get('channel') || 'sale').toLowerCase();
  const minBeds = parseInt(u.searchParams.get('minBeds') || '0', 10) || 0;
  const maxPrice = parseInt(u.searchParams.get('maxPrice') || '0', 10) || 0;
  const index = parseInt(u.searchParams.get('index') || '0', 10) || 0;

  const outcode = OUTCODES[district];
  if (!outcode) { sendJson(res, 400, { error: `Unknown district "${district}". Use HA0–HA9.` }); return; }

  const seg = channel === 'rent' || channel === 'let' ? 'property-to-rent' : 'property-for-sale';
  const q = new URLSearchParams({ locationIdentifier: `OUTCODE^${outcode}`, index: String(index), includeSSTC: 'false' });
  if (minBeds) q.set('minBedrooms', String(minBeds));
  if (maxPrice) q.set('maxPrice', String(maxPrice));
  const rmUrl = `https://www.rightmove.co.uk/${seg}/find.html?${q.toString()}`;

  try {
    const { status, body } = await fetchText(rmUrl);
    if (status !== 200) throw new Error(`Rightmove returned ${status}`);
    const properties = extractProperties(body)
      .filter((p) => p && p.propertyUrl)
      .map((p) => {
        const id = String(p.id || (p.propertyUrl.match(/(\d+)/) || [])[1] || '');
        const price =
          (p.price && (p.price.amount || (p.price.displayPrices && p.price.displayPrices[0] && p.price.displayPrices[0].displayPrice))) || '';
        const disp = p.displayAddress || '';
        const pcMatch = disp.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i); // full postcode if shown
        return {
          propertyId: id,
          address: disp,
          displayAddress: disp,
          postcode: pcMatch ? pcMatch[0].toUpperCase() : '',
          lat: (p.location && p.location.latitude) || null,
          lon: (p.location && p.location.longitude) || null,
          haCode: district,
          price: typeof price === 'number' ? price : 0,
          priceLabel: typeof price === 'string' ? price : price ? '£' + Number(price).toLocaleString() : '',
          beds: p.bedrooms || 0,
          type: p.propertySubType || p.propertyTypeFullDescription || 'Property',
          status: seg === 'property-to-rent' ? 'To Rent' : 'For Sale',
          agent: (p.customer && p.customer.branchDisplayName) || '',
          addedDate: (p.addedOrReduced || p.firstVisibleDate || '').replace('T', ' ').slice(0, 16),
          url: 'https://www.rightmove.co.uk/properties/' + id,
        };
      })
      .filter((p) => p.propertyId);

    res.setHeader('Access-Control-Allow-Origin', '*');
    sendJson(res, 200, { district, channel, total: properties.length, properties });
  } catch (e) {
    sendJson(res, 502, { error: 'Could not fetch Rightmove: ' + e.message });
  }
}
