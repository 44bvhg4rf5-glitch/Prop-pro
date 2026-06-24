import { sendJson } from '../lib/helpers.js';

export default function handler(req, res) {
  sendJson(res, 200, {
    aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    epcEnabled: Boolean(process.env.EPC_API_KEY),
  });
}
