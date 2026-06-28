import https from 'https';
import { sendJson, guardOrigin } from '../lib/helpers.js';

export const config = { maxDuration: 30 };

// "Seller Radar" — propensity-to-sell scoring (our answer to Spectre's flagship
// AI). Uses only free public data: HM Land Registry tells us when each address
// last changed hands, so we can score how likely an owner is to come to market
// (UK owners move on a ~7-12 year cycle) and flag purchase anniversaries — the
// classic off-market prospecting moment. No licensed database needed.

const LR = 'https://landregistry.data.gov.uk/data/ppi/transaction-record.json';
const DISTRICT_COUNCILS = {
  HA0: ['BRENT'], HA1: ['HARROW'], HA2: ['HARROW'], HA3: ['HARROW'], HA4: ['HILLINGDON'],
  HA5: ['HARROW'], HA6: ['HILLINGDON'], HA7: ['HARROW'], HA8: ['BARNET', 'HARROW'], HA9: ['BRENT'],
};
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';
const tc = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

function getJson(url) {
  return new Promise((resolve) => {
    const r = https.get(url, { headers: { 'User-Agent': 'PropMailPro/1.0', Accept: 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(14000, () => { r.destroy(); resolve(null); });
  });
}

// Likelihood an owner comes to market, from how long they've owned. Peaks across
// the typical 7-13 year move cycle; long-term owners are likely downsizers.
function propensity(years) {
  if (years == null) return { score: 0, band: 'unknown' };
  let s;
  if (years < 3) s = 12;
  else if (years < 5) s = 32;
  else if (years < 7) s = 55;
  else if (years < 10) s = 88;
  else if (years < 14) s = 92;
  else if (years < 20) s = 78;
  else s = 64;
  const band = s >= 85 ? 'hot' : s >= 55 ? 'warm' : 'cold';
  return { score: s, band };
}

export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const postcode = (u.searchParams.get('postcode') || '').toUpperCase().trim();
  const district = (u.searchParams.get('district') || '').toUpperCase().trim();
  const todayISO = (u.searchParams.get('today') || '').slice(0, 10); // caller passes real date (no Date in some envs)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayISO) ? new Date(todayISO) : new Date();
  const nowY = today.getFullYear(), nowM = today.getMonth(), nowD = today.getDate();

  let urls = [];
  if (/^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/.test(postcode)) {
    urls = [`${LR}?propertyAddress.postcode=${encodeURIComponent(postcode)}&_pageSize=200`];
  } else if (district) {
    const councils = [...new Set((DISTRICT_COUNCILS[district] || ['HARROW']))];
    urls = councils.map((c) => `${LR}?propertyAddress.district=${encodeURIComponent(c)}&_sort=-transactionDate&_pageSize=2000`);
  } else {
    sendJson(res, 400, { error: 'Pass ?postcode=HA1 3TF or ?district=HA1' });
    return;
  }

  try {
    const lists = await Promise.all(urls.map((url) => getJson(url).then((j) => (j && j.result && j.result.items) || []).catch(() => [])));
    const byAddr = new Map();
    for (const t of lists.flat()) {
      const a = t.propertyAddress || {};
      const pc = (a.postcode || '').toUpperCase();
      if (postcode && pc !== postcode) continue;
      if (district && outcodeOf(pc) !== district) continue;
      const full = [a.paon, a.street].filter(Boolean).join(' ').trim();
      if (!full) continue;
      const d = new Date(t.transactionDate);
      if (isNaN(d)) continue;
      const key = (full + '|' + pc).toLowerCase();
      const ex = byAddr.get(key);
      // Keep the most recent sale per address (= when the current owner bought).
      if (!ex || d > ex._d) {
        byAddr.set(key, {
          _d: d,
          address: tc(full) + (a.town ? ', ' + tc(a.town) : '') + (pc ? ', ' + pc : ''),
          postcode: pc, outcode: outcodeOf(pc),
          lastSold: d.toISOString().slice(0, 10), lastPrice: t.pricePaid || 0,
        });
      }
    }

    const out = [...byAddr.values()].map((r) => {
      const years = Math.round((today - r._d) / (365.25 * 24 * 3600 * 1000) * 10) / 10;
      const p = propensity(years);
      // Days until the next purchase anniversary (off-market prospecting moment).
      const anniv = new Date(nowY, r._d.getMonth(), r._d.getDate());
      if (anniv < new Date(nowY, nowM, nowD)) anniv.setFullYear(nowY + 1);
      const daysToAnniv = Math.round((anniv - new Date(nowY, nowM, nowD)) / (24 * 3600 * 1000));
      delete r._d;
      return { ...r, yearsOwned: years, score: p.score, band: p.band, daysToAnniversary: daysToAnniv, anniversarySoon: daysToAnniv <= 30 };
    }).sort((a, b) => b.score - a.score || b.yearsOwned - a.yearsOwned);

    res.setHeader('Access-Control-Allow-Origin', '*');
    sendJson(res, 200, {
      area: postcode || district,
      total: out.length,
      hot: out.filter((x) => x.band === 'hot').length,
      anniversaries: out.filter((x) => x.anniversarySoon).length,
      properties: out.slice(0, 500),
    });
  } catch (e) {
    sendJson(res, 502, { error: 'Seller Radar lookup failed: ' + e.message });
  }
}
