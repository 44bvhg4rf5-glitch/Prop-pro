import { sendJson, guardOrigin } from '../lib/helpers.js';
import { postcodesInArea } from '../lib/freeAddresses.js';
import { councilTaxAddresses } from '../lib/counciltax.js';
import { storeConfigured, getJSON, setJSON } from '../lib/store.js';

export const config = { maxDuration: 60 };

// Address precompute (#4): walk HA postcodes and Council-Tax a budgeted batch
// each run, persisting to the durable KV cache so real searches are instant.
// A cursor rotates through the districts so nightly runs build full coverage.
// Cron-guarded (PREWARM_KEY / CRON_SECRET); same-origin allowed for a manual run.
const DISTRICTS = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const key = u.searchParams.get('key') || req.headers['x-prewarm-key'] || '';
  const allowed = key && (key === process.env.PREWARM_KEY || key === process.env.CRON_SECRET);
  if (!allowed && !guardOrigin(req, res)) return;

  const batch = Math.min(parseInt(u.searchParams.get('batch') || '20', 10) || 20, 40);
  // Rotating cursor over districts (persisted).
  let cur = 0;
  if (storeConfigured()) { const c = await getJSON('prewarm:cursor', 0); cur = Number.isFinite(c) ? c : 0; }
  const district = DISTRICTS[cur % DISTRICTS.length];

  const pcs = await postcodesInArea(district).catch(() => []);
  // Skip postcodes already cached (KV) so each run makes fresh progress.
  const todo = [];
  for (const pc of pcs) {
    if (todo.length >= batch) break;
    const mk = pc.toUpperCase().replace(/\s+/g, '');
    if (storeConfigured()) { const hit = await getJSON('ct:' + mk, null); if (hit) continue; }
    todo.push(pc);
  }
  let warmed = 0, homes = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const rs = await Promise.all(todo.slice(i, i + 4).map((pc) => councilTaxAddresses(pc).catch(() => ({ rows: [] }))));
    rs.forEach((r) => { if (r && r.rows) { warmed++; homes += r.rows.length; } });
  }
  if (storeConfigured()) await setJSON('prewarm:cursor', (cur + 1) % DISTRICTS.length).catch(() => {});

  sendJson(res, 200, { district, postcodesInDistrict: pcs.length, warmedThisRun: warmed, homesCached: homes, nextDistrict: DISTRICTS[(cur + 1) % DISTRICTS.length], durable: storeConfigured() });
}
