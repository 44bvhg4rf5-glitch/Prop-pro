import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Standalone Command dashboard server. Completely independent of PropMail Pro —
// its own code, its own deploy, its own data store. Run with:
//   GEMINI_API_KEY=... node server.js   (then open http://localhost:3000)
import ai from './api/ai.js';
import dashboard from './api/dashboard.js';

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
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/ai')                { ai(req, res); return; }
  if (req.url.startsWith('/api/dashboard')) { dashboard(req, res); return; }

  // ── Static files ──
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/index.html';
  else if (!path.extname(url)) url += '.html';
  const safePath = path.normalize(url).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const filePath = path.join(__dirname, 'public', safePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); return;
  }
  const mime = MIME[path.extname(filePath)] || 'text/plain';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Command dashboard running at http://localhost:${PORT}`);
  console.log(`  AI: ${process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY ? 'on' : 'off'}\n`);
});
