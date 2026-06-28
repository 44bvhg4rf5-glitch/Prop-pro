import https from 'https';
import { sendJson, guardOrigin, readBody } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// Best-effort house-number reader from free crowdsourced street imagery
// (Mapillary) + Groq's free vision model. ON-DEMAND only. Safe by design: a
// number read from a photo is only accepted if it matches a REAL address on the
// listing's postcode — the model can never invent a house number we then trust.
//   MAPILLARY_TOKEN — free token from mapillary.com (Developers → register app)
//   GROQ_API_KEY     — already configured (free)

function getJson(url, headers) {
  return new Promise((resolve) => {
    https.get(url, { headers: headers || {} }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(b) }); } catch { resolve({ status: r.statusCode, json: null }); } });
    }).on('error', () => resolve({ status: 502, json: null }));
  });
}

// Nearest crowdsourced street photo to the listing's map pin.
async function mapillaryNearest(lat, lon, token) {
  const d = 0.0009; // ~90m box
  const bbox = [lon - d, lat - d, lon + d, lat + d].join(',');
  const url = `https://graph.mapillary.com/images?fields=id,thumb_1024_url,computed_geometry&bbox=${bbox}&limit=10&access_token=${encodeURIComponent(token)}`;
  const { json } = await getJson(url);
  const imgs = (json && json.data) || [];
  let best = null, bd = Infinity;
  for (const im of imgs) {
    const g = im.computed_geometry && im.computed_geometry.coordinates;
    if (!g || !im.thumb_1024_url) continue;
    const dd = (g[0] - lon) ** 2 + (g[1] - lat) ** 2;
    if (dd < bd) { bd = dd; best = im; }
  }
  return best;
}

function groqVision(imgUrl, prompt, key) {
  const model = process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';
  const body = JSON.stringify({ model, max_tokens: 50, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imgUrl } }] }] });
  return new Promise((resolve) => {
    const req = https.request('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { try { const j = JSON.parse(b); resolve((((j.choices || [])[0] || {}).message || {}).content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.write(body); req.end();
  });
}

const leadNum = (s) => ((String(s || '').trim().match(/(\d+[a-z]?)/i) || [])[1] || '').toLowerCase();

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  const token = process.env.MAPILLARY_TOKEN || '';
  const groq = process.env.GROQ_API_KEY || '';
  if (!token) { sendJson(res, 503, { error: 'no_mapillary', note: 'Add a free MAPILLARY_TOKEN in project settings to enable street-imagery reading.' }); return; }
  if (!groq) { sendJson(res, 503, { error: 'no_vision', note: 'A Groq key is needed to read the image.' }); return; }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let p = {}; try { p = JSON.parse(raw); } catch { /* ignore */ }
  const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
  const candidates = Array.isArray(p.candidates) ? p.candidates : [];
  if (Number.isNaN(lat) || Number.isNaN(lon)) { sendJson(res, 400, { error: 'need lat/lon' }); return; }

  const img = await mapillaryNearest(lat, lon, token);
  if (!img) { sendJson(res, 200, { found: false, note: 'No street imagery available at this spot.' }); return; }
  const txt = await groqVision(img.thumb_1024_url, 'This is a street-level photo of UK houses. If a house/door number is CLEARLY and legibly visible on a building, reply with ONLY that number (e.g. "83"). If you cannot read a number with confidence, reply exactly "none". Never guess.', groq);
  const num = /none/i.test(txt) ? '' : ((String(txt).match(/\b(\d+[a-z]?)\b/i) || [])[1] || '');
  // Safety: only surface a number that matches a real address on the postcode.
  const match = num && candidates.find((c) => leadNum(c.line1 || c.fullAddress || c) === num.toLowerCase());
  sendJson(res, 200, {
    found: !!num,
    number: num || null,
    imageUrl: img.thumb_1024_url,
    matched: match ? (match.fullAddress || match) : null,
    note: num ? (match ? 'Number read from street imagery matches a real address on this postcode.' : 'A number was read but it is not on this postcode — ignore / verify.') : 'No legible house number in the available imagery.',
  });
}
