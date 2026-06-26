import https from 'https';
import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';

// AI proxy. The model is chosen server-side and injected here, so the browser
// never specifies (or sees) which model is used.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: { message: 'Method not allowed' } }); return; }

  const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '';
  const VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
  const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
  if (!API_KEY) {
    sendJson(res, 503, { error: { type: 'configuration_error', message: 'The server has no AI key configured. Set the AI key in the project settings.' } });
    return;
  }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);

  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* ignore */ }
  payload.model = MODEL; // server picks the model; client value is ignored
  const bodyStr = JSON.stringify(payload);

  const upstream = https.request(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': VERSION,
        'content-length': Buffer.byteLength(bodyStr),
      },
    },
    (up) => {
      res.statusCode = up.statusCode || 502;
      res.setHeader('Content-Type', up.headers['content-type'] || 'application/json');
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => sendJson(res, 502, { error: { type: 'upstream_error', message: err.message } }));
  upstream.write(bodyStr);
  upstream.end();
}
