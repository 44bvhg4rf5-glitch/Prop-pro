import { readBody, sendJson } from '../lib/helpers.js';
import { getBlocklist, addEntry, removeEntry } from '../lib/blocklist.js';

// Do-not-mail suppression list API.
//   GET                      → { configured, count, entries }
//   POST {fullAddress|postcode+house, uprn?, reason?} → add
//   DELETE ?id=...           → remove
export default async function handler(req, res) {
  const method = req.method || 'GET';

  if (method === 'GET') {
    const { configured, entries } = await getBlocklist();
    sendJson(res, 200, { configured, count: entries.length, entries });
    return;
  }

  if (method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
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
