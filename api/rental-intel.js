import { sendJson, guardOrigin } from '../lib/helpers.js';
import { rentalIntelForArea } from '../lib/rentalIntel.js';

export const config = { maxDuration: 60 };

// Rental Intelligence — the live HA rental market like Spectre sees it: every
// to-let / let-agreed property with its managing (rival) agent, rent and status,
// ranked by competitor agent and street, with touting leads.
//   GET ?area=HA1&pages=3
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const area = (url.searchParams.get('area') || '').trim().toUpperCase();
  const pages = Math.min(6, Math.max(1, parseInt(url.searchParams.get('pages') || '3', 10) || 3));
  if (!area) { sendJson(res, 400, { error: 'Send ?area=HA1' }); return; }
  try {
    const intel = await rentalIntelForArea(area, { pages });
    sendJson(res, 200, { source: 'Rightmove + OnTheMarket (live)', ...intel });
  } catch (e) {
    sendJson(res, 500, { error: String((e && e.message) || e) });
  }
}
