import https from 'https';
import { getJSON, setJSON, storeConfigured } from './store.js';

// Council Tax address source — the VOA "Check your Council Tax band" service on
// gov.uk lists EVERY residential dwelling in England & Wales for a postcode,
// INCLUDING flat/unit numbers inside a block (e.g. "Flat 1 at 34 Pinner Road").
// That's the authoritative unit list we otherwise lack without paid Royal Mail
// PAF. It's property data only (address + band, no occupants) so it stays inside
// the postal-only / public-records rule.
//
// There's no free JSON API, so we read the public web form: GET the search page
// for a session + CSRF token, POST the postcode, follow the redirect, parse the
// results. We cache per postcode and query gently — it's a shared public service.

const BASE = 'https://www.tax.service.gov.uk/check-council-tax-band/search';
const _mem = new Map(); // postcode (no spaces, upper) -> parsed rows

function request(method, url, { headers = {}, body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { resolve({ status: 0, headers: {}, body: '', error: 'bad_url' }); return; }
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'User-Agent': 'PropMailPro/1.0 (+https://prop-pro-theta.vercel.app)', Accept: 'text/html', ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    r.setTimeout(timeoutMs, () => { r.destroy(); resolve({ status: 0, headers: {}, body: '', error: 'timeout' }); });
    if (body) r.write(body); r.end();
  });
}
const jarOf = (setCookie) => (setCookie || []).map((c) => c.split(';')[0]).join('; ');
const normPc = (pc) => String(pc || '').toUpperCase().replace(/\s+/g, '');

// "FLAT 1 AT 34 PINNER ROAD, HARROW, HA1 4HZ" -> { flat:'1', buildingNo:'34', street:'pinner road' }
export function parseCouncilTax(address) {
  const first = String(address || '').split(',')[0].trim();
  let flat = '', rest = first;
  const fm = first.match(/^(?:FLAT|APARTMENT|APT|UNIT|ROOM|STUDIO|MAISONETTE)\s+([0-9A-Z]+)\s+(?:AT\s+)?(.*)$/i);
  if (fm) { flat = fm[1]; rest = fm[2]; }
  let buildingNo = '';
  const nm = rest.match(/^([0-9]+[A-Z]?)\s+(.*)$/i);
  if (nm) { buildingNo = nm[1]; rest = nm[2]; }
  return { flat: flat.toLowerCase(), buildingNo: buildingNo.toLowerCase(), street: rest.toLowerCase().replace(/\s+/g, ' ').trim() };
}

// Parse one results page into address rows (address link + its band, in order).
function parseRows(html) {
  const linkRe = /<a[^>]*>\s*([^<]*?(?:ROAD|STREET|AVENUE|CLOSE|DRIVE|COURT|GARDENS|LANE|WAY|TERRACE|PLACE|CRESCENT|GROVE|HILL|PARK|MEWS|WALK|ROW|RISE|VALE|GREEN|SQUARE|PARADE|BROADWAY)[^<]*?,[^<]*?)\s*<\/a>/gi;
  const bandRe = /Band\s+([A-H])\b/gi;
  const addrs = [...html.matchAll(linkRe)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  const bands = [...html.matchAll(bandRe)].map((m) => m[1].toUpperCase());
  return addrs.map((a, i) => ({ address: a, band: bands[i] || null, ...parseCouncilTax(a) }));
}

// Fetch the full residential address list for a postcode — ALL pages (the VOA
// service shows 20 per page). Returns
// { rows: [{ address, band, flat, buildingNo, street }], cached } or { error }.
export async function councilTaxAddresses(postcode) {
  const mk = normPc(postcode);
  if (!mk) return { error: 'no_postcode', rows: [] };
  if (_mem.has(mk)) return { rows: _mem.get(mk), cached: true };
  // Durable KV cache — survives cold starts, so a postcode is only ever scraped
  // once (a nightly cron pre-warms popular ones). Property data, no expiry.
  if (storeConfigured()) { const kv = await getJSON('ct:' + mk, null); if (kv && Array.isArray(kv)) { _mem.set(mk, kv); return { rows: kv, cached: true, kv: true }; } }
  // 1. session + CSRF
  const g = await request('GET', BASE);
  if (g.error || g.status !== 200) return { error: 'search_page_' + (g.error || g.status), rows: [] };
  const jar = jarOf(g.headers['set-cookie']);
  const tok = (g.body.match(/name="csrfToken"\s+value="([^"]+)"/i) || [])[1];
  if (!tok) return { error: 'no_csrf', rows: [] };
  // 2. POST the postcode (space form is what the page submits)
  const pcSpaced = mk.length > 3 ? mk.slice(0, -3) + ' ' + mk.slice(-3) : mk;
  const form = `csrfToken=${encodeURIComponent(tok)}&postcode=${encodeURIComponent(pcSpaced)}`;
  let p = await request('POST', BASE, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar, Referer: BASE, 'Content-Length': Buffer.byteLength(form) }, body: form });
  // 3. follow the redirect(s) to the results page, carrying cookies. Keep the
  // final URL — it holds the opaque postcode token used to page through results.
  let hops = 0, finalUrl = BASE;
  while (p.status >= 300 && p.status < 400 && p.headers.location && hops++ < 3) {
    finalUrl = new URL(p.headers.location, BASE).toString();
    p = await request('GET', finalUrl, { headers: { Cookie: jar, Referer: BASE } });
  }
  if (p.error || p.status !== 200) return { error: 'results_' + (p.error || p.status), rows: [] };
  // 4. first page + total, then follow remaining pages (page is 0-indexed: the
  // 2nd page is &page=1). Cap at 12 pages (240 dwellings) to stay gentle.
  const total = parseInt((p.body.match(/of\s+(\d+)\s+results/i) || [])[1] || '0', 10);
  let rows = parseRows(p.body);
  const token = (() => { try { return new URL(finalUrl).searchParams.get('postcode') || ''; } catch { return ''; } })();
  if (token && total > rows.length) {
    for (let page = 1; page * 20 < total && page < 12; page++) {
      const pr = await request('GET', `${BASE}?postcode=${encodeURIComponent(token)}&page=${page}`, { headers: { Cookie: jar, Referer: finalUrl } });
      if (pr.status !== 200) break;
      rows = rows.concat(parseRows(pr.body));
    }
  }
  // dedupe by address across pages
  const seen = new Set();
  const uniq = rows.filter((r) => !seen.has(r.address) && seen.add(r.address));
  if (_mem.size > 500) _mem.clear(); // bound memory on a long-lived warm instance
  _mem.set(mk, uniq);
  if (storeConfigured() && uniq.length) setJSON('ct:' + mk, uniq).catch(() => {}); // persist for next time
  return { rows: uniq, cached: false, total };
}

export function councilTaxConfigured() { return true; } // free, no key needed

// Cheap cache peek — lets a caller use already-fetched rows without paying for
// (or being budget-gated on) a new network fetch.
export function councilTaxCached(postcode) {
  const mk = normPc(postcode);
  return _mem.has(mk) ? _mem.get(mk) : null;
}
