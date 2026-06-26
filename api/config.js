import { sendJson } from '../lib/helpers.js';
import { llmConfigured, provider } from '../lib/llm.js';

export default function handler(req, res) {
  sendJson(res, 200, {
    aiEnabled: llmConfigured(),
    aiProvider: provider() || null,
    epcEnabled: Boolean(process.env.EPC_API_KEY),
  });
}
