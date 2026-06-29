import { sendJson, guardOrigin, readBody } from '../lib/helpers.js';
import { findOwner } from '../lib/owner.js';

export const config = { maxDuration: 60 };

// Batch owner check for a search: takes resolved addresses and returns, per item,
// whether free public records name a likely owner ("match") plus the names found.
// Cached + concurrency-limited so a whole search can be checked in one call.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const j = i++; try { out[j] = await fn(items[j]); } catch { out[j] = null; } }
  }));
  return out;
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ }
  const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  if (!items.length) { sendJson(res, 400, { error: 'Send { items: [{ id, line1, postcode }] }' }); return; }

  const results = await mapLimit(items, 4, async (it) => {
    const line1 = (it.line1 || (it.address || '').split(',')[0] || '').trim();
    const postcode = (it.postcode || '').trim().toUpperCase();
    if (!postcode && !line1) return { id: it.id, match: false, count: 0, owners: [] };
    const { owners } = await findOwner(line1, postcode);
    return {
      id: it.id,
      match: owners.length > 0,
      count: owners.length,
      owners: owners.slice(0, 4).map((o) => ({ name: o.name, role: o.role, source: o.source })),
    };
  });

  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { requested: items.length, results: results.filter(Boolean) });
}
