import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { getBlocklist, addEntry, addEntries, removeEntry } from '../lib/blocklist.js';

// Do-not-mail suppression list API.
//   GET                      → { configured, count, entries }
//   POST {fullAddress|postcode+house, uprn?, reason?} → add
//   DELETE ?id=...           → remove
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const method = req.method || 'GET';

  if (method === 'GET') {
    const u = new URL(req.url, 'http://localhost');
    if (process.env.DEBUG_KEY && u.searchParams.get('debug') === process.env.DEBUG_KEY) {
      // Report which storage-related env var NAMES exist (no values/secrets).
      const names = Object.keys(process.env).filter((k) => /REDIS|KV_|UPSTASH|STORAGE|^KV$/i.test(k)).sort();
      sendJson(res, 200, { debug: true, storageEnvNames: names });
      return;
    }
    const { configured, entries } = await getBlocklist();
    sendJson(res, 200, { configured, count: entries.length, entries });
    return;
  }

  if (method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }

    // Bulk paste: { bulk: ["addr line", ...] }
    if (Array.isArray(body.bulk)) {
      const list = body.bulk.map((x) => {
        const fa = (typeof x === 'string' ? x : (x && x.fullAddress) || '').trim();
        if (!fa) return null;
        return {
          id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          uprn: '', fullAddress: fa, postcode: '', house: '',
          line1: fa.split(',')[0] || '', reason: (body.reason || 'bulk import').trim(),
          addedAt: new Date().toISOString(),
        };
      }).filter(Boolean);
      const r = await addEntries(list);
      if (!r.configured) { sendJson(res, 200, { configured: false }); return; }
      sendJson(res, 200, { configured: true, added: r.added, count: r.entries.length, entries: r.entries });
      return;
    }

    const fullAddress = (body.fullAddress || '').trim();
    const postcode = (body.postcode || '').trim();
    const house = (body.house || '').trim();
    const uprn = (body.uprn || '').toString().trim();
    if (!fullAddress && !(postcode && house)) {
      sendJson(res, 400, { error: 'Provide a full address, or a postcode and house number/name.' });
      return;
    }
    const entry = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      uprn,
      fullAddress,
      postcode,
      house,
      line1: (body.line1 || fullAddress.split(',')[0] || '').trim(),
      reason: (body.reason || '').trim(),
      addedAt: new Date().toISOString(),
    };
    const r = await addEntry(entry);
    if (!r.configured) { sendJson(res, 200, { configured: false }); return; }
    sendJson(res, 200, { configured: true, added: entry, count: r.entries.length, entries: r.entries });
    return;
  }

  if (method === 'DELETE') {
    const u = new URL(req.url, 'http://localhost');
    const id = u.searchParams.get('id') || '';
    if (!id) { sendJson(res, 400, { error: 'id is required' }); return; }
    const r = await removeEntry(id);
    if (!r.configured) { sendJson(res, 200, { configured: false }); return; }
    sendJson(res, 200, { configured: true, count: r.entries.length, entries: r.entries });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
