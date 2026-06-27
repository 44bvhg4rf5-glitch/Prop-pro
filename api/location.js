import { rightmoveTypeahead } from '../lib/sources.js';
import { sendJson, guardOrigin } from '../lib/helpers.js';

// UK-wide location autocomplete — type any postcode, town or area and get the
// search identifiers used by /api/listings?location=…
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const q = (u.searchParams.get('q') || '').trim();
  const matches = await rightmoveTypeahead(q).catch(() => []);
  res.setHeader('Access-Control-Allow-Origin', '*');
  sendJson(res, 200, { query: q, matches });
}
