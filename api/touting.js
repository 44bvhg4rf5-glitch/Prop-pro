import { rightmoveListings, onTheMarketListings, mergeListings } from '../lib/sources.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { classify, longDomLeads, SIGNALS } from '../lib/touting.js';
import { sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 60 };

const ALL_HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];
const SNAP_KEY = 'touting:snapshot';
const LEADS_KEY = 'touting:leads';
const META_KEY = 'touting:meta';
const LEADS_CAP = 800;

// Pull the live index across all HA districts, Sold-STC included (we need to SEE
// the agreed state to later detect a fall-through back to Available).
async function pullAll() {
  const per = await Promise.all(ALL_HA.map(async (d) => {
    const [rm, otm] = await Promise.all([
      rightmoveListings(d, { includeSSTC: true, pages: 2 }).catch(() => []),
      onTheMarketListings(d, { pages: 1 }).catch(() => []),
    ]);
    return mergeListings([rm, otm]);
  }));
  return per.flat();
}

async function runScan(nowISO) {
  const prev = (await getJSON(SNAP_KEY, {})) || {};
  const today = await pullAll();
  const { snapshot, events } = classify(prev, today, nowISO);
  await setJSON(SNAP_KEY, snapshot);

  if (events.length) {
    // Prepend this scan's events to the capped feed, de-duplicating a repeat of
    // the same signal on the same property+day.
    const feed = (await getJSON(LEADS_KEY, [])) || [];
    const have = new Set(feed.map((e) => `${e.id}|${e.signal}|${(e.at || '').slice(0, 10)}`));
    const fresh = events.filter((e) => !have.has(`${e.id}|${e.signal}|${e.at.slice(0, 10)}`));
    const merged = [...fresh.sort((a, b) => b.score - a.score), ...feed].slice(0, LEADS_CAP);
    await setJSON(LEADS_KEY, merged);
  }

  const byType = {};
  for (const e of events) byType[e.signal] = (byType[e.signal] || 0) + 1;
  const meta = { lastScan: nowISO, scanned: today.length, tracked: Object.keys(snapshot).length, lastEvents: events.length, byType };
  await setJSON(META_KEY, meta);
  return meta;
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const wantScan = u.searchParams.get('scan');
  const key = u.searchParams.get('key') || '';
  const SCAN_KEY = process.env.TOUTING_SCAN_KEY || process.env.CRON_SECRET || '';
  const authed = SCAN_KEY && key === SCAN_KEY;     // cron/secret bypass for the daily job
  if (!authed && !guardOrigin(req, res)) return;

  if (!storeConfigured()) {
    sendJson(res, 200, { configured: false, note: 'Durable storage (KV/Redis) is not configured, so day-to-day memory is unavailable. Set KV_REST_API_* or REDIS_URL to enable the touting radar.', leads: [], longDom: [] });
    return;
  }

  const nowISO = new Date().toISOString();
  try {
    if (wantScan) {
      const meta = await runScan(nowISO);
      sendJson(res, 200, { configured: true, scanned: true, ...meta });
      return;
    }
    const [leads, snapshot, meta] = await Promise.all([
      getJSON(LEADS_KEY, []),
      getJSON(SNAP_KEY, {}),
      getJSON(META_KEY, {}),
    ]);
    const longDom = longDomLeads(snapshot || {}, nowISO).slice(0, 200);
    sendJson(res, 200, {
      configured: true,
      meta: meta || {},
      signals: SIGNALS,
      counts: { events: (leads || []).length, longDom: longDom.length, tracked: Object.keys(snapshot || {}).length },
      leads: (leads || []).slice(0, 300),
      longDom,
    });
  } catch (e) {
    sendJson(res, 500, { error: 'touting scan failed: ' + e.message });
  }
}
