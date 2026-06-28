import https from 'https';
import { sendJson, guardOrigin } from '../lib/helpers.js';

const LR = 'https://landregistry.data.gov.uk/data/ppi/transaction-record.json';
const ALL_HA = ['HA0', 'HA1', 'HA2', 'HA3', 'HA4', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9'];
// Which local authority(ies) cover each HA district (so we only query those).
const DISTRICT_COUNCILS = {
  HA0: ['BRENT'], HA1: ['HARROW'], HA2: ['HARROW'], HA3: ['HARROW'], HA4: ['HILLINGDON'],
  HA5: ['HARROW'], HA6: ['HILLINGDON'], HA7: ['HARROW'], HA8: ['BARNET', 'HARROW'], HA9: ['BRENT'],
};
const outcodeOf = (pc) => (String(pc).toUpperCase().match(/^[A-Z]{1,2}\d[\dA-Z]?/) || [])[0] || '';

function getJson(url) {
  return new Promise((resolve) => {
    const r = https.get(url, { headers: { 'User-Agent': 'PropMailPro/1.0', Accept: 'application/json' } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(12000, () => { r.destroy(); resolve(null); });
  });
}

function typeLabel(v) {
  const uri = (v && typeof v === 'object') ? (v._about || v.label || v.prefLabel || '') : v;
  const t = String(uri || '').split(/[\/#]/).pop().toLowerCase();
  return ({ detached: 'Detached', 'semi-detached': 'Semi-Detached', terraced: 'Terraced', 'flat-maisonette': 'Flat / Maisonette', 'other-property-type': 'Other' })[t] || (t ? t.replace(/-/g, ' ') : 'Property');
}

// Land Registry "Sold Board" — recently registered sales across the HA area.
export default async function handler(req, res) {
  if (!guardOrigin(req, res)) return;
  const u = new URL(req.url, 'http://localhost');
  const days = Math.min(parseInt(u.searchParams.get('days') || '180', 10) || 180, 365);
  const districts = (u.searchParams.get('districts') || ALL_HA.join(','))
    .toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
  const distSet = new Set(districts);

  // Only query the councils that actually cover the requested districts.
  const councils = [...new Set(districts.flatMap((d) => DISTRICT_COUNCILS[d] || ['HARROW']))];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const minDate = cutoff.toISOString().slice(0, 10);

  try {
    const lists = await Promise.all(councils.map((c) => {
      const url = `${LR}?propertyAddress.district=${encodeURIComponent(c)}&min-transactionDate=${minDate}`
        + `&_sort=-transactionDate&_pageSize=500`;
      return getJson(url).then((j) => (j && j.result && j.result.items) || []).catch(() => []);
    }));

    const byKey = new Map();
    for (const t of lists.flat()) {
      const a = t.propertyAddress || {};
      const pc = (a.postcode || '').toUpperCase();
      if (!distSet.has(outcodeOf(pc))) continue;
      const d = new Date(t.transactionDate);
      if (isNaN(d)) continue;
      const full = [a.paon, a.street].filter(Boolean).join(' ')
        + [a.locality, a.town, pc].filter(Boolean).map((x) => ', ' + x).join('');
      const item = {
        fullAddress: full.trim(), paon: a.paon || '', street: a.street || '',
        postcode: pc, district: outcodeOf(pc),
        price: t.pricePaid || 0, date: d.toISOString().slice(0, 10),
        type: typeLabel(t.propertyType), newBuild: !!t.newBuild,
      };
      const key = (t.transactionId || full).toString();
      const ex = byKey.get(key);
      if (!ex || item.date > ex.date) byKey.set(key, item);
    }
    const list = [...byKey.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    sendJson(res, 200, { days, districts, councils, total: list.length, properties: list.slice(0, 600) });
  } catch (e) {
    sendJson(res, 502, { error: 'Land Registry lookup failed: ' + e.message });
  }
}
