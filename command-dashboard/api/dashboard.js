import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { runLLM, llmConfigured, availableProviders } from '../lib/llm.js';
import { getJSON, setJSON, unshiftList, storeConfigured } from '../lib/store.js';
import { githubConfigured, activityFeed, openIssuesAsTasks, watchedRepos } from '../lib/github.js';
import { emailConfigured, sendEmail } from '../lib/email.js';

// ── Storage keys ──
const K_TASKS = 'dash:tasks';
const K_UPDATES = 'dash:updates';                 // shared log your agents can post to
const summaryKey = (d) => `dash:summary:${d}`;

// In-memory fallback so the dashboard still works (within one running process)
// when no KV/Redis is configured. On serverless this won't persist between
// invocations — set KV_REST_API_* / REDIS_URL for durable, cross-device state.
const mem = { tasks: [], updates: [], summaries: {} };
async function readState(key, fallback) {
  if (storeConfigured()) return getJSON(key, fallback);
  if (key === K_TASKS) return mem.tasks;
  if (key === K_UPDATES) return mem.updates;
  if (key.startsWith('dash:summary:')) return mem.summaries[key] || fallback;
  return fallback;
}
async function writeState(key, val) {
  if (storeConfigured()) return setJSON(key, val);
  if (key === K_TASKS) mem.tasks = val;
  else if (key === K_UPDATES) mem.updates = val;
  else if (key.startsWith('dash:summary:')) mem.summaries[key] = val;
}

const today = () => new Date().toISOString().slice(0, 10);
const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw;
  if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

