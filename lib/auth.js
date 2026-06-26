import crypto from 'crypto';
import { getJSON, setJSON, storeConfigured } from './store.js';

// ── Accounts: individual logins grouped under an office ──
//   office (tenant) = the data boundary; its leads & performance are shared.
//   account (user)  = one person's login (email + password) belonging to an office.
// Auth is ENFORCED once at least one account exists. The signing secret comes
// from SESSION_SECRET if set, otherwise it's generated once and kept in the
// store — so accounts can be switched on from inside the app with no env edits.
// With no store at all, the app stays in open mode exactly as before.

const ACCTS_KEY = 'auth:accounts';   // { [id]: account }
const EMAIL_KEY = 'auth:emails';     // { [emailLower]: id }
const OFFICES_KEY = 'auth:offices';  // { [tenant]: { id, name, createdAt } }
const SECRET_KEY = 'auth:secret';
const COOKIE = 'pm_session';
const TTL_DAYS = 30;

let _secret = process.env.SESSION_SECRET || null;
async function ensureSecret(create) {
  if (_secret) return _secret;
  if (!storeConfigured()) return null;
  let s = await getJSON(SECRET_KEY, null);
  if (!s && create) { s = crypto.randomBytes(32).toString('hex'); await setJSON(SECRET_KEY, s); }
  if (s) _secret = s;
  return _secret;
}
// Force a re-read of the secret from the store (bypasses the warm-instance cache).
// Used to recover when a cached secret is stale after a reset / rotation.
async function reloadSecret() {
  if (process.env.SESSION_SECRET) { _secret = process.env.SESSION_SECRET; return _secret; }
  if (!storeConfigured()) return null;
  const s = await getJSON(SECRET_KEY, null);
  _secret = s || null;
  return _secret;
}

export function authConfigured() { return storeConfigured(); }
export function tkey(tenant, name) { return tenant === 'default' ? ('propmail:' + name) : ('t:' + tenant + ':' + name); }

// ── Password hashing (scrypt) ──
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
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

// ── Signed session tokens (caller must ensureSecret first) ──
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', _secret).update(body).digest('base64url');
  return body + '.' + sig;
}
export function verifyToken(token) {
  if (!token || !_secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', _secret).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}
function parseCookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function getToken(req) { return parseCookies(req)[COOKIE] || ''; }
export function makeSessionCookie(token) { return COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (TTL_DAYS * 86400); }
export function clearSessionCookie() { return COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }
export async function newToken(accountId) { await ensureSecret(true); return signToken({ sub: accountId, exp: Date.now() + TTL_DAYS * 86400 * 1000 }); }

// ── Accounts ──
export async function getAccounts() { return (await getJSON(ACCTS_KEY, {})) || {}; }
export async function accountCount() { return Object.keys(await getAccounts()).length; }
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

// ── Offices (tenants) ──
export async function getOffices() { return (await getJSON(OFFICES_KEY, {})) || {}; }
export async function saveOffice(o) { const m = await getOffices(); m[o.id] = o; await setJSON(OFFICES_KEY, m); }
export async function removeOffice(id) { const m = await getOffices(); delete m[id]; await setJSON(OFFICES_KEY, m); }
export async function officeMemberCount(tenant) { return Object.values(await getAccounts()).filter((a) => a.tenant === tenant).length; }

export function authActiveFrom(count) { return storeConfigured() && count > 0; }

// Resolve the session. No store → open. Store but no accounts yet → open + setup
// flag (first-run). Accounts exist → a valid signed session is required.
export async function getSession(req) {
  if (!storeConfigured()) return { open: true, accountId: 'default', tenant: 'default', role: 'admin', email: '', name: 'Head office' };
  if ((await accountCount()) === 0) return { open: true, setup: true, accountId: 'default', tenant: 'default', role: 'admin', email: '', name: 'Head office' };
  await ensureSecret(false);
  const token = getToken(req);
  let payload = verifyToken(token);
  if (!payload && token) { await reloadSecret(); payload = verifyToken(token); } // recover from a stale cached secret
  if (!payload || !payload.sub) return null;
  const acc = await getAccountById(payload.sub);
  if (!acc) return null;
  return { accountId: acc.id, tenant: acc.tenant, role: acc.role, email: acc.email, name: acc.name };
}
// Wipe all accounts/offices/secret — "start over". Caller must be a real admin.
export async function resetAuth() {
  await setJSON(ACCTS_KEY, {}); await setJSON(EMAIL_KEY, {});
  await setJSON(OFFICES_KEY, {}); await setJSON(SECRET_KEY, null);
  _secret = process.env.SESSION_SECRET || null;
}

export async function requireAuth(req, res) {
  const s = await getSession(req);
  if (!s) { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Please sign in.' })); return null; }
  return s;
}
