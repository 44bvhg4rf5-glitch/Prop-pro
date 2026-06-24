import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// API key is read from the environment and never exposed to the browser.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// Read a request body into a string.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5_000_000) { // 5MB guard
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Proxy a request through to the Anthropic Messages API, injecting the key
// server-side so it is never shipped to the browser.
async function proxyAnthropic(req, res) {
  if (!ANTHROPIC_API_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'configuration_error',
        message: 'The server has no ANTHROPIC_API_KEY configured. Set it in the environment and restart: ANTHROPIC_API_KEY=sk-ant-... node server.js',
      },
    }));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: e.message } }));
    return;
  }

  const upstream = https.request(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-length': Buffer.byteLength(body),
      },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'application/json',
      });
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'upstream_error', message: err.message } }));
  });

  upstream.write(body);
  upstream.end();
}

const server = http.createServer((req, res) => {
  // ── API proxy ──
  if (req.url === '/api/anthropic') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Method not allowed' } }));
      return;
    }
    proxyAnthropic(req, res);
    return;
  }

  // ── Lightweight config probe for the frontend ──
  if (req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ aiEnabled: Boolean(ANTHROPIC_API_KEY) }));
    return;
  }

  // ── Static files ──
  let url = req.url === '/' ? '/index.html' : req.url;
  url = url.split('?')[0]; // strip query string
  // Prevent path traversal.
  const safePath = path
    .normalize(url)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^\/+/, '');
  const filePath = path.join(__dirname, 'public', safePath);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  PropMail Pro running at http://localhost:${PORT}`);
  console.log(`  AI features: ${ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY to enable)'}\n`);
});