// Generate the morning brief from everything the dashboard knows: your open
// tasks, recent agent/GitHub activity, and open issues. Cached once per day so
// opening the app repeatedly is instant (pass ?refresh=1 to regenerate).
async function buildSummary({ refresh }) {
  const day = today();
  if (!refresh) {
    const cached = await readState(summaryKey(day), null);
    if (cached && cached.text) return { ...cached, cached: true };
  }
  const tasks = (await readState(K_TASKS, [])) || [];
  const open = tasks.filter((t) => !t.done);
  const [feed, issues] = await Promise.all([
    githubConfigured() ? activityFeed({ limit: 25 }) : Promise.resolve({ items: [] }),
    githubConfigured() ? openIssuesAsTasks({ limit: 20 }) : Promise.resolve([]),
  ]);

  if (!llmConfigured()) {
    // No AI key — still give a useful plain brief instead of failing.
    const lines = [];
    lines.push(`Good morning. Here's your ${day} brief.`);
    if (open.length) lines.push(`\nOpen tasks (${open.length}):\n` + open.map((t) => `• ${t.text}`).join('\n'));
    if (issues.length) lines.push(`\nOpen GitHub issues:\n` + issues.slice(0, 8).map((i) => `• ${i.repo}#${i.number} ${i.title}`).join('\n'));
    if ((feed.items || []).length) lines.push(`\nLatest agent activity:\n` + feed.items.slice(0, 6).map((x) => `• [${x.type}] ${x.repo}: ${x.title}`).join('\n'));
    if (!open.length && !issues.length) lines.push('\nNothing tracked yet — add a task or connect GitHub to populate this.');
    const out = { text: lines.join('\n'), ts: new Date().toISOString(), provider: 'none', day };
    await writeState(summaryKey(day), out);
    return out;
  }

  const context = {
    date: day,
    openTasks: open.map((t) => t.text),
    openGithubIssues: issues.map((i) => `${i.repo}#${i.number} ${i.title}`),
    recentActivity: (feed.items || []).slice(0, 15).map((x) => `[${x.type}] ${x.repo}: ${x.title}`),
  };
  const system = 'You are the user\'s personal morning chief-of-staff. Write a short, motivating daily brief for a busy founder who reads it on their phone. Use this exact structure with these headers: "☀️ Good morning" (one warm line), "🎯 Top 3 today" (the 3 highest-leverage things to do, each one line), "📋 Also on the list" (remaining open items, terse bullets), "🤖 Agent activity" (one line summarising what their coding agents shipped recently, or "Quiet overnight." if none). Be concise — no preamble, no sign-off. Plain text with the emoji headers, not markdown headings.';
  const r = await runLLM({
    system,
    messages: [{ role: 'user', content: 'Here is my data as JSON. Write today\'s brief.\n\n' + JSON.stringify(context, null, 2) }],
    maxTokens: 900,
  });
  if (r.error) return { error: r.error };
  const out = { text: r.text, ts: new Date().toISOString(), provider: r.provider || 'ai', day };
  await writeState(summaryKey(day), out);
  return out;
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'status';
  const method = (req.method || 'GET').toUpperCase();

  try {
    // ── Daily 9am cron: regenerate the brief and email it (Vercel Cron) ──
    // Wired in vercel.json. Needs RESEND_API_KEY + DASHBOARD_EMAIL (or EMAIL_TO).
    if (url.searchParams.get('cron')) {
      const r = await buildSummary({ refresh: true });
      const to = process.env.DASHBOARD_EMAIL || process.env.EMAIL_TO || '';
      let emailed = false;
      if (!r.error && emailConfigured() && to) {
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;white-space:pre-wrap">${(r.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
        const sent = await sendEmail({ to, subject: `☀️ Your morning brief — ${today()}`, html, text: r.text || '' });
        emailed = !!sent.sent;
      }
      sendJson(res, 200, { ok: !r.error, emailed, to: to ? to.replace(/(.{2}).*(@.*)/, '$1***$2') : null, error: r.error || null });
      return;
    }

    // ── What's wired up (drives the dashboard's setup hints) ──
    if (action === 'status') {
      sendJson(res, 200, {
        ai: { enabled: llmConfigured(), providers: availableProviders() },
        github: { enabled: githubConfigured(), repos: watchedRepos() },
        store: { enabled: storeConfigured() },
        email: { enabled: emailConfigured() },
        date: today(),
      });
      return;
    }

    // ── Morning brief ──
    if (action === 'summary') {
      const refresh = url.searchParams.get('refresh') === '1';
      const r = await buildSummary({ refresh });
      if (r.error) { sendJson(res, 502, { error: { message: r.error } }); return; }
      sendJson(res, 200, r);
      return;
    }

    // ── GitHub activity feed ("what my agents did") ──
    if (action === 'feed') {
      const r = await activityFeed({ limit: 40 });
      sendJson(res, 200, r);
      return;
    }

    // ── Tasks (durable to-do list) ──
    if (action === 'tasks') {
      if (method === 'GET') {
        const tasks = (await readState(K_TASKS, [])) || [];
        sendJson(res, 200, { tasks });
        return;
      }
      const body = await getBody(req);
      let tasks = (await readState(K_TASKS, [])) || [];
      const op = body.op || 'add';
      if (op === 'add' && body.text && body.text.trim()) {
        tasks.unshift({ id: id(), text: String(body.text).trim().slice(0, 300), done: false, created: new Date().toISOString() });
      } else if (op === 'toggle' && body.id) {
        tasks = tasks.map((t) => (t.id === body.id ? { ...t, done: !t.done } : t));
      } else if (op === 'delete' && body.id) {
        tasks = tasks.filter((t) => t.id !== body.id);
      } else if (op === 'clearDone') {
        tasks = tasks.filter((t) => !t.done);
      }
      await writeState(K_TASKS, tasks);
      sendJson(res, 200, { tasks });
      return;
    }

    // ── Shared agent updates log ──
    // GET reads the timeline. POST appends an update — your Claude Code agents
    // can curl this endpoint to "report in" (see DASHBOARD.md).
    if (action === 'updates') {
      if (method === 'GET') {
        const updates = (await readState(K_UPDATES, [])) || [];
        sendJson(res, 200, { updates });
        return;
      }
      const body = await getBody(req);
      const entry = {
        id: id(),
        source: String(body.source || 'agent').slice(0, 60),
        text: String(body.text || '').slice(0, 1000),
        ts: new Date().toISOString(),
      };
      if (!entry.text) { sendJson(res, 400, { error: { message: 'text required' } }); return; }
      let updates;
      if (storeConfigured()) updates = await unshiftList(K_UPDATES, entry, 200);
      else { mem.updates.unshift(entry); if (mem.updates.length > 200) mem.updates.length = 200; updates = mem.updates; }
      sendJson(res, 200, { ok: true, entry, updates });
      return;
    }

    sendJson(res, 404, { error: { message: 'Unknown action: ' + action } });
  } catch (e) {
    sendJson(res, 500, { error: { message: e.message || 'dashboard error' } });
  }
}
