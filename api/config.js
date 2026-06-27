import { sendJson } from '../lib/helpers.js';
import { llmConfigured, provider, availableProviders, providerOrder } from '../lib/llm.js';

export default function handler(req, res) {
  const providers = availableProviders();
  sendJson(res, 200, {
    aiEnabled: llmConfigured(),
    aiProvider: provider() || null,          // who handles a normal call
    aiProviders: providers,                   // every key detected (e.g. ["groq","gemini"])
    aiSearchProvider: providerOrder({ search: true })[0] || null, // who handles web-research tasks
    epcEnabled: Boolean(process.env.EPC_API_KEY),
    osEnabled: Boolean(process.env.OS_PLACES_KEY),
  });
}
