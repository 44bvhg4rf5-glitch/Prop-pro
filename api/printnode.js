import https from 'https';
import { readBody, sendJson } from '../lib/helpers.js';
import { lettersToPdfBase64 } from '../lib/pdf.js';

// Call the PrintNode API with HTTP Basic auth (API key as username).
function printnode(path, key, method = 'GET', payload = null) {
  return new Promise((resolve) => {
    const data = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      'https://api.printnode.com' + path,
      {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { j = b; } resolve({ status: r.statusCode, json: j }); });
      }
    );
    req.on('error', (e) => resolve({ status: 502, json: { error: e.message } }));
    if (data) req.write(data);
    req.end();
  });
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const action = u.searchParams.get('action') || 'printers';
  const key = req.headers['x-printnode-key'] || process.env.PRINTNODE_API_KEY || '';
  if (!key) { sendJson(res, 400, { error: 'No PrintNode API key. Connect your printer first.' }); return; }

  if (action === 'printers') {
    const r = await printnode('/printers', key);
    if (r.status === 401 || r.status === 403) { sendJson(res, 401, { error: 'PrintNode rejected the key.' }); return; }
    const list = Array.isArray(r.json) ? r.json.map((p) => ({ id: p.id, name: p.name, state: p.state, computer: p.computer && p.computer.name })) : [];
    sendJson(res, 200, { printers: list });
    return;
  }

  if (action === 'whoami') {
    const r = await printnode('/whoami', key);
    sendJson(res, r.status === 200 ? 200 : 401, r.json || {});
    return;
  }

  if (action === 'print') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
    const printerId = Number(body.printerId);
    if (!printerId) { sendJson(res, 400, { error: 'printerId is required' }); return; }
    let pdf = body.pdfBase64;
    try { if (!pdf && Array.isArray(body.letters)) pdf = await lettersToPdfBase64(body.letters); } catch (e) { sendJson(res, 500, { error: 'PDF build failed: ' + e.message }); return; }
    if (!pdf) { sendJson(res, 400, { error: 'letters or pdfBase64 required' }); return; }
    const r = await printnode('/printjobs', key, 'POST', {
      printerId, title: body.title || 'PropMail Pro letters', contentType: 'pdf_base64', content: pdf, source: 'PropMail Pro',
    });
    if (r.status >= 200 && r.status < 300) { sendJson(res, 200, { ok: true, jobId: r.json }); return; }
    sendJson(res, 502, { error: 'PrintNode error', status: r.status, detail: r.json });
    return;
  }

  sendJson(res, 400, { error: 'Unknown action' });
}
