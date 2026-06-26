import crypto from 'crypto';
import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import {
  authEnabled, getSession, getAccountByEmail, getAccountById, verifyPassword,
  hashPassword, saveAccount, deleteAccount, getAccounts, countAccounts,
  newToken, makeSessionCookie, clearSessionCookie,
} from '../lib/auth.js';

// Accounts / login. Dispatched by ?action=.
//   me | login | logout | setup           — public-ish (origin-guarded)
//   list | create | setpw | delete        — admin only
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const action = u.searchParams.get('action') || (req.method === 'GET' ? 'me' : '');
  const method = req.method || 'GET';
  const readJson = async () => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };

  // Status — drives the frontend gate.
  if (action === 'me') {
    const s = await getSession(req);
    sendJson(res, 200, {
      enabled: authEnabled(),
      needsSetup: authEnabled() && (await countAccounts()) === 0,
      authed: !!s && !s.open,
      open: !!(s && s.open),
      account: s ? { email: s.email, name: s.name, role: s.role, tenant: s.tenant } : null,
    });
    return;
  }

  if (action === 'login' && method === 'POST') {
    if (!authEnabled()) { sendJson(res, 400, { error: 'Accounts are not switched on for this server yet.' }); return; }
    const b = await readJson();
    const acc = await getAccountByEmail(b.email || '');
    if (!acc || !verifyPassword(b.password || '', acc.passwordHash)) { sendJson(res, 401, { error: 'Wrong email or password.' }); return; }
    res.setHeader('Set-Cookie', makeSessionCookie(newToken(acc.id)));
    sendJson(res, 200, { ok: true, account: { email: acc.email, name: acc.name, role: acc.role } });
    return;
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  // First-run: create the head office (only when enabled and zero accounts exist).
  if (action === 'setup' && method === 'POST') {
    if (!authEnabled()) { sendJson(res, 400, { error: 'Set SESSION_SECRET and the cloud store first.' }); return; }
    if ((await countAccounts()) > 0) { sendJson(res, 403, { error: 'Already set up — please sign in.' }); return; }
    const b = await readJson();
    if (!b.email || String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Enter an email and a password of at least 8 characters.' }); return; }
    const acc = { id: 'default', tenant: 'default', role: 'admin', name: (b.name || 'Head office').slice(0, 80), email: String(b.email).toLowerCase().trim(), passwordHash: hashPassword(b.password), createdAt: new Date().toISOString() };
    await saveAccount(acc);
    res.setHeader('Set-Cookie', makeSessionCookie(newToken(acc.id)));
    sendJson(res, 200, { ok: true, account: { email: acc.email, name: acc.name, role: acc.role } });
    return;
  }

  // ── Admin-only ──
  const sess = await getSession(req);
  const isAdmin = sess && (sess.open || sess.role === 'admin');
  if (!isAdmin) { sendJson(res, 403, { error: 'Admins only.' }); return; }
  if (!authEnabled()) { sendJson(res, 400, { error: 'Switch on accounts first (set SESSION_SECRET).' }); return; }

  if (action === 'list' && method === 'GET') {
    const accts = await getAccounts();
    sendJson(res, 200, { accounts: Object.values(accts).map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, tenant: a.tenant, createdAt: a.createdAt })) });
    return;
  }
  if (action === 'create' && method === 'POST') {
    const b = await readJson();
    if (!b.email || String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Email and an 8+ character password are required.' }); return; }
    if (await getAccountByEmail(b.email)) { sendJson(res, 409, { error: 'That email already has an account.' }); return; }
    const id = 'a' + crypto.randomBytes(6).toString('hex');
    const acc = { id, tenant: id, role: b.role === 'admin' ? 'admin' : 'office', name: (b.name || b.email).slice(0, 80), email: String(b.email).toLowerCase().trim(), passwordHash: hashPassword(b.password), createdAt: new Date().toISOString() };
    await saveAccount(acc);
    sendJson(res, 200, { ok: true, account: { id: acc.id, name: acc.name, email: acc.email, role: acc.role } });
    return;
  }
  if (action === 'setpw' && method === 'POST') {
    const b = await readJson();
    const acc = await getAccountById(b.id || '');
    if (!acc) { sendJson(res, 404, { error: 'No such account.' }); return; }
    if (String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Password must be at least 8 characters.' }); return; }
    acc.passwordHash = hashPassword(b.password); await saveAccount(acc);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (action === 'delete' && method === 'POST') {
    const b = await readJson();
    if (b.id === 'default') { sendJson(res, 400, { error: 'The head office account cannot be deleted.' }); return; }
    await deleteAccount(b.id || '');
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Unknown action.' });
}
