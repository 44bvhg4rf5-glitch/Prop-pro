import https from 'https';

// Durable do-not-mail / suppression list, backed by Vercel KV (Upstash Redis
// REST). The whole list is a single JSON blob under one key — small enough
// (hundreds–low-thousands of entries) that one GET/SET per change is fine.
const LIST_KEY = 'propmail:blocklist';

// Vercel KV and the Upstash integration use different env var names — accept both.
function kvCreds() {
  return {
    base: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}

// Run a single Redis command via the Vercel KV / Upstash REST API.
function kv(cmd) {
  return new Promise((resolve) => {
    const { base, token } = kvCreds();
    if (!base || !token) { resolve({ configured: false, result: null }); return; }
    let target;
    try { target = new URL(base); } catch { resolve({ configured: false, result: null }); return; }
    const data = JSON.stringify(cmd);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname && target.pathname !== '/' ? target.pathname : '/',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ configured: true, status: r.statusCode, result: j ? j.result : null }); });
    });
    req.on('error', () => resolve({ configured: true, status: 502, result: null, error: true }));
    req.write(data);
    req.end();
  });
}

export function blocklistConfigured() {
  const { base, token } = kvCreds();
  return !!(base && token);
}

export async function getBlocklist() {
  const r = await kv(['GET', LIST_KEY]);
  if (!r.configured) return { configured: false, entries: [] };
  let entries = [];
  try { entries = r.result ? JSON.parse(r.result) : []; } catch { entries = []; }
  if (!Array.isArray(entries)) entries = [];
  return { configured: true, entries };
}

async function saveBlocklist(entries) {
  return kv(['SET', LIST_KEY, JSON.stringify(entries)]);
}

// ── Normalisation + matching ──
export function normAddr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function despacePc(s) { return (s || '').toUpperCase().replace(/\s+/g, ''); }

// Pre-compute fast lookup structures from the entry list.
export function buildMatcher(entries) {
  const uprns = new Set();
  const fulls = new Set();
  const pcHouse = [];
  for (const e of entries || []) {
    if (e.uprn) uprns.add(String(e.uprn));
    if (e.fullAddress) fulls.add(normAddr(e.fullAddress));
    if (e.postcode && e.house) pcHouse.push({ pc: despacePc(e.postcode), house: normAddr(e.house) });
  }
  return { uprns, fulls, pcHouse };
}

// Is this address on the suppression list? Errs toward blocking (legal safety):
// matches on UPRN, exact normalised address, or postcode + house token.
export function isSuppressed(addr, m) {
  if (!m) return false;
  if (addr.uprn && m.uprns.has(String(addr.uprn))) return true;
  if (addr.fullAddress && m.fulls.has(normAddr(addr.fullAddress))) return true;
  if (m.pcHouse.length) {
    const apc = despacePc(addr.postcode);
    const nl1 = normAddr(addr.line1 || (addr.fullAddress || '').split(',')[0]);
    for (const e of m.pcHouse) {
      if (e.pc && apc === e.pc && e.house) {
        const nh = e.house;
        if (nl1 === nh || nl1.startsWith(nh + ' ') || (' ' + nl1 + ' ').includes(' ' + nh + ' ')) return true;
      }
    }
  }
  return false;
}

export async function addEntry(entry) {
  const { configured, entries } = await getBlocklist();
  if (!configured) return { configured: false, entries: [] };
  const m = buildMatcher(entries);
  const probe = { uprn: entry.uprn, fullAddress: entry.fullAddress, postcode: entry.postcode, line1: entry.house || (entry.fullAddress || '').split(',')[0] };
  if (!isSuppressed(probe, m)) { entries.push(entry); await saveBlocklist(entries); }
  return { configured: true, entries };
}

export async function removeEntry(id) {
  const { configured, entries } = await getBlocklist();
  if (!configured) return { configured: false, entries: [] };
  const next = entries.filter((e) => e.id !== id);
  await saveBlocklist(next);
  return { configured: true, entries: next };
}
