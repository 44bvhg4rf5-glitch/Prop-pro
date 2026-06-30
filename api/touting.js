import { rightmoveListings, onTheMarketListings, mergeListings } from '../lib/sources.js';
import { getJSON, setJSON, storeConfigured } from '../lib/store.js';
import { classify, longDomLeads, SIGNALS } from '../lib/touting.js';
import { sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 60 };

const ALL_HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];
const SNAP_KEY = 'touting:snapshot';
const LEADS_KEY = 'touting:leads';
const META_KEY = 'touting:meta';
const OFFMARKET_KEY = 'touting:offmarket';
const LEADS_CAP = 800;
const OFFMARKET_CAP = 6000;   // the growing database of properties that have left the market

// Pull the live index across all HA districts — BOTH sale (Sold-STC included, so
// we can see fall-throughs) and rent (Let-Agreed included). Each listing is
// tagged with its channel so exits can be classified sold / let / withdrawn.
async function pullAll() {
  const per = await Promise.all(ALL_HA.map(async (d) => {
    const [rmSale, otmSale, rmRent, otmRent] = await Promise.all([
      rightmoveListings(d, { includeSSTC: true, pages: 2 }).catch(() => []),
      onTheMarketListings(d, { pages: 1 }).catch(() => []),
      rightmoveListings(d, { channel: 'rent', includeSSTC: true, pages: 1 }).catch(() => []),
      onTheMarketListings(d, { channel: 'rent', pages: 1 }).catch(() => []),
    ]);
    const sale = mergeListings([rmSale, otmSale]).map((p) => ({ ...p, channel: 'sale' }));
    const rent = mergeListings([rmRent, otmRent]).map((p) => ({ ...p, channel: 'rent' }));
    return [...sale, ...rent];
  }));
  return per.flat();
}

async function runScan(nowISO) {
  const prev = (await getJSON(SNAP_KEY, {})) || {};
  const today = await pullAll();
  const { snapshot, events, offMarket } = classify(prev, today, nowISO);
  await setJSON(SNAP_KEY, snapshot);

  // Append confirmed exits to the off-market database (dedupe by id+reason; a
  // property that leaves the market is recorded once with how it left).
  if (offMarket && offMarket.length) {
    const db = (await getJSON(OFFMARKET_KEY, [])) || [];
    const have = new Set(db.map((r) => `${r.id}|${r.reason}`));
    const fresh = offMarket.filter((r) => !have.has(`${r.id}|${r.reason}`));
    if (fresh.length) await setJSON(OFFMARKET_KEY, [...fresh, ...db].slice(0, OFFMARKET_CAP));
  }

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
  const offByReason = {};
  for (const r of (offMarket || [])) offByReason[r.reason] = (offByReason[r.reason] || 0) + 1;
  const meta = { lastScan: nowISO, scanned: today.length, tracked: Object.keys(snapshot).length, lastEvents: events.length, byType, offMarket: (offMarket || []).length, offByReason };
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
    // The off-market database (every property that has left the market).
    if (u.searchParams.get('view') === 'offmarket') {
      const reason = (u.searchParams.get('reason') || '').toLowerCase();
      const district = (u.searchParams.get('district') || '').toUpperCase();
      let db = (await getJSON(OFFMARKET_KEY, [])) || [];
      if (reason) db = db.filter((r) => r.reason === reason);
      if (district) db = db.filter((r) => (r.district || '').toUpperCase() === district);
      const counts = {};
      for (const r of ((await getJSON(OFFMARKET_KEY, [])) || [])) counts[r.reason] = (counts[r.reason] || 0) + 1;
      sendJson(res, 200, { configured: true, total: db.length, counts, records: db.slice(0, 1000) });
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
