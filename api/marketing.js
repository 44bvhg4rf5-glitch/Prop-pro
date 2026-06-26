import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { requireAuth, getSession, tkey, getAccounts, authConfigured } from '../lib/auth.js';
import { llmConfigured, runLLM, extractJson } from '../lib/llm.js';
import { emailConfigured, sendEmail } from '../lib/email.js';

export const config = { maxDuration: 60 };

const REPORTS = 'marketing'; // list of daily reports (per tenant)
const today = () => new Date().toISOString().slice(0, 10);

// ── Build a real business snapshot to ground the strategist ──
function monthFunnel(outcomes, prints, month) {
  const inM = (d) => typeof d === 'string' && d.slice(0, 7) === month;
  const agreed = outcomes.filter((o) => inM(o.agreedDate));
  return {
    letters: (prints || {})[month] || 0,
    valuations: outcomes.filter((o) => inM(o.valuationDate)).length,
    instructions: outcomes.filter((o) => inM(o.instructionDate)).length,
    agreed: agreed.length,
    fees: agreed.reduce((s, o) => s + (+o.fee || 0), 0),
  };
}
async function snapshot(tenant) {
  const outcomes = (await getJSON(tkey(tenant, 'outcomes'), [])) || [];
  const prints = (await getJSON(tkey(tenant, 'prints'), {})) || {};
  const targets = (await getJSON(tkey(tenant, 'targets'), {})) || {};
  const leads = (await getJSON(tkey(tenant, 'leads'), [])) || [];
  const month = today().slice(0, 7);
  const m = monthFunnel(outcomes, prints, month);
  const allLetters = Object.values(prints).reduce((s, n) => s + (+n || 0), 0);
  const allAgreed = outcomes.filter((o) => o.agreedDate);
  return {
    month, target: targets[month] || null, thisMonth: m,
    allTime: {
      letters: allLetters,
      valuations: outcomes.filter((o) => o.valuationDate).length,
      instructions: outcomes.filter((o) => o.instructionDate).length,
      agreed: allAgreed.length,
      fees: allAgreed.reduce((s, o) => s + (+o.fee || 0), 0),
    },
    newLeads: leads.filter((l) => l && l.status === 'new').length,
    totalLeads: leads.length,
  };
}

const SYSTEM = `You are the Marketing Director of a UK estate agency that prospects the Harrow (HA0–HA9) area, primarily by sending physical instruction-winning letters to homeowners whose properties are newly listed, plus a public free-valuation landing page. You are world-class at estate-agency growth: direct-mail response, local farming, instruction conversion, brand, referrals, and seasonal timing.

You think rigorously and commercially. Every recommendation must be: specific to THIS agency and the Harrow market, actionable within days, measurable, and compliant with UK GDPR/PECR and estate-agency rules (postal contact to owners is fine; no cold email/SMS without consent; screen against MPS and the do-not-mail list). No generic filler — if you cannot be specific, say what to test. Ground everything in the agency's actual numbers when given.`;

function userPrompt(snap, recentHeadlines) {
  return `Today is ${today()}. Produce today's marketing strategy report for the agency.

AGENCY NUMBERS (real):
- This month (${snap.month}): ${snap.thisMonth.letters} letters printed, ${snap.thisMonth.valuations} valuations, ${snap.thisMonth.instructions} instructions, ${snap.thisMonth.agreed} agreed, £${snap.thisMonth.fees} agreed fees.
- Month target: ${snap.target ? `${snap.target.letters} letters, ${snap.target.valuations} valuations, ${snap.target.instructions} instructions, ${snap.target.agreed} agreed, £${snap.target.fees} fees` : 'not set'}.
- All-time: ${snap.allTime.letters} letters → ${snap.allTime.valuations} valuations → ${snap.allTime.instructions} instructions → £${snap.allTime.fees} fees.
- Valuation-page leads: ${snap.totalLeads} total, ${snap.newLeads} new/unactioned.
${recentHeadlines.length ? `\nDo NOT repeat these recent report headlines — bring fresh angles:\n- ${recentHeadlines.join('\n- ')}` : ''}

If useful, use web search for current UK/London/Harrow housing-market conditions, seasonality, mortgage-rate sentiment, and what competing agents are doing — but keep it grounded and practical.

Return ONLY a JSON object (no prose outside it) with EXACTLY this shape:
{
  "headline": "one punchy sentence — the single most important focus today",
  "summary": "2-3 sentences a busy agency owner reads first",
  "performanceRead": "what the numbers say is working and not working, and the one number to move",
  "priorities": [ { "title": "...", "why": "impact in plain terms", "how": "concrete steps to do this week", "impact": "high|medium|low", "effort": "low|medium|high", "expected": "the measurable outcome" } ],
  "campaignIdeas": [ { "title": "...", "angle": "the hook/message", "channel": "letter|landing page|referral|local|other" } ],
  "marketIntel": [ "specific current-market observation with a source if searched" ],
  "experiment": { "idea": "one testable thing", "metric": "what to measure", "target": "success threshold" },
  "watchOuts": [ "risk or compliance note" ],
  "metricToWatch": "the single KPI to watch this week"
}
Give 3-5 priorities (ranked, best first), 2-4 campaign ideas, 2-4 market-intel points, 1-3 watch-outs. Be concrete and excellent.`;
}

