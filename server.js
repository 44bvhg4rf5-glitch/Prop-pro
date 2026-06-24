import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Reuse the exact same API handlers as the Vercel deployment, so both hosts
// behave identically.
import rightmove from './api/rightmove.js';
import epc from './api/epc.js';
import anthropic from './api/anthropic.js';
import config from './api/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  // ── API endpoints (shared with api/*.js) ──
  if (req.url.startsWith('/api/rightmove')) { rightmove(req, res); return; }
  if (req.url.startsWith('/api/epc'))       { epc(req, res); return; }
  if (req.url === '/api/anthropic')         { anthropic(req, res); return; }
  if (req.url === '/api/config')            { config(req, res); return; }

  // ── Static files ──
  let url = req.url === '/' ? '/index.html' : req.url;
  url = url.split('?')[0]; // strip query string
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
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off'} · EPC: ${process.env.EPC_API_KEY ? 'on' : 'off'}\n`);
});
