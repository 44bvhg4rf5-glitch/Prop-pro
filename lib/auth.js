import crypto from 'crypto';
import { getJSON, setJSON, storeConfigured } from './store.js';

// ── Multi-tenant accounts (offices) + sessions ──
// Zero-lockout design: auth is only ACTIVE when SESSION_SECRET is set AND the
// KV store is configured. Until then everything runs in "open mode" exactly as
// before, under the 'default' tenant (which maps to the legacy propmail:* keys),
// so existing data and behaviour are preserved.

const SECRET = process.env.SESSION_SECRET || '';
const ACCTS_KEY = 'auth:accounts';   // { [id]: account }
const EMAIL_KEY = 'auth:emails';     // { [emailLower]: id }
const COOKIE = 'pm_session';
const TTL_DAYS = 30;

export function authEnabled() { return !!SECRET && storeConfigured(); }

// Tenant-scoped storage key. The 'default' office keeps the original keys so the
// current data simply becomes the head office's data when accounts are switched on.
export function tkey(tenant, name) { return tenant === 'default' ? ('propmail:' + name) : ('t:' + tenant + ':' + name); }

// ── Password hashing (scrypt) ──
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}
export function verifyPassword(pw, stored) {
  try {
    const [scheme, salt, h] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !h) return false;
    const calc = crypto.scryptSync(String(pw), salt, 64);
    const a = Buffer.from(h, 'hex');
    return a.length === calc.length && crypto.timingSafeEqual(a, calc);
  } catch { return false; }
}

// ── Signed session tokens: base64url(payload).hmac ──
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
export function verifyToken(token) {
  if (!token || !SECRET) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(req) {
  const out = {}; const h = req.headers.cookie || '';
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function getToken(req) { return parseCookies(req)[COOKIE] || ''; }
export function makeSessionCookie(token) {
  return COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (TTL_DAYS * 86400);
}
export function clearSessionCookie() { return COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }
export function newToken(accountId) { return signToken({ sub: accountId, exp: Date.now() + TTL_DAYS * 86400 * 1000 }); }

// ── Account store ──
export async function getAccounts() { return (await getJSON(ACCTS_KEY, {})) || {}; }
export async function countAccounts() { return Object.keys(await getAccounts()).length; }
export async function getAccountById(id) { const a = await getAccounts(); return a[id] || null; }
export async function getAccountByEmail(email) {
  const map = (await getJSON(EMAIL_KEY, {})) || {};
  const id = map[String(email || '').toLowerCase().trim()];
  return id ? getAccountById(id) : null;
}
export async function saveAccount(acc) {
  const accts = await getAccounts(); accts[acc.id] = acc; await setJSON(ACCTS_KEY, accts);
  const map = (await getJSON(EMAIL_KEY, {})) || {}; map[acc.email.toLowerCase()] = acc.id; await setJSON(EMAIL_KEY, map);
}
export async function deleteAccount(id) {
  const accts = await getAccounts(); const acc = accts[id]; if (!acc) return;
  delete accts[id]; await setJSON(ACCTS_KEY, accts);
  const map = (await getJSON(EMAIL_KEY, {})) || {}; if (map[acc.email.toLowerCase()] === id) delete map[acc.email.toLowerCase()]; await setJSON(EMAIL_KEY, map);
}

// Resolve the session for a request. Open mode → a synthetic admin/default session.
export async function getSession(req) {
  if (!authEnabled()) return { open: true, accountId: 'default', tenant: 'default', role: 'admin', email: '', name: 'Head office' };
  const payload = verifyToken(getToken(req));
  if (!payload || !payload.sub) return null;
  const acc = await getAccountById(payload.sub);
  if (!acc) return null;
  return { accountId: acc.id, tenant: acc.tenant, role: acc.role, email: acc.email, name: acc.name };
}

// Require a session; on failure send 401 and return null. Apply guardOrigin first.
export async function requireAuth(req, res) {
  const s = await getSession(req);
  if (!s) { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Please sign in.' })); return null; }
  return s;
}
