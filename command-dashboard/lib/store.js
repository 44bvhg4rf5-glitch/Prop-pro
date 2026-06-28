import https from 'https';
import Redis from 'ioredis';

// Generic durable JSON store (same dual transport as the blocklist): Vercel KV /
// Upstash REST when KV_REST_API_* is set, else a plain Redis connection string.
function kvCreds() {
  return {
    base: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  };
}
export function storeConfigured() {
  const { base, token } = kvCreds();
  return !!((base && token) || process.env.REDIS_URL);
}
function usingRest() { const { base, token } = kvCreds(); return !!(base && token); }

function kvRest(cmd) {
  return new Promise((resolve) => {
    const { base, token } = kvCreds();
    let target; try { target = new URL(base); } catch { resolve({ result: null }); return; }
    const data = JSON.stringify(cmd);
    const req = https.request({
      hostname: target.hostname, port: target.port || 443,
      path: target.pathname && target.pathname !== '/' ? target.pathname : '/',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ result: j ? j.result : null }); }); });
    req.on('error', () => resolve({ result: null }));
    req.write(data); req.end();
  });
}

let _redis = null;
function redisClient() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  if (!_redis) {
    try { _redis = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 8000, tls: url.startsWith('rediss://') ? {} : undefined }); _redis.on('error', () => {}); }
    catch { _redis = null; }
  }
  return _redis;
}

async function getRaw(key) {
  if (usingRest()) { const r = await kvRest(['GET', key]); return r.result; }
  const c = redisClient(); if (c) { try { return await c.get(key); } catch { return null; } }
  return null;
}
async function setRaw(key, val) {
  if (usingRest()) return kvRest(['SET', key, val]);
  const c = redisClient(); if (c) { try { await c.set(key, val); } catch {} }
}

export async function getJSON(key, fallback) {
  try { const raw = await getRaw(key); return raw ? JSON.parse(raw) : (fallback ?? null); } catch { return fallback ?? null; }
}
export async function setJSON(key, val) { return setRaw(key, JSON.stringify(val)); }

// Prepend an item to a capped list stored as a JSON array.
export async function unshiftList(key, item, cap = 500) {
  const list = (await getJSON(key, [])) || [];
  list.unshift(item);
  if (list.length > cap) list.length = cap;
  await setJSON(key, list);
  return list;
}
