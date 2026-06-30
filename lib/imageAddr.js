import https from 'https';
import { runVision, extractJson } from './llm.js';
import { rightmoveProperty } from './sources.js';
import { freeAddressesForPostcode } from './freeAddresses.js';

// ── Photo-based address finder ──────────────────────────────────────────────
// A listing gives us the postcode (from the page) but not the house number.
// The PHOTOS often do: a number on the door, gatepost, wall or bin. We read the
// photos with the free vision model, then match what we read against the
// Council Tax dwelling list for that postcode to pin (or shortlist) the exact
// address. All free: listing page + Gemini free-tier vision + Council Tax.

const houseNum = (s) => ((String(s || '').match(/\b(\d+[a-z]?)\b/i) || [])[1] || '').toLowerCase();
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Fetch an image URL → { data: base64, mediaType }. Capped + timed so a single
// huge image can't stall the request.
function fetchImage(url, { maxBytes = 3_500_000, timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { resolve(null); return; }
    const req = https.get(u, { headers: { 'User-Agent': 'PropMailPro/1.0' } }, (r) => {
      if (!r.statusCode || r.statusCode >= 400) { r.resume(); resolve(null); return; }
      const mediaType = (r.headers['content-type'] || 'image/jpeg').split(';')[0];
      if (!/^image\//.test(mediaType)) { r.resume(); resolve(null); return; }
      const chunks = []; let len = 0;
      r.on('data', (c) => { len += c.length; if (len > maxBytes) { req.destroy(); resolve(null); return; } chunks.push(c); });
      r.on('end', () => resolve({ data: Buffer.concat(chunks).toString('base64'), mediaType }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

const VISION_PROMPT = `You are verifying a UK residential property's address from estate-agent photos.
1) Read any HOUSE NUMBER, FLAT NUMBER or BUILDING NAME visible ANYWHERE in the photos — on the front door, fanlight, gatepost, wall, porch, or wheelie bin. A number on or beside the front door is the priority. NEVER guess — only report a number you can actually see.
2) Describe the building: type (detached / semi-detached / terraced / end-of-terrace / flat / maisonette / bungalow), number of storeys, wall finish & colour (red brick / render / pebbledash / painted), front-door colour, bay window (true/false), porch (true/false), and any distinctive feature.
Reply with ONLY compact JSON, no prose:
{"number":"","buildingName":"","type":"","storeys":0,"walls":"","doorColour":"","bay":false,"porch":false,"features":[],"readNumberFrom":"","confidence":"high|medium|low"}
Use "" / false / [] when unsure.`;

export async function photoAddress({ url = '', images = [], postcode = '', epcKey = '' } = {}) {
  let pc = (postcode || '').trim().toUpperCase();
  let photoUrls = Array.isArray(images) ? images.filter(Boolean) : [];
  let listingType = '', displayAddress = '';
  if (url) {
    const d = await rightmoveProperty(url).catch(() => null);
    if (d) { pc = pc || d.postcode; if (!photoUrls.length) photoUrls = d.images || []; listingType = d.type || ''; displayAddress = d.displayAddress || ''; }
  }
  if (!pc) return { error: 'no_postcode', note: 'No postcode — paste a Rightmove listing URL, or enter the postcode with the photos.' };
  if (!photoUrls.length) return { error: 'no_photos', note: 'No photos found for this listing.' };

  // Front elevation is usually among the first photos; cap to keep it fast/free.
  const imgs = (await Promise.all(photoUrls.slice(0, 4).map((u) => fetchImage(u)))).filter(Boolean);
  if (!imgs.length) return { error: 'photo_fetch_failed', note: 'Could not download the listing photos.' };

  const v = await runVision({ system: 'You are a meticulous property surveyor. Report only what is clearly visible; never invent a number.', prompt: VISION_PROMPT, images: imgs, maxTokens: 600 });
  if (v.error) return { error: 'vision_' + v.error, note: 'The image reader is unavailable (no free vision key, or quota reached).' };
  const vision = extractJson(v.text) || {};

  const candidates = await freeAddressesForPostcode(pc, { epcKey }).catch(() => []);
  const num = houseNum(vision.number);
  const bname = norm(vision.buildingName);

  let matched = [], how = '', confidence = 'low';
  if (num) {
    matched = candidates.filter((a) => houseNum(a.line1) === num);
    if (bname) { const bm = matched.filter((a) => norm(a.fullAddress).includes(bname)); if (bm.length) matched = bm; }
    how = `house number "${vision.number}" read from the photo` + (vision.readNumberFrom ? ` (${vision.readNumberFrom})` : '');
    confidence = matched.length === 1 ? 'high' : matched.length > 1 ? 'medium' : 'low';
  } else if (bname) {
    matched = candidates.filter((a) => norm(a.fullAddress).includes(bname));
    how = `building name "${vision.buildingName}" read from the photo`;
    confidence = matched.length === 1 ? 'high' : 'medium';
  }
  if (!matched.length) {
    // No number readable → narrow by property type so the user has a shortlist.
    const t = (vision.type || listingType || '').toLowerCase();
    const kind = /flat|apartment|maisonette/.test(t) ? 'flat' : /bungalow|detached|semi|terrace|house/.test(t) ? 'house' : '';
    matched = kind ? candidates.filter((a) => a.kind === kind) : candidates.slice();
    how = num ? 'number read but not on the Council Tax list — showing the closest matches' : 'no number visible in the photos — narrowed by property type, verify before posting';
    confidence = 'low';
  }

  return {
    postcode: pc, displayAddress, listingType, provider: v.provider, photosUsed: imgs.length,
    vision, candidates: candidates.length, how, confidence,
    matches: matched.slice(0, 15).map((a) => ({ line1: a.line1, fullAddress: a.fullAddress, postcode: a.postcode, kind: a.kind })),
  };
}
