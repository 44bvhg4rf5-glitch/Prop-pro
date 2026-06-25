import https from 'https';
import Redis from 'ioredis';

// Durable do-not-mail / suppression list. Stored as one JSON blob under one key
// — small enough (hundreds–low-thousands of entries) that one GET/SET per change
// is fine. Works with either a Vercel KV / Upstash REST API (KV_REST_API_*) or a
// plain Redis connection string (REDIS_URL), whichever the host provides.
const LIST_KEY = 'propmail:blocklist';

// Vercel KV and the Upstash integration use different env var names — accept both.
function kvCreds() {
  return {
    base: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}

// ── Transport 1: REST (Upstash/Vercel KV REST API) ──
function kvRest(cmd) {
  return new Promise((resolve) => {
    const { base, token } = kvCreds();
    let target;
    try { target = new URL(base); } catch { resolve({ result: null, error: true }); return; }
    const data = JSON.stringify(cmd);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname && target.pathname !== '/' ? target.pathname : '/',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: r.statusCode, result: j ? j.result : null }); });
    });
    req.on('error', () => resolve({ status: 502, result: null, error: true }));
    req.write(data);
    req.end();
  });
}

// ── Transport 2: TCP Redis via REDIS_URL (reused across warm invocations) ──
let _redis = null;
function redisClient() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  if (!_redis) {
    try {
      _redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        connectTimeout: 8000,
        tls: url.startsWith('rediss://') ? {} : undefined,
      });
      _redis.on('error', () => { /* swallow — handled per-call */ });
    } catch { _redis = null; }
  }
  return _redis;
}

function usingRest() { const { base, token } = kvCreds(); return !!(base && token); }

export function blocklistConfigured() {
  return usingRest() || !!process.env.REDIS_URL;
}

async function getRaw() {
  if (usingRest()) { const r = await kvRest(['GET', LIST_KEY]); return { configured: true, raw: r.result }; }
  const c = redisClient();
  if (c) { try { const v = await c.get(LIST_KEY); return { configured: true, raw: v }; } catch { return { configured: true, raw: null, error: true }; } }
  return { configured: false, raw: null };
}

async function setRaw(str) {
  if (usingRest()) return kvRest(['SET', LIST_KEY, str]);
  const c = redisClient();
  if (c) { try { await c.set(LIST_KEY, str); return { configured: true }; } catch { return { configured: true, error: true }; } }
  return { configured: false };
}

export async function getBlocklist() {
  const { configured, raw } = await getRaw();
  if (!configured) return { configured: false, entries: [] };
  let entries = [];
  try { entries = raw ? JSON.parse(raw) : []; } catch { entries = []; }
  if (!Array.isArray(entries)) entries = [];
  return { configured: true, entries };
}

async function saveBlocklist(entries) {
  return setRaw(JSON.stringify(entries));
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
