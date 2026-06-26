import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Reuse the exact same API handlers as the Vercel deployment, so both hosts
// behave identically.
import rightmove from './api/rightmove.js';
import listings from './api/listings.js';
import epc from './api/epc.js';
import epcMonitor from './api/epc-monitor.js';
import landregistry from './api/landregistry.js';
import addresses from './api/addresses.js';
import resolve from './api/resolve.js';
import owner from './api/owner.js';
import lead from './api/lead.js';
import suppress from './api/suppress.js';
import printnode from './api/printnode.js';
import ai from './api/ai.js';
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
  if (req.url.startsWith('/api/listings'))  { listings(req, res); return; }
  if (req.url.startsWith('/api/rightmove')) { rightmove(req, res); return; }
  if (req.url.startsWith('/api/landregistry')) { landregistry(req, res); return; }
  if (req.url.startsWith('/api/addresses')) { addresses(req, res); return; }
  if (req.url.startsWith('/api/resolve')) { resolve(req, res); return; }
  if (req.url.startsWith('/api/owner')) { owner(req, res); return; }
  if (req.url.startsWith('/api/lead')) { lead(req, res); return; }
  if (req.url.startsWith('/api/suppress')) { suppress(req, res); return; }
  if (req.url.startsWith('/api/printnode')) { printnode(req, res); return; }
  if (req.url.startsWith('/api/epc-monitor')) { epcMonitor(req, res); return; }
  if (req.url.startsWith('/api/epc'))       { epc(req, res); return; }
  if (req.url === '/api/ai')                { ai(req, res); return; }
  if (req.url === '/api/config')            { config(req, res); return; }

  // ── Static files ──
  let url = req.url === '/' ? '/index.html' : req.url;
  url = url.split('?')[0]; // strip query string
  if (!path.extname(url) && url !== '/') url += '.html'; // clean URLs (/valuation → valuation.html)
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
