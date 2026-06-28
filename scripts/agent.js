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
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${r.text}\n\n_Reviewed by: ${r.provider || 'AI'}_`;
}

async function researchReport() {
  const topic = TOPIC || 'Current UK estate-agent lead generation, direct-mail / letter marketing tactics, and Rightmove / property-data trends for winning instructions';
  let web = { results: [], answer: '' };
  if (searchConfigured()) web = await webSearch(topic, { maxResults: 6 }).catch(() => ({ results: [], answer: '' }));
  const sources = web.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join('\n\n');
  const system = 'You are a research analyst briefing the owner of an estate-agent intelligence platform. Produce a concise, practical, honest briefing. When you use a live source, cite it like [1]. Separate fact from your own inference. No filler.';
  const user = `RESEARCH TOPIC:\n${topic}\n\n${sources ? 'LIVE WEB RESULTS:\n' + sources : '(No live web search configured — answer from general knowledge and say so.)'}\n\nWrite a Markdown briefing:\n## Key takeaways\n## What this means for PropMail Pro\n## Recommended next actions\n## Sources`;
  const r = await runLLM({ system, user, maxTokens: 2200, search: true });
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${r.text}\n\n_Researched by: ${r.provider || 'AI'}${searchConfigured() ? ' + live web search' : ''}_`;
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
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${r.text}\n\n_Watched by: ${r.provider || 'AI'}${searchConfigured() ? ' + live web search' : ''}_`;
}

const ROLES = {
  research: { fn: researchReport, dir: 'research', title: '🔎 Research' },
  competitor: { fn: competitorReport, dir: 'competitor', title: '🛰️ Competitor watch' },
  security: { fn: securityReport, dir: 'security', title: '🔒 Security' },
};
const role = ROLES[ROLE] || ROLES.security;
const body = await role.fn();
const dir = `reports/${role.dir}`;
fs.mkdirSync(dir, { recursive: true });
const file = `${dir}/${today}.md`;
const title = `${role.title} report — ${today}`;
fs.writeFileSync(file, `# ${title}\n\n${body}\n`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `report_file=${file}\nreport_title=${title}\n`);
console.log(`Wrote ${file}`);
