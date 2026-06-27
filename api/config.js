import { sendJson } from '../lib/helpers.js';
import { llmConfigured, provider, availableProviders, providerOrder, pingProvider } from '../lib/llm.js';
import { searchConfigured, searchProviderName } from '../lib/search.js';

export default async function handler(req, res) {
  const providers = availableProviders();
  // ?ping=1 → live health-check each configured AI key (and test Gemini search).
  if (new URL(req.url, 'http://localhost').searchParams.get('ping')) {
    const pings = await Promise.all(providers.map((p) => pingProvider(p, { search: p === 'gemini' || p === 'anthropic' })));
    sendJson(res, 200, { providers, pings });
    return;
  }
  sendJson(res, 200, {
    aiEnabled: llmConfigured(),
    aiProvider: provider() || null,          // who handles a normal call
    aiProviders: providers,                   // every key detected (e.g. ["groq","gemini"])
    aiSearchProvider: providerOrder({ search: true })[0] || null, // who handles web-research tasks
    webSearchEnabled: searchConfigured(),         // free live web search (Tavily/Brave)
    webSearchProvider: searchProviderName() || null,
    epcEnabled: Boolean(process.env.EPC_API_KEY),
    osEnabled: Boolean(process.env.OS_PLACES_KEY),
  });
}
