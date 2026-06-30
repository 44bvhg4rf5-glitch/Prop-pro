import https from 'https';

// HM Land Registry Price Paid Data per postcode (free, open). Every SOLD property
// carries the FULL address (house number) + price + date + type — so we can both
// (1) recover a listing's exact address from its own prior sale, and (2) pin which
// house on a street is the listing by matching property type + asking price.

const LR = 'https://landregistry.data.gov.uk/data/ppi/transaction-record.json';
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tc = (s) => (s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));

// PPD property type → our normalised category.
function typeCat(pt) {
  let v = '';
  if (pt && typeof pt === 'object') v = (pt.prefLabel && pt.prefLabel[0] && pt.prefLabel[0]._value) || pt._value || (pt._about || '').split(/[\/#]/).pop();
  else v = String(pt || '');
  v = v.toLowerCase();
  if (/detached/.test(v) && !/semi/.test(v)) return 'detached';
  if (/semi/.test(v)) return 'semi';
  if (/terrac/.test(v)) return 'terraced';
  if (/flat|maisonette/.test(v)) return 'flat';
  return 'other';
}
// A listing's type → the PPD categories that count as a match.
export function listingTypeCats(t) {
  const s = String(t || '').toLowerCase();
  if (/flat|apartment|studio|maisonette/.test(s)) return ['flat'];
  if (/detached/.test(s) && !/semi/.test(s)) return ['detached'];
  if (/semi/.test(s)) return ['semi'];
  if (/end of terrace|end terrace|terrac|town house|townhouse|mews/.test(s)) return ['terraced'];
  if (/bungalow/.test(s)) return ['detached', 'semi', 'terraced', 'other']; // PPD has no bungalow category
  if (/house/.test(s)) return ['detached', 'semi', 'terraced'];
  return [];
}

function getJson(url) {
  return new Promise((resolve) => {
    const r = https.get(url, { headers: { 'User-Agent': 'PropMailPro/1.0', Accept: 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(12000, () => { r.destroy(); resolve(null); });
  });
}

const _mem = new Map();
// Sold records on a postcode, de-duplicated to the LATEST sale per address.
// ctx-aware: a cached postcode is free; only a real fetch spends ctx.lrBudget.
export async function ppdByPostcode(pc, ctx) {
  const mk = (pc || '').toUpperCase().replace(/\s+/g, '');
  if (!mk) return [];
  if (_mem.has(mk)) return _mem.get(mk);
  if (ctx && ctx.lrBudget <= 0) return [];
  if (ctx) ctx.lrBudget--;
  let out = [];
  try {
    const url = `${LR}?propertyAddress.postcode=${encodeURIComponent(pc.toUpperCase())}&_sort=-transactionDate&_pageSize=80`;
    const j = await getJson(url);
    const items = (j && j.result && j.result.items) || [];
    const byAddr = new Map();
    for (const t of items) {
      const a = t.propertyAddress || {};
      const paon = a.paon || ''; const street = a.street || '';
      if (!paon || !street) continue;
      const full = tc([paon, street, a.locality, a.town, (a.postcode || pc)].filter(Boolean).join(', '));
      const k = norm(paon + ' ' + street);
      const date = (t.transactionDate || '').slice(0, 10);
      const rec = { paon, street, fullAddress: full, postcode: (a.postcode || pc).toUpperCase(), type: typeCat(t.propertyType), price: t.pricePaid || 0, date };
      const ex = byAddr.get(k);
      if (!ex || date > ex.date) byAddr.set(k, rec);   // keep the most recent sale per address
    }
    out = [...byAddr.values()];
  } catch { out = []; }
  if (_mem.size > 600) _mem.clear();
  _mem.set(mk, out);
  return out;
}
