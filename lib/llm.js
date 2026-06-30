import https from 'https';

// Provider-agnostic LLM layer. Pick by whichever key is set (or LLM_PROVIDER).
//   Gemini   : GEMINI_API_KEY (or GOOGLE_API_KEY)   — free tier, web search
//   Anthropic: ANTHROPIC_API_KEY (or AI_API_KEY)
//   Groq     : GROQ_API_KEY                          — OpenAI-compatible, no search
//   OpenAI   : OPENAI_API_KEY
const KNOWN = ['gemini', 'anthropic', 'groq', 'openai'];
// Forgive common mistypes / aliases of the provider name.
const ALIAS = { qroq: 'groq', grok: 'groq', groqq: 'groq', google: 'gemini', gemeni: 'gemini', gemmini: 'gemini', claude: 'anthropic', gpt: 'openai', chatgpt: 'openai' };
const hasKey = {
  groq: () => !!process.env.GROQ_API_KEY,
  openai: () => !!process.env.OPENAI_API_KEY,
  anthropic: () => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY),
  gemini: () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
};
// Providers that can browse the live web (grounding / web_search tool).
const SEARCH_CAPABLE = ['gemini', 'anthropic'];
// Default speed/cost order when nothing is specified (Groq is fastest + cheapest).
const PRIORITY = ['groq', 'gemini', 'anthropic', 'openai'];

// Every provider that actually has a key configured — so we can run more than one.
export function availableProviders() { return KNOWN.filter((p) => hasKey[p]()); }
function explicitPref() {
  let e = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  e = ALIAS[e] || e;
  return KNOWN.includes(e) ? e : '';
}

// The ordered list of providers to TRY for one call. We try the first, and on
// quota/error fall through to the next — so Groq and Gemini work side by side:
// fast Groq for everyday calls, Gemini when a task needs web search, and each is
// the other's automatic fallback. For search tasks, search-capable providers
// lead (others still answer, just without browsing) so a job never hard-fails.
export function providerOrder({ search = false } = {}) {
  const avail = availableProviders();
  if (!avail.length) return [];
  const pref = explicitPref();
  let order;
  if (search) {
    const searchers = avail.filter((p) => SEARCH_CAPABLE.includes(p));
    const rest = avail.filter((p) => !SEARCH_CAPABLE.includes(p));
    order = [...searchers, ...rest];
    if (pref && searchers.includes(pref)) order = [pref, ...order.filter((p) => p !== pref)];
  } else {
    order = [pref, ...PRIORITY].filter((p) => p && avail.includes(p));
    order = [...order, ...avail];
  }
  return [...new Set(order)];
}

// The single provider a normal (non-search) call would use — for display/status.
export function provider() { return providerOrder({ search: false })[0] || ''; }
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
  const body = { model, max_tokens: maxTokens, messages: msgs };
  let r = await postJson(url, { Authorization: 'Bearer ' + key }, body, timeoutMs);
  // Ride out a rate limit (e.g. the Manager fanning out to several agents) with
  // backoff. The last wait crosses the ~60s mark so a per-minute token cap has
  // reset by the final retry: 5s, 15s, 35s.
  const backoff = [5000, 15000, 35000];
  for (let attempt = 0; r.status === 429 && attempt < backoff.length; attempt++) {
    await new Promise((s) => setTimeout(s, backoff[attempt]));
    r = await postJson(url, { Authorization: 'Bearer ' + key }, body, timeoutMs);
  }
  if (r.error) return { error: r.error };
  if (!r.json || (r.status && r.status >= 400)) return { error: 'http_' + (r.status || '0') };
  return { text: (((r.json.choices || [])[0] || {}).message || {}).content || '' };
}

// Run one specific provider.
function runOne(p, { system, messages, maxTokens, search, timeoutMs }) {
  if (p === 'gemini') return gemini({ system, messages, maxTokens, search, timeoutMs });
  if (p === 'anthropic') return anthropic({ system, messages, maxTokens, search, timeoutMs });
  if (p === 'groq' || p === 'openai') return openaiCompatible(p, { system, messages, maxTokens, timeoutMs });
  return Promise.resolve({ error: 'unknown_provider' });
}

