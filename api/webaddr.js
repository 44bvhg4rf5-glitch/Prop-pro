import { sendJson, guardOrigin } from '../lib/helpers.js';
import { webSearch, searchConfigured } from '../lib/search.js';

export const config = { maxDuration: 20 };

// "Google for addresses" — uses the free web-search key (Tavily) to find real
// full addresses (house number + street + postcode) for a street/area from
// property pages across the web. Best for the Success Letters tab, where the
// user is looking up addresses by hand rather than scanning a whole search.
const ROADS = 'Road|Street|Avenue|Lane|Close|Drive|Way|Gardens?|Grove|Crescent|Place|Terrace|Hill|Park|Rise|Walk|Row|Green|Square|Vale|Court|Parade|Broadway|Mews|Gate';

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const q = (u.searchParams.get('q') || '').trim();
  if (!q) { sendJson(res, 400, { error: 'q (street and/or postcode) is required' }); return; }
  if (!searchConfigured()) { sendJson(res, 503, { error: 'no_search', note: 'Add a free TAVILY_API_KEY to enable web address search.' }); return; }

  const web = await webSearch(`${q} property for sale OR sold OR to rent house number full address`, { maxResults: 8 }).catch(() => ({ results: [], answer: '' }));
  const text = [web.answer || '', ...(web.results || []).map((r) => `${r.title} ${r.content}`)].join('  \n  ');

  const re = new RegExp(`\\b(\\d+[a-z]?\\s+[A-Z][A-Za-z'’.]+(?:\\s+[A-Z][A-Za-z'’.]+){0,3}\\s+(?:${ROADS}))\\b[ ,]*([A-Z][a-z]+)?[ ,]*([A-Z]{1,2}\\d[\\dA-Z]?\\s*\\d[A-Z]{2})?`, 'g');
  const seen = new Map();
  let m;
  while ((m = re.exec(text))) {
    const parts = [m[1], m[3]].filter(Boolean);
    const a = parts.join(', ').replace(/\s+/g, ' ').trim();
    const k = a.toLowerCase();
    if (a.length > 8 && !seen.has(k)) seen.set(k, { address: a, hasPostcode: !!m[3] });
  }
  const addresses = [...seen.values()].sort((a, b) => (b.hasPostcode - a.hasPostcode)).slice(0, 40);
  sendJson(res, 200, {
    query: q, total: addresses.length, addresses,
    sources: (web.results || []).slice(0, 6).map((r) => ({ title: r.title, url: r.url })),
    provider: searchConfigured(),
    note: addresses.length ? 'Addresses found on the web — verify before posting.' : 'No full addresses found on the web for that search.',
  });
}
