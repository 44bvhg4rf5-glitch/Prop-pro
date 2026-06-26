import crypto from 'crypto';
import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import {
  authConfigured, getSession, getAccountByEmail, getAccountById, verifyPassword,
  hashPassword, saveAccount, deleteAccount, getAccounts, accountCount,
  getOffices, saveOffice, removeOffice, officeMemberCount,
  newToken, makeSessionCookie, clearSessionCookie, resetAuth,
} from '../lib/auth.js';

// Accounts & office portals. Dispatched by ?action=.
//   me | login | logout | setup                         — sign-in flow
//   offices | create-office | delete-office             — admin: offices
//   list | create | setpw | delete                      — admin: users
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const action = u.searchParams.get('action') || (req.method === 'GET' ? 'me' : '');
  const method = req.method || 'GET';
  const readJson = async () => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };
  const email = (s) => String(s || '').toLowerCase().trim();

  // Status — drives the frontend gate.
  if (action === 'me') {
    const count = authConfigured() ? await accountCount() : 0;
    const active = authConfigured() && count > 0;
    const s = await getSession(req);
    sendJson(res, 200, {
      configured: authConfigured(),
      active,
      canSetup: authConfigured() && count === 0,
      authed: !!s && !s.open,
      open: !!(s && s.open),
      account: s && !s.open ? { email: s.email, name: s.name, role: s.role, tenant: s.tenant } : null,
    });
    return;
  }

  if (action === 'login' && method === 'POST') {
    if (!authConfigured()) { sendJson(res, 400, { error: 'Accounts need the cloud store, which is not configured.' }); return; }
    const b = await readJson();
    const acc = await getAccountByEmail(b.email || '');
    if (!acc || !verifyPassword(b.password || '', acc.passwordHash)) { sendJson(res, 401, { error: 'Wrong email or password.' }); return; }
    res.setHeader('Set-Cookie', makeSessionCookie(await newToken(acc.id)));
    sendJson(res, 200, { ok: true, account: { email: acc.email, name: acc.name, role: acc.role } });
    return;
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  // Start over — only a genuinely signed-in admin (never an open-mode session).
  if (action === 'reset' && method === 'POST') {
    const s = await getSession(req);
    if (!s || s.open || s.role !== 'admin') { sendJson(res, 403, { error: 'Only a signed-in admin can reset accounts.' }); return; }
    await resetAuth();
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  // First-run: create the head office + its first admin user.
  if (action === 'setup' && method === 'POST') {
    if (!authConfigured()) { sendJson(res, 400, { error: 'Accounts need the cloud store (Redis / Vercel KV) to be configured first.' }); return; }
    if ((await accountCount()) > 0) { sendJson(res, 403, { error: 'Already set up — please sign in.' }); return; }
    const b = await readJson();
    if (!b.email || String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Enter an email and a password of at least 8 characters.' }); return; }
    await saveOffice({ id: 'default', name: (b.office || 'Head office').slice(0, 80), createdAt: new Date().toISOString() });
    const acc = { id: 'u' + crypto.randomBytes(6).toString('hex'), tenant: 'default', role: 'admin', name: (b.name || 'Admin').slice(0, 80), email: email(b.email), passwordHash: hashPassword(b.password), createdAt: new Date().toISOString() };
    await saveAccount(acc);
    res.setHeader('Set-Cookie', makeSessionCookie(await newToken(acc.id)));
    sendJson(res, 200, { ok: true, account: { email: acc.email, name: acc.name, role: acc.role } });
    return;
  }

  // ── Admin-only beyond here ──
  const sess = await getSession(req);
  const isAdmin = sess && (sess.open || sess.role === 'admin');
  if (!isAdmin) { sendJson(res, 403, { error: 'Admins only.' }); return; }
  if (!authConfigured()) { sendJson(res, 400, { error: 'The cloud store is not configured.' }); return; }
  if ((await accountCount()) === 0) { sendJson(res, 400, { error: 'Create your account first.' }); return; }

  if (action === 'offices' && method === 'GET') {
    const offices = await getOffices();
    const accts = Object.values(await getAccounts());
    sendJson(res, 200, {
      offices: Object.values(offices).map((o) => ({ id: o.id, name: o.name, members: accts.filter((a) => a.tenant === o.id).length })),
      users: accts.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, tenant: a.tenant })),
    });
    return;
  }
  if (action === 'create-office' && method === 'POST') {
    const b = await readJson();
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) { sendJson(res, 400, { error: 'Give the office a name.' }); return; }
    const id = 'o' + crypto.randomBytes(6).toString('hex');
    await saveOffice({ id, name, createdAt: new Date().toISOString() });
    sendJson(res, 200, { ok: true, office: { id, name } });
    return;
  }
  if (action === 'delete-office' && method === 'POST') {
    const b = await readJson();
    if (b.id === 'default') { sendJson(res, 400, { error: 'The head office cannot be deleted.' }); return; }
    if ((await officeMemberCount(b.id)) > 0) { sendJson(res, 400, { error: 'Remove this office’s users before deleting it.' }); return; }
    await removeOffice(b.id || '');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'list' && method === 'GET') {
    const accts = await getAccounts();
    sendJson(res, 200, { users: Object.values(accts).map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role, tenant: a.tenant })) });
    return;
  }
  if (action === 'create' && method === 'POST') {
    const b = await readJson();
    if (!b.email || String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Email and an 8+ character password are required.' }); return; }
    if (await getAccountByEmail(b.email)) { sendJson(res, 409, { error: 'That email already has a login.' }); return; }
    const offices = await getOffices();
    const tenant = b.tenant && offices[b.tenant] ? b.tenant : 'default';
    const acc = { id: 'u' + crypto.randomBytes(6).toString('hex'), tenant, role: b.role === 'admin' ? 'admin' : 'office', name: (b.name || b.email).slice(0, 80), email: email(b.email), passwordHash: hashPassword(b.password), createdAt: new Date().toISOString() };
    await saveAccount(acc);
    sendJson(res, 200, { ok: true, account: { id: acc.id, name: acc.name, email: acc.email, role: acc.role, tenant: acc.tenant } });
    return;
  }
  if (action === 'setpw' && method === 'POST') {
    const b = await readJson();
    const acc = await getAccountById(b.id || '');
    if (!acc) { sendJson(res, 404, { error: 'No such user.' }); return; }
    if (String(b.password || '').length < 8) { sendJson(res, 400, { error: 'Password must be at least 8 characters.' }); return; }
    acc.passwordHash = hashPassword(b.password); await saveAccount(acc);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (action === 'delete' && method === 'POST') {
    const b = await readJson();
    if (b.id === sess.accountId) { sendJson(res, 400, { error: 'You cannot delete your own login.' }); return; }
    await deleteAccount(b.id || '');
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Unknown action.' });
}
