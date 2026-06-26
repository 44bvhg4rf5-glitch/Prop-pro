import { readBody, sendJson, guardOrigin } from '../lib/helpers.js';
import { llmConfigured, runLLM } from '../lib/llm.js';

// AI proxy for the chat assistant and AI Advisor. Accepts the app's existing
// Anthropic-style payload ({ system, messages, max_tokens, tools }) and routes
// it through the provider-agnostic LLM layer, normalising the reply back to the
// Anthropic-ish shape the client already reads ({ content:[{type,text}] }).
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  if (req.method !== 'POST') { sendJson(res, 405, { error: { message: 'Method not allowed' } }); return; }
  if (!llmConfigured()) {
    sendJson(res, 503, { error: { type: 'configuration_error', message: 'No AI key configured. Add a provider key (e.g. GEMINI_API_KEY) in the project settings.' } });
    return;
  }

  let raw;
  if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  else if (typeof req.body === 'string') raw = req.body;
  else raw = await readBody(req);
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* ignore */ }

  // Normalise messages: content may be a string or Anthropic block array.
  const messages = (Array.isArray(payload.messages) ? payload.messages : []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map((b) => (b && b.text) || '').join('\n') : String(m.content || ''),
  }));
  const wantsSearch = Array.isArray(payload.tools) && payload.tools.some((t) => /search/i.test(t.type || t.name || ''));

  const r = await runLLM({
    system: payload.system || '',
    messages: messages.length ? messages : [{ role: 'user', content: '' }],
    maxTokens: payload.max_tokens || 1024,
    search: wantsSearch,
  });

  if (r.error) { sendJson(res, 502, { error: { type: 'upstream_error', message: r.error } }); return; }
  sendJson(res, 200, { content: [{ type: 'text', text: r.text || '' }], stop_reason: 'end_turn' });
}
