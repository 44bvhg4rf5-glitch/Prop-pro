import https from 'https';
import { readBody, sendJson } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: { message: 'Method not allowed' } }); return; }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
  const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
  if (!ANTHROPIC_API_KEY) {
    sendJson(res, 503, {
      error: {
        type: 'configuration_error',
        message: 'The server has no ANTHROPIC_API_KEY configured. Set it in the Vercel project settings.',
      },
    });
    return;
  }

  // Vercel may have already parsed the JSON body; otherwise read the raw stream.
  let bodyStr;
  if (req.body && typeof req.body === 'object') bodyStr = JSON.stringify(req.body);
  else if (typeof req.body === 'string') bodyStr = req.body;
  else bodyStr = await readBody(req);

  const upstream = https.request(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
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
