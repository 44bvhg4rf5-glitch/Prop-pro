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

// Free GOV.UK EPC register bearer token (for the full-address lookup).
const EPC_API_KEY = process.env.EPC_API_KEY || '';
const EPC_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';

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

// ── Rightmove live search (server-side, no API key needed) ──────────────
// Harrow outcode identifiers, confirmed via Rightmove's location service.
const OUTCODES = {
  HA0: 1053, HA1: 1054, HA2: 1055, HA3: 1056, HA4: 1057,
  HA5: 1058, HA6: 1059, HA7: 1060, HA8: 1061, HA9: 1062,
};

// Fetch a URL as text with a browser-like User-Agent (Rightmove blocks bots).
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        },
        (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            fetchText(r.headers.location).then(resolve, reject);
            return;
          }
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode, body }));
        }
      )
      .on('error', reject);
  });
}

// Pull the listings array out of Rightmove's embedded __NEXT_DATA__ blob.
function extractProperties(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  function find(o) {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) {
      for (const x of o) { const r = find(x); if (r) return r; }
      return null;
    }
    if (Array.isArray(o.properties) && o.properties[0] && o.properties[0].propertyUrl !== undefined) {
      return o.properties;
    }
    for (const k in o) { const r = find(o[k]); if (r) return r; }
    return null;
  }
  return find(data) || [];
}

async function handleRightmove(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const district = (u.searchParams.get('district') || '').toUpperCase();
  const channel = (u.searchParams.get('channel') || 'sale').toLowerCase();
  const minBeds = parseInt(u.searchParams.get('minBeds') || '0', 10) || 0;
  const maxPrice = parseInt(u.searchParams.get('maxPrice') || '0', 10) || 0;
  const index = parseInt(u.searchParams.get('index') || '0', 10) || 0;

  const outcode = OUTCODES[district];
  if (!outcode) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown district "${district}". Use HA0–HA9.` }));
    return;
  }

  const seg = channel === 'rent' || channel === 'let' ? 'property-to-rent' : 'property-for-sale';
  const q = new URLSearchParams({ locationIdentifier: `OUTCODE^${outcode}`, index: String(index), includeSSTC: 'false' });
  if (minBeds) q.set('minBedrooms', String(minBeds));
  if (maxPrice) q.set('maxPrice', String(maxPrice));
  const rmUrl = `https://www.rightmove.co.uk/${seg}/find.html?${q.toString()}`;

  try {
    const { status, body } = await fetchText(rmUrl);
    if (status !== 200) throw new Error(`Rightmove returned ${status}`);
    const raw = extractProperties(body);
    const properties = raw
      .filter((p) => p && p.propertyUrl)
      .map((p) => {
        const id = String(p.id || (p.propertyUrl.match(/(\d+)/) || [])[1] || '');
        const price =
          (p.price && (p.price.amount || (p.price.displayPrices && p.price.displayPrices[0] && p.price.displayPrices[0].displayPrice))) || '';
        return {
          propertyId: id,
          address: p.displayAddress || '',
          displayAddress: p.displayAddress || '',
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

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ district, channel, total: properties.length, properties }));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not fetch Rightmove: ' + e.message }));
  }
}

// GET a URL as JSON with a Bearer token (used for the EPC register).
function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* leave null */ }
          resolve({ status: r.statusCode, json, body });
        });
      })
      .on('error', reject);
  });
}

// Look up candidate full addresses (with house numbers) from the public EPC
// register for a given postcode, optionally ranked by street name.
async function handleEpc(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (!EPC_API_KEY) {
    send(503, {
      error: 'No EPC_API_KEY configured. Register free at ' +
        'https://get-energy-performance-data.communities.gov.uk and set EPC_API_KEY in the environment.',
    });
    return;
  }

  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || '').trim().toUpperCase();
  const street = (u.searchParams.get('street') || '').trim().toLowerCase();
  if (!postcode) { send(400, { error: 'postcode is required' }); return; }

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  // Pull just the road name out of a Rightmove displayAddress like
  // "Hatton Road, Wembley, HA0" → "hatton road".
  const streetName = norm(street.split(',')[0]);

  const epcUrl = `${EPC_BASE}/api/domestic/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, '+')}&page_size=500`;

  try {
    const { status, json, body } = await fetchJson(epcUrl, EPC_API_KEY);
    if (status === 401 || status === 403) { send(502, { error: 'EPC register rejected the key (HTTP ' + status + '). Check EPC_API_KEY.' }); return; }
    if (status !== 200) { send(502, { error: 'EPC register returned HTTP ' + status, detail: (body || '').slice(0, 200) }); return; }

    const rows = (json && json.data) || [];
    const candidates = rows.map((r) => {
      const lines = [r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4].filter(Boolean);
      const full = [...lines, r.postTown, r.postcode].filter(Boolean).join(', ');
      return {
        fullAddress: full,
        line1: r.addressLine1 || '',
        postcode: (r.postcode || '').replace(/\+/g, ' '),
        uprn: r.uprn || '',
        band: r.currentEnergyEfficiencyBand || '',
        certDate: r.registrationDate || '',
        _hay: norm(full),
      };
    });

    // Rank: addresses whose text contains the listing's street come first.
    let ranked = candidates;
    if (streetName) {
      const hits = candidates.filter((c) => c._hay.includes(streetName));
      ranked = hits.length ? hits : candidates;
    }
    ranked.forEach((c) => delete c._hay);

    send(200, { postcode, street: street || null, total: ranked.length, candidates: ranked.slice(0, 60) });
  } catch (e) {
    send(502, { error: 'EPC lookup failed: ' + e.message });
  }
}

const server = http.createServer((req, res) => {
  // ── Rightmove live search ──
  if (req.url.startsWith('/api/rightmove')) {
    handleRightmove(req, res);
    return;
  }

  // ── EPC full-address lookup ──
  if (req.url.startsWith('/api/epc')) {
    handleEpc(req, res);
    return;
  }

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
