// Fetch the HM Land Registry CCOD dataset via the API and build lib/data/ccod-ha.js.
//
// ONE manual step (only you can do it — it needs a licence acceptance):
//   1. Create a free account at https://use-land-property-data.service.gov.uk/
//   2. Agree to the "UK companies that own property" (CCOD) licence.
//   3. Copy your API key (Account → API key).
// Then:
//   node scripts/fetch-ccod.mjs <YOUR_API_KEY>
//
// This lists the CCOD files, grabs the newest FULL file's time-limited
// download_url, streams the CSV, filters to HA postcodes, and writes the data
// module. No CSV to download by hand.
import https from 'https';
import fs from 'fs';
import readline from 'readline';

const API_KEY = process.argv[2] || process.env.UPLAND_API_KEY || process.env.CCOD_API_KEY;
if (!API_KEY) { console.error('usage: node scripts/fetch-ccod.mjs <API_KEY>'); process.exit(1); }
const BASE = 'https://use-land-property-data.service.gov.uk/api/v1';

function apiGet(path) {
  return new Promise((resolve, reject) => {
    https.get(BASE + path, { headers: { Authorization: API_KEY, Accept: 'application/json' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { if (r.statusCode >= 400) return reject(new Error('HTTP ' + r.statusCode + ': ' + b.slice(0, 200))); try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}

(async () => {
  console.log('Listing CCOD files…');
  const list = await apiGet('/datasets/ccod');
  const files = (list.result && (list.result.public_resources || list.result.resources || list.result)) || list.resources || [];
  const names = (Array.isArray(files) ? files : []).map((f) => f.file_name || f.name || f).filter(Boolean);
  const full = names.filter((n) => /FULL/i.test(n)).sort().pop() || names.sort().pop();
  if (!full) throw new Error('No CCOD file found in API response: ' + JSON.stringify(list).slice(0, 300));
  console.log('Newest file:', full);
  const dl = await apiGet('/datasets/ccod/' + encodeURIComponent(full));
  const url = (dl.result && dl.result.download_url) || dl.download_url;
  if (!url) throw new Error('No download_url: ' + JSON.stringify(dl).slice(0, 300));

  console.log('Streaming + filtering to HA…');
  const rows = [];
  await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 400) return reject(new Error('download HTTP ' + res.statusCode));
      const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
      let header = null, idx = {};
      rl.on('line', (line) => {
        if (!header) { header = parseLine(line).map((h) => h.trim()); const col = (n) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
          idx = { a: col('Property Address'), p: col('Postcode'), name: col('Proprietor Name (1)'), corr: col('Proprietor (1) Address (1)'), cro: col('Company Registration No. (1)'), ten: col('Tenure') }; return; }
        const f = parseLine(line); const pc = (f[idx.p] || '').trim().toUpperCase();
        if (!/^HA\d/.test(pc.replace(/\s+/g, ''))) return;
        const company = (f[idx.name] || '').trim(); if (!company) return;
        rows.push({ a: (f[idx.a] || '').trim(), p: pc, company, corr: (f[idx.corr] || '').trim(), cro: (f[idx.cro] || '').trim(), tenure: ((f[idx.ten] || '').trim()[0] || '') });
      });
      rl.on('close', resolve); res.on('error', reject);
    }).on('error', reject);
  });
  fs.writeFileSync('lib/data/ccod-ha.js', 'export const CCOD_HA = ' + JSON.stringify(rows) + ';\n');
  console.log(`Done — wrote lib/data/ccod-ha.js with ${rows.length} HA company-owned properties.`);
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
