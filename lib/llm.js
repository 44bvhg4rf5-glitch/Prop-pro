import https from 'https';

// Provider-agnostic LLM layer. Pick by whichever key is set (or LLM_PROVIDER).
//   Gemini   : GEMINI_API_KEY (or GOOGLE_API_KEY)   — free tier, web search
//   Anthropic: ANTHROPIC_API_KEY (or AI_API_KEY)
//   Groq     : GROQ_API_KEY                          — OpenAI-compatible, no search
//   OpenAI   : OPENAI_API_KEY
const KNOWN = ['gemini', 'anthropic', 'groq', 'openai'];
// Forgive common mistypes / aliases of the provider name.
const ALIAS = { qroq: 'groq', grok: 'groq', groqq: 'groq', google: 'gemini', gemeni: 'gemini', gemmini: 'gemini', claude: 'anthropic', gpt: 'openai', chatgpt: 'openai' };
export function provider() {
  let explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  explicit = ALIAS[explicit] || explicit;
  if (KNOWN.includes(explicit)) return explicit;
  // Unset or unrecognised → auto-detect by whichever key is present.
  // Prefer Groq/OpenAI/Anthropic over Gemini here, since a Gemini key is often
  // present-but-quota-blocked; a deliberately-added paid/other key should win.
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  return '';
}
export function llmConfigured() { return !!provider(); }

function postJson(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve) => {
    let url; try { url = new URL(urlStr); } catch { resolve({ error: 'bad_url' }); return; }
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
    }, (up) => { let b = ''; up.on('data', (c) => (b += c)); up.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: up.statusCode, json: j, raw: b }); }); });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs || 55000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(body); req.end();
  });
}

// ── Anthropic ──
async function anthropic({ system, messages, maxTokens, search, timeoutMs }) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || 'claude-sonnet-4-6';
  const payload = { model, max_tokens: maxTokens, system, messages };
  if (search) payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];
  const r = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01' }, payload, timeoutMs);
  if (r.error) return { error: r.error };
  if (!r.json || (r.status && r.status >= 400)) return { error: 'http_' + (r.status || '0') };
  return { text: (r.json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') };
}

// ── Google Gemini ──
async function gemini({ system, messages, maxTokens, search, timeoutMs }) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const primary = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const models = [primary, 'gemini-1.5-flash', 'gemini-2.0-flash-lite'].filter((m, i, a) => a.indexOf(m) === i);
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
  const base = { contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } };
  if (system) base.system_instruction = { parts: [{ text: system }] };
  let lastErr = 'gemini_failed';
  for (const model of models) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
    const send = (withSearch) => postJson(url, { 'x-goog-api-key': key }, withSearch ? { ...base, tools: [{ google_search: {} }] } : base, timeoutMs);
    let r = await send(!!search);
    if (search && (r.error || (r.status && r.status >= 400))) r = await send(false); // retry without grounding
    if (r.error) { lastErr = r.error; continue; }
    if (r.status === 429) { lastErr = 'quota'; continue; } // out of free quota for this model — try the next
    if (!r.json || (r.status && r.status >= 400)) { lastErr = 'http_' + (r.status || '0') + (r.json && r.json.error ? ':' + (r.json.error.message || '').slice(0, 80) : ''); continue; }
    const cand = (r.json.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
    return { text: text || '' };
  }
  return { error: lastErr };
}

// ── OpenAI-compatible (OpenAI, Groq) ──
async function openaiCompatible(p, { system, messages, maxTokens, timeoutMs }) {
  const key = p === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  const url = p === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = p === 'groq' ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const msgs = [system ? { role: 'system', content: system } : null, ...messages].filter(Boolean);
  const r = await postJson(url, { Authorization: 'Bearer ' + key }, { model, max_tokens: maxTokens, messages: msgs }, timeoutMs);
  if (r.error) return { error: r.error };
  if (!r.json || (r.status && r.status >= 400)) return { error: 'http_' + (r.status || '0') };
  return { text: (((r.json.choices || [])[0] || {}).message || {}).content || '' };
}

// Unified entry point. Returns { text } or { error }.
export async function runLLM({ system = '', messages, user, maxTokens = 2000, search = false, timeoutMs = 55000 }) {
  const msgs = messages || [{ role: 'user', content: user || '' }];
  const p = provider();
  if (p === 'gemini') return gemini({ system, messages: msgs, maxTokens, search, timeoutMs });
  if (p === 'anthropic') return anthropic({ system, messages: msgs, maxTokens, search, timeoutMs });
  if (p === 'groq' || p === 'openai') return openaiCompatible(p, { system, messages: msgs, maxTokens, timeoutMs });
  return { error: 'no_key' };
}

// Best-effort parse of the first JSON object in a string.
export function extractJson(text) {
  if (!text) return null;
  const fences = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const c of [fences && fences[1], text]) {
    if (!c) continue;
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* next */ } }
  }
  return null;
}