// Unified entry point. Tries the providers in order (see providerOrder) and
// returns the first good answer, so Groq + Gemini run as one resilient system:
// whichever is best for the task leads, the other catches quota/errors.
// Returns { text, provider, searched } or { error }.
export async function runLLM({ system = '', messages, user, maxTokens = 2000, search = false, timeoutMs = 55000 }) {
  const msgs = messages || [{ role: 'user', content: user || '' }];
  const order = providerOrder({ search });
  if (!order.length) return { error: 'no_key' };
  let lastErr = 'no_key';
  for (const p of order) {
    const r = await runOne(p, { system, messages: msgs, maxTokens, search, timeoutMs });
    if (r && r.text && r.text.trim() && !r.error) {
      return { text: r.text, provider: p, searched: search && SEARCH_CAPABLE.includes(p) };
    }
    lastErr = (r && r.error) || lastErr;
  }
  return { error: lastErr };
}

// ── Vision: read images with the free vision-capable providers (Gemini free
// tier first, Anthropic as fallback). `images` = [{ data: base64, mediaType }].
async function geminiVision({ system, prompt, images, maxTokens, timeoutMs }) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!key) return { error: 'no_gemini_key' };
  const models = [process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'].filter((m, i, a) => a.indexOf(m) === i);
  const parts = [{ text: prompt }, ...images.map((im) => ({ inline_data: { mime_type: im.mediaType || 'image/jpeg', data: im.data } }))];
  const base = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 } };
  if (system) base.system_instruction = { parts: [{ text: system }] };
  let lastErr = 'gemini_vision_failed';
  for (const model of models) {
    const r = await postJson('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { 'x-goog-api-key': key }, base, timeoutMs);
    if (r.error) { lastErr = r.error; continue; }
    if (r.status === 429) { lastErr = 'quota'; continue; }
    if (!r.json || (r.status && r.status >= 400)) { lastErr = 'http_' + (r.status || '0'); continue; }
    const cand = (r.json.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map((x) => x.text || '').join('');
    if (text) return { text };
  }
  return { error: lastErr };
}
async function anthropicVision({ system, prompt, images, maxTokens, timeoutMs }) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '';
  if (!key) return { error: 'no_anthropic_key' };
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || 'claude-sonnet-4-6';
  const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.data } })), { type: 'text', text: prompt }];
  const r = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }, timeoutMs);
  if (r.error) return { error: r.error };
  if (!r.json || (r.status && r.status >= 400)) return { error: 'http_' + (r.status || '0') };
  return { text: (r.json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') };
}
// True when a vision-capable (and free-tier-friendly) provider key exists.
export function visionConfigured() { return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY); }
export async function runVision({ system = '', prompt = '', images = [], maxTokens = 700, timeoutMs = 55000 }) {
  if (!images.length) return { error: 'no_images' };
  const order = providerOrder({ search: false }).filter((p) => p === 'gemini' || p === 'anthropic');
  // Always allow Gemini/Anthropic for vision even if not in the text priority list.
  for (const p of ['gemini', 'anthropic']) if (!order.includes(p) && hasKey[p]()) order.push(p);
  if (!order.length) return { error: 'no_vision_provider' };
  let lastErr = 'vision_failed';
  for (const p of order) {
    const r = p === 'gemini' ? await geminiVision({ system, prompt, images, maxTokens, timeoutMs }) : await anthropicVision({ system, prompt, images, maxTokens, timeoutMs });
    if (r && r.text && r.text.trim() && !r.error) return { text: r.text, provider: p };
    lastErr = (r && r.error) || lastErr;
  }
  return { error: lastErr };
}

// Health-check one provider with a tiny call, so the UI can show whether a key
// actually works (distinguishes a quota block from a bad key). Optionally tests
// web-search/grounding too.
export async function pingProvider(p, { search = false } = {}) {
  const r = await runOne(p, { system: '', messages: [{ role: 'user', content: 'Reply with just: OK' }], maxTokens: 8, search, timeoutMs: 12000 });
  return { provider: p, ok: !!(r && r.text && r.text.trim() && !r.error), error: (r && r.error) || null };
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