async function generate(tenant) {
  if (!llmConfigured()) return { ok: false, error: 'AI key not configured' };
  const snap = await snapshot(tenant);
  const list = (await getJSON(tkey(tenant, REPORTS), [])) || [];
  const recent = list.slice(0, 5).map((r) => r.headline).filter(Boolean);

  const r = await runLLM({
    system: SYSTEM,
    user: userPrompt(snap, recent),
    maxTokens: 4000,
    search: true,
    timeoutMs: 55000,
  });

  if (r.error) return { ok: false, error: r.error === 'no_key' ? 'AI key not configured' : 'AI error: ' + r.error };
  const parsed = extractJson(r.text);
  if (!parsed || !parsed.headline) return { ok: false, error: 'Could not parse a report' };

  const report = {
    id: 'm' + Date.now().toString(36),
    date: today(),
    createdAt: new Date().toISOString(),
    snapshot: snap,
    ...parsed,
  };
  // Upsert by date (one report per day; re-runs replace it).
  const next = [report, ...list.filter((x) => x.date !== report.date)].slice(0, 60);
  await setJSON(tkey(tenant, REPORTS), next);
  return { ok: true, report };
}

// Email the report to the tenant's admins (when email is configured + opted in).
async function emailReport(tenant, report) {
  if (!emailConfigured() || !authConfigured()) return;
  const settings = (await getJSON(tkey(tenant, 'marketing:settings'), { email: true })) || { email: true };
  if (!settings.email) return;
  const admins = Object.values(await getAccounts()).filter((a) => a.tenant === tenant && a.role === 'admin' && a.email);
  if (!admins.length) return;
  const pr = (report.priorities || []).slice(0, 3).map((p, i) => `<p><strong>${i + 1}. ${esc(p.title)}</strong><br>${esc(p.how || '')}</p>`).join('');
  await sendEmail({
    to: admins.map((a) => a.email),
    subject: 'Your marketing report — ' + report.date,
    text: report.headline + '\n\n' + report.summary,
    html: `<h2 style="font-family:Georgia,serif">${esc(report.headline)}</h2><p>${esc(report.summary)}</p><h3>Top priorities</h3>${pr}<p style="color:#6b7280;font-size:13px">Open PropMail Pro → Marketing for the full report.</p>`,
  });
}
const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const method = req.method || 'GET';
  // When CRON_SECRET is set, require Vercel's signed bearer (can't be spoofed);
  // otherwise fall back to the x-vercel-cron header (+ a 6h throttle below).
  const isCron = process.env.CRON_SECRET
    ? req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET
    : !!req.headers['x-vercel-cron'];

  // Daily automated run (Vercel cron) — generate for the head office.
  if (method === 'GET' && (u.searchParams.get('cron') === '1' || isCron)) {
    if (!isCron) { sendJson(res, 401, { error: 'Not authorised.' }); return; }
    if (!storeConfigured()) { sendJson(res, 200, { ok: false, error: 'no store' }); return; }
    // Throttle: at most one auto-run per 6h.
    const last = await getJSON(tkey('default', 'marketing:lastcron'), 0);
    if (last && Date.now() - last < 6 * 3600 * 1000) { sendJson(res, 200, { ok: true, skipped: 'recent' }); return; }
    await setJSON(tkey('default', 'marketing:lastcron'), Date.now());
    const out = await generate('default');
    if (out.ok) { try { await emailReport('default', out.report); } catch { /* ignore */ } }
    sendJson(res, 200, out);
    return;
  }

  // Everything else is internal + signed in.
  if (!guardOrigin(req, res)) return;
  const sess = await requireAuth(req, res); if (!sess) return;
  const tenant = sess.tenant;

  if (method === 'GET') {
    const reports = (await getJSON(tkey(tenant, REPORTS), [])) || [];
    const settings = (await getJSON(tkey(tenant, 'marketing:settings'), { email: true })) || { email: true };
    sendJson(res, 200, { configured: llmConfigured(), emailConfigured: emailConfigured(), settings, count: reports.length, reports });
    return;
  }

  if (method === 'POST') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
    if (body.action === 'settings') {
      const settings = { email: !!body.email };
      await setJSON(tkey(tenant, 'marketing:settings'), settings);
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    if (body.action === 'generate') {
      if (sess.role !== 'admin') { sendJson(res, 403, { error: 'Admins only.' }); return; }
      const out = await generate(tenant);
      sendJson(res, out.ok ? 200 : 502, out);
      return;
    }
    sendJson(res, 400, { error: 'Unknown action.' });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
