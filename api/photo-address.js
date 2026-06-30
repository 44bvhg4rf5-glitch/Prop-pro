import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { photoAddress } from '../lib/imageAddr.js';
import { visionConfigured } from '../lib/llm.js';

export const config = { maxDuration: 60 };

// Photo-based address finder.
//   GET  ?status=1                       → { vision: true|false }
//   POST { url } | { images[], postcode } → read the photos, match to Council Tax
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;

  if ((req.method || 'GET') === 'GET') {
    sendJson(res, 200, { vision: visionConfigured() });
    return;
  }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ }

  const url = (body.url || '').trim();
  const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
  const postcode = (body.postcode || '').trim();
  if (!url && !images.length) { sendJson(res, 400, { error: 'Send { url } (a Rightmove listing) or { images:[...], postcode }' }); return; }

  try {
    const result = await photoAddress({ url, images, postcode, epcKey: process.env.EPC_API_KEY || '' });
    res.setHeader('Access-Control-Allow-Origin', '*');
    sendJson(res, result.error ? 200 : 200, result);
  } catch (e) {
    sendJson(res, 500, { error: 'photo_address_failed', message: e.message });
  }
}
