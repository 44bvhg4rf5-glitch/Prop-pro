// Internal AI "agent" runner for the GitHub Actions roles. Each scheduled role
// runs this with a different AGENT_ROLE, produces a Markdown report, and the
// workflow posts it to you as a GitHub Issue. Uses the same free providers the
// app already uses (Groq for the AI, Tavily for web search) — no extra cost.
//
//   AGENT_ROLE=security  → reviews the backend code for security issues
//   AGENT_ROLE=research  → researches a topic (AGENT_TOPIC) and briefs you
import fs from 'fs';
import { runLLM } from '../lib/llm.js';
import { webSearch, searchConfigured } from '../lib/search.js';

const ROLE = (process.env.AGENT_ROLE || 'security').toLowerCase();
const TOPIC = (process.env.AGENT_TOPIC || '').trim();
const today = new Date().toISOString().slice(0, 10);

const readCapped = (p, cap) => { try { return fs.readFileSync(p, 'utf8').slice(0, cap); } catch { return ''; } };
const listJs = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => dir + '/' + f); } catch { return []; } };

async function securityReport() {
  // Review the security-relevant surface: the serverless API + shared libs + server.
  const paths = [...listJs('api'), ...listJs('lib'), 'server.js'].filter(Boolean);
  let corpus = '';
  for (const p of paths) {
    const code = readCapped(p, 4500);
    if (code) corpus += `\n\n===== FILE: ${p} =====\n${code}`;
    if (corpus.length > 38000) break; // keep the request under the model's payload limit (was hitting HTTP 413)
  }
  const system = 'You are a senior application-security engineer reviewing the BACKEND of a Node.js + vanilla-JS web app (an estate-agent tool on Vercel). Report only concrete, real issues — never invent problems. Consider: injection, XSS / output encoding, authentication & session handling, API-key / secret exposure, SSRF via server-side fetch, CORS / origin checks, missing input validation, rate-limiting & abuse, and UK data-protection (GDPR) concerns. Be specific about the file and the exact risk, and give a practical fix.';
  const user = `Review this backend source and write ONLY a Markdown report with exactly these sections — do NOT repeat, quote or paste any of the source code back; output only your analysis:\n\n## Summary\n(2-4 lines on overall security posture)\n\n## Findings\n(For each: **[High/Medium/Low]** \`file\` — the risk — the fix. Verify each issue against the code before reporting it; if you find nothing real, say so plainly.)\n\n## Already done well\n(Good security practices visible in the code.)\n\nSOURCE (for your analysis only — never echo it back):\n${corpus}`;
  const r = await runLLM({ system, user, maxTokens: 2200 });
  if (r.error) return `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)`;
  return `${stripPreamble(r.text)}\n\n_Reviewed by: ${r.provider || 'AI'}_`;
}
// Models sometimes echo the input or add a preamble before the report. Cut
// everything before the first Markdown heading so the issue is always clean.
function stripPreamble(text) {
  const t = String(text || '');
  const m = t.match(/^##\s+\w/m);
  return m ? t.slice(m.index).trim() : t.trim();
}

async function researchReport() {
  const topic = TOPIC || 'Current UK estate-agent lead generation, direct-mail / letter marketing tactics, and Rightmove / property-data trends for winning instructions';
  let web = { results: [], answer: '' };
  if (searchConfigured()) web = await webSearch(topic, { maxResults: 6 }).catch(() => ({ results: [], answer: '' }));
  const sources = web.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join('\n\n');
  const system = 'You are a research analyst briefing the owner of an estate-agent intelligence platform. Produce a concise, practical, honest briefing. When you use a live source, cite it like [1]. Separate fact from your own inference. No filler.';
  const user = `RESEARCH TOPIC:\n${topic}\n\n${sources ? 'LIVE WEB RESULTS:\n' + sources : '(No live web search configured — answer from general knowledge and say so.)'}\n\nWrite a Markdown briefing:\n## Key takeaways\n## What this means for PropMail Pro\n## Recommended next actions\n## Sources`;
  const r = await runLLM({ system, user, maxTokens: 2200, search: true });
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${stripPreamble(r.text)}\n\n_Researched by: ${r.provider || 'AI'}${searchConfigured() ? ' + live web search' : ''}_`;
}

// Competitor watch — monitors the main rival (Spectre) and UK proptech for new
// features/pricing/news, and flags what PropMail Pro should respond to.
async function competitorReport() {
  const topic = TOPIC || 'Spectre (spectre.uk.com) estate-agent prospecting software new features, pricing and announcements; and other UK estate-agent prospecting / direct-mail / propensity-to-sell tools';
  let web = { results: [], answer: '' };
  if (searchConfigured()) web = await webSearch(topic, { maxResults: 7 }).catch(() => ({ results: [], answer: '' }));
  const sources = web.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join('\n\n');
  const system = 'You are a competitive-intelligence analyst for PropMail Pro, an estate-agent prospecting tool whose main rival is Spectre. Brief the owner on what competitors are doing and what PropMail Pro should do about it. Cite live sources like [1]. Be specific and honest; flag only real, evidenced changes.';
  const user = `Watch the competition (mainly Spectre) using these results.\n\n${sources ? 'LIVE WEB RESULTS:\n' + sources : '(No live web search configured — say so.)'}\n\nWrite a Markdown briefing:\n## What competitors are doing\n## Where PropMail Pro is ahead / behind\n## Recommended responses (what to build or change)\n## Sources`;
  const r = await runLLM({ system, user, maxTokens: 2200, search: true });
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${stripPreamble(r.text)}\n\n_Watched by: ${r.provider || 'AI'}${searchConfigured() ? ' + live web search' : ''}_`;
}

// Uptime & data-source health — pings the live site + key APIs and opens an
// issue only when something is down (or when OS Places finally goes live).
async function healthReport() {
  const base = process.env.SITE_URL || 'https://prop-pro-theta.vercel.app';
  const get = async (path) => {
    try { const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) }); let j = null; try { j = await r.json(); } catch {} return { ok: r.ok, status: r.status, j }; }
    catch (e) { return { ok: false, status: 0, err: e.message }; }
  };
  const checks = [];
  let r;
  r = await get('/'); checks.push({ name: 'Website', ok: r.ok, status: r.status });
  r = await get('/api/config'); checks.push({ name: 'Config API', ok: !!(r.ok && r.j && r.j.epcEnabled), status: r.status });
  r = await get('/api/listings?district=HA1&channel=sale&pages=1'); checks.push({ name: 'Live property search', ok: !!(r.ok && r.j && Array.isArray(r.j.properties) && r.j.properties.length), status: r.status, detail: (r.j && r.j.properties) ? r.j.properties.length + ' listings' : '' });
  let osStatus = '?'; const d = await get('/api/datasources?postcode=HA1%203WU'); if (d.j && d.j.sources && d.j.sources.os_places_postcode) osStatus = d.j.sources.os_places_postcode.status;
  const osLive = osStatus === 200;
  const fails = checks.filter((c) => !c.ok);
  const problem = fails.length > 0 || osLive; // alert on a failure, or on the good news that OS is live
  const lines = checks.map((c) => `- ${c.ok ? '✅' : '❌'} **${c.name}** — HTTP ${c.status}${c.detail ? ' · ' + c.detail : ''}`).join('\n');
  const osLine = osLive
    ? '- 🎉 **OS Places is LIVE (HTTP 200)** — Royal Mail flat-level addresses are now available. Ask Claude to wire it into the resolver!'
    : `- ⏳ OS Places — HTTP ${osStatus} (still capped / on the free trial; awaiting OS Premium)`;
  const body = `## Status — ${fails.length ? '❌ ATTENTION NEEDED' : '✅ all healthy'}\n\n${lines}\n\n### Data sources\n${osLine}\n\n_Checked: ${base}_`;
  return { body, problem };
}

// Letter-copy writer — fresh, ready-to-post prospecting letter templates.
async function contentReport() {
  const brief = TOPIC || 'prospecting letters for a Harrow (HA) estate agent to win instructions';
  const system = 'You are a senior UK estate-agency direct-mail copywriter. Write warm, professional, compliant letter copy that wins instructions — no clichés, no false claims, GDPR-friendly, concise, ready to post.';
  const user = `Write THREE short ready-to-send prospecting letter templates (each ~120-160 words) for: ${brief}. Vary the angle: (1) a neighbour just sold, (2) low stock / high demand, (3) free valuation. Use placeholders like [Owner name], [Street], [Agent name], [Agency], [Phone]. Output ONLY Markdown:\n## Letter 1 — Neighbour just sold\n## Letter 2 — Low stock, high demand\n## Letter 3 — Free valuation offer`;
  const r = await runLLM({ system, user, maxTokens: 1600 });
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${stripPreamble(r.text)}\n\n_Written by: ${r.provider || 'AI'}_`;
}

const ROLES = {
  research: { fn: researchReport, dir: 'research', title: '🔎 Research' },
  competitor: { fn: competitorReport, dir: 'competitor', title: '🛰️ Competitor watch' },
  content: { fn: contentReport, dir: 'content', title: '✍️ Letter copy' },
  health: { fn: healthReport, dir: 'health', title: '🩺 Health check' },
  security: { fn: securityReport, dir: 'security', title: '🔒 Security' },
};
const role = ROLES[ROLE] || ROLES.security;
const out = await role.fn();
const body = typeof out === 'string' ? out : out.body;
const problem = typeof out === 'object' && out.problem;
const dir = `reports/${role.dir}`;
fs.mkdirSync(dir, { recursive: true });
const file = `${dir}/${today}.md`;
const title = `${role.title} report — ${today}`;
fs.writeFileSync(file, `# ${title}\n\n${body}\n`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `report_file=${file}\nreport_title=${title}\nhas_problem=${problem ? 'true' : 'false'}\n`);
console.log(`Wrote ${file}`);
