// Internal AI "agent" runner for the GitHub Actions roles. Each scheduled role
// runs this with a different AGENT_ROLE, produces a Markdown report, and the
// workflow posts it to you as a GitHub Issue. Uses the same free providers the
// app already uses (Groq for the AI, Tavily for web search) — no extra cost.
//
//   AGENT_ROLE=security  → reviews the backend code for security issues
//   AGENT_ROLE=research  → researches a topic (AGENT_TOPIC) and briefs you
import fs from 'fs';
import { runLLM, extractJson } from '../lib/llm.js';
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
// Keep web searches in our world. A vague topic like "Harrow market" can return
// the wrong "Harrow" (e.g. a US pharma firm) — anchor it to UK property unless
// it already clearly mentions property/estate-agency.
function anchorProperty(topic) {
  const t = String(topic || '').trim();
  return /\b(estate agent|estate agency|property|properties|propert|housing|house price|rightmove|zoopla|instruction|conveyanc|letting|landlord|mortgage)\b/i.test(t)
    ? t : `${t} — UK residential property / estate-agent market`;
}

async function researchReport() {
  const topic = anchorProperty(TOPIC || 'Current UK estate-agent lead generation, direct-mail / letter marketing tactics, and Rightmove / property-data trends for winning instructions');
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
  const topic = TOPIC || 'new features, pricing and announcements; and other UK estate-agent prospecting / direct-mail / propensity-to-sell tools';
  // "Spectre" is a common word (a game hero, a CPU bug, a Rolls-Royce). Always
  // pin the search to the real rival — the estate-agent tool at spectre.uk.com.
  const query = `spectre.uk.com UK estate-agent prospecting software — ${topic}`;
  let web = { results: [], answer: '' };
  if (searchConfigured()) web = await webSearch(query, { maxResults: 7 }).catch(() => ({ results: [], answer: '' }));
  const sources = web.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join('\n\n');
  const system = "You are a competitive-intelligence analyst for PropMail Pro, a UK estate-agent prospecting tool whose main rival is Spectre — specifically the estate-agency software at spectre.uk.com. IGNORE anything about other things called 'Spectre' (the Dota 2 hero, the Spectre/Meltdown CPU vulnerability, the Rolls-Royce Spectre car, James Bond, etc.) — those are NOT the competitor. If a source is not about UK estate-agent / property software, do not use it; if you have no relevant sources, say so plainly rather than reporting irrelevant ones. Brief the owner on what real estate-agent competitors are doing and what PropMail Pro should do about it. Cite live sources like [1]. Flag only real, evidenced changes.";
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

// A plain-English manifest of the tools currently in place. We brief R&D from
// this (not raw source) so the report stays useful and never echoes code back.
const TOOL_MANIFEST = `PropMail Pro — an estate-agent address-intelligence tool for the UK (Harrow / HA focus, now UK-wide). The live tools:
- Live property finder: pulls current Rightmove listings for a postcode district (api/listings).
- Address resolution engine (api/resolve, api/resolve-batch): turns a Rightmove listing into a real postal address using FREE public data — the EPC register (energy certificates, incl. floor area + certificate date), HM Land Registry Price Paid, postcodes.io reverse-geocode, and OpenStreetMap (Nominatim + Overpass). Key trick: "EPC-freshness" — a property gets a fresh certificate when it's marketed, so the building with the newest EPCs on a street is usually the one being let, which helps pick the right building and pin a flat. Returns a confidence level: exact / building / postcode.
- Current ceiling: ~44% correct building, ~25% deliverable (exact unit). Flat-level letterbox data (which flat in a block) needs Royal Mail PAF via OS Places, which is paid / currently blocked on a free-trial cap.
- Seller Radar (api/propensity): scores propensity-to-sell from years-owned (Land Registry) against the typical 7-13 year move cycle, and flags anniversaries.
- AI Intel / owner research (api/owner): postal-only, public-records-only owner research (Companies House freeholder/SPV lookup, PlanIt planning) — strictly UK GDPR/PECR compliant.
- Web address finder (api/webaddr): Tavily web search to pull addresses for the Success Letters panel.
- Free-data audit (api/datasources): probes candidate free sources (OS Places, OSM Overpass, FHRS, Companies House) to see what returns usable addresses.
- LLM layer (lib/llm.js): provider routing across Groq (fast/cheap) + Gemini (web search), with fallback.
- 11 UI panels incl. Print Queue (letter queue with real addresses + Rightmove links), Templates, Auto Flow, Live Bot, Investor Board.
Goal that matters most to the owner/investor: >40% full+exact deliverable addresses, zero wrong addresses, no bare street names, and "no work" for the (non-technical) user.`;

// Head of R&D — proposes concrete, costed research-and-development improvements
// to the tools above, grounded in the manifest + live web search.
async function rndReport() {
  let topic = TOPIC || 'new free UK property-address data sources and techniques to raise the exact-address win-rate — EPC register, HM Land Registry, OpenStreetMap, OS Places PAF, street-view analysis, propensity-to-sell signals';
  topic = anchorProperty(topic);
  let web = { results: [] };
  if (searchConfigured()) web = await webSearch(topic, { maxResults: 6 }).catch(() => ({ results: [] }));
  const sources = web.results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${x.content}`).join('\n\n');
  const system = 'You are the Head of R&D for PropMail Pro, a UK estate-agent address-intelligence tool. Propose concrete, realistic research-and-development improvements. Separate quick wins from bigger bets, and always weigh impact against effort and cost — the product relies on FREE data wherever possible. Cite live sources like [1]. Never invent capabilities the product does not have. Do NOT output any source code — write prose and tables only.';
  const user = `THE TOOLS CURRENTLY IN PLACE:\n${TOOL_MANIFEST}\n\nR&D FOCUS: ${topic}\n\n${sources ? 'RELEVANT WEB FINDINGS:\n' + sources : '(No live web search configured — say so.)'}\n\nWrite a Markdown R&D brief (prose/tables only — no code):\n## Where we are today\n## What's working vs the limits we're hitting\n## R&D ideas (ranked best first)\n(For each: **idea** — impact (High/Med/Low) · effort · cost · how to prototype it.)\n## Recommended next experiment\n## Sources`;
  const r = await runLLM({ system, user, maxTokens: 2600, search: true });
  return r.error ? `**The agent could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${stripPreamble(r.text)}\n\n_R&D by: ${r.provider || 'AI'}${searchConfigured() ? ' + live web search' : ''}_`;
}

// The team the Manager can delegate to (every other role, plus a one-line job spec).
const ROSTER = [
  { role: 'research', does: 'researches a topic and briefs you — market, tactics, trends', topic: true },
  { role: 'competitor', does: 'watches Spectre and UK proptech for new features / pricing', topic: true },
  { role: 'content', does: 'writes ready-to-post prospecting letter templates', topic: true },
  { role: 'rnd', does: 'reviews the live tools and proposes R&D improvements', topic: true },
  { role: 'health', does: 'pings the live site + APIs and reports any outage', topic: false },
  { role: 'security', does: 'reviews the backend code for security issues', topic: false },
];

// Manager / Managing Director — sits above the team. With a task it plans and
// delegates for the owner. With NO task (the weekly schedule) it self-directs:
// reviews the situation and decides what the team should work on this week.
async function managerReport() {
  const task = (process.env.AGENT_TASK || TOPIC || '').trim();
  const weekly = !task;                                   // no task → autonomous weekly review
  const context = (process.env.AGENT_CONTEXT || '').slice(0, 4000);
  const roster = ROSTER.map((a) => `- ${a.role}: ${a.does}`).join('\n');
  const cap = weekly ? 5 : 3;
  const system = weekly
    ? 'You are the Managing Director of PropMail Pro\'s autonomous AI team. Each week you proactively review the business and decide what the team should work on — without being asked. Be decisive, concise and practical. You plan and delegate to your specialist agents (you do not do their work yourself). Flag clearly anything only a human must do.'
    : "You are the Manager agent for PropMail Pro — you turn the owner's request into an actionable plan and delegate to the right agents. Be concise, practical and honest. Assign AT MOST 3 agents, only the best-suited. You plan and delegate; flag anything only a human developer can do.";
  const user = weekly
    ? `WEEKLY PLANNING MEETING — ${today}. Set this week's priorities for PropMail Pro (a UK estate-agent address-intelligence tool) and delegate the work to your team.\n\n${context ? 'RECENT ACTIVITY / SITUATION:\n' + context + '\n\n' : ''}YOUR TEAM (delegate ONLY to these):\n${roster}\n\nWrite a Markdown plan:\n## This week's focus\n(2-4 priorities, informed by the situation above)\n## Delegation\n(table: | Agent | What to focus on this week | — choose the agents that matter this week, up to 5)\n## Watch / risks\n(what to keep an eye on; anything only a human must do)\n\nThen, on the VERY LAST line, output ONLY a fenced JSON object of who to launch now, e.g.\n\`\`\`json\n{"dispatch":[{"agent":"research","topic":"..."}]}\n\`\`\``
    : `THE OWNER'S REQUEST:\n${task}\n\nYOUR TEAM (delegate ONLY to these):\n${roster}\n\nWrite a Markdown plan:\n## Goal\n## Plan\n## Delegation\n(table: | Agent | What to focus on | — AT MOST 3 best-suited)\n## What you'll receive\n\nThen, on the VERY LAST line, output ONLY a fenced JSON object naming who to launch now (AT MOST 3), e.g.\n\`\`\`json\n{"dispatch":[{"agent":"research","topic":"..."}]}\n\`\`\``;
  const r = await runLLM({ system, user, maxTokens: 2200 });
  if (r.error) return { body: `**The manager could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)`, problem: false, dispatch: [] };
  const parsed = extractJson(r.text) || {};
  const valid = new Set(ROSTER.map((a) => a.role));
  const seen = new Set();
  const dispatch = (Array.isArray(parsed.dispatch) ? parsed.dispatch : [])
    .map((d) => ({ agent: String((d && d.agent) || '').toLowerCase().trim(), topic: String((d && d.topic) || '').slice(0, 300) }))
    .filter((d) => valid.has(d.agent) && !seen.has(d.agent) && seen.add(d.agent))
    .slice(0, cap);
  let body = stripPreamble(r.text).replace(/```json[\s\S]*?```\s*$/, '').trim();
  const queued = dispatch.length
    ? `\n\n---\n🚀 **Launching now:** ${dispatch.map((d) => '`' + d.agent + '`').join(', ')} — each will reply in this thread shortly.`
    : '\n\n---\n_No agent was auto-launched._';
  return { body: `${body}${queued}\n\n_${weekly ? 'Managing Director (autonomous weekly review)' : 'Managed by'}: ${r.provider || 'AI'}_`, problem: false, dispatch };
}

// Board report — the weekly chief-of-staff digest. Reads what the team produced
// this week (passed in as AGENT_CORPUS) and compiles ONE exec briefing.
async function boardReport() {
  const corpus = (process.env.AGENT_CORPUS || '').slice(0, 12000);
  const system = "You are the Chief of Staff for PropMail Pro's AI team. Compile the week's specialist reports into ONE concise board-level briefing for the owner/investor. Be honest and specific, pull out what actually matters, separate fact from recommendation, and don't pad.";
  const user = `THIS WEEK'S TEAM REPORTS:\n${corpus || '(No reports were captured this week.)'}\n\nWrite a Markdown board report:\n## The week in one line\n## What the team found & did\n(grouped by area — research, competitor, R&D, ops/health, security)\n## Recommended decisions for the owner\n## Watch list`;
  const r = await runLLM({ system, user, maxTokens: 2200 });
  return r.error ? `**The board report could not run:** ${r.error}\n\n(Check the GROQ_API_KEY secret is set on the repo.)` : `${stripPreamble(r.text)}\n\n_Compiled by: ${r.provider || 'AI'}_`;
}

const ROLES = {
  manager: { fn: managerReport, dir: 'manager', title: '🧭 Manager' },
  research: { fn: researchReport, dir: 'research', title: '🔎 Research' },
  competitor: { fn: competitorReport, dir: 'competitor', title: '🛰️ Competitor watch' },
  content: { fn: contentReport, dir: 'content', title: '✍️ Letter copy' },
  rnd: { fn: rndReport, dir: 'rnd', title: '🧪 R&D' },
  health: { fn: healthReport, dir: 'health', title: '🩺 Health check' },
  security: { fn: securityReport, dir: 'security', title: '🔒 Security' },
  board: { fn: boardReport, dir: 'board', title: '🏢 Board report' },
};
const role = ROLES[ROLE] || ROLES.security;
const out = await role.fn();
const body = typeof out === 'string' ? out : out.body;
const problem = typeof out === 'object' && out.problem;
const dispatch = (typeof out === 'object' && Array.isArray(out.dispatch)) ? out.dispatch : [];
const dir = `reports/${role.dir}`;
fs.mkdirSync(dir, { recursive: true });
const file = `${dir}/${today}.md`;
const title = `${role.title} report — ${today}`;
fs.writeFileSync(file, `# ${title}\n\n${body}\n`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `report_file=${file}\nreport_title=${title}\nhas_problem=${problem ? 'true' : 'false'}\ndispatch_json=${JSON.stringify(dispatch)}\n`);
console.log(`Wrote ${file}`);
