// Build lib/data/harrow-licences.js from a Harrow licence-register export.
//
// Harrow publishes a SEARCH-ONLY public register (no download/API). Two free
// ways to get the underlying list:
//   • FOI request to licensing@harrow.gov.uk for the HMO + selective licence
//     register as CSV (councils routinely provide this — it's how we got Brent).
//   • Or a register scrape if the portal allows it.
//
// Then map the columns and run:
//   node scripts/build-harrow-licences.mjs <export.csv>
//
// Expected/auto-detected columns (case-insensitive, flexible names):
//   address / premises   → property address
//   postcode             → postcode
//   licence type / type  → HMO / Selective / Additional
//   licence holder / holder / applicant → landlord name
//   holder address / correspondence     → landlord's own address (optional)
import fs from 'fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/build-harrow-licences.mjs <csv>'); process.exit(1); }

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}
const find = (header, ...names) => header.findIndex((h) => names.some((n) => h.toLowerCase().replace(/[^a-z]/g, '').includes(n)));

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const header = parseLine(lines[0]).map((h) => h.trim());
const iAddr = find(header, 'address', 'premises'), iPc = find(header, 'postcode'), iType = find(header, 'licencetype', 'type'), iHolder = find(header, 'holder', 'applicant', 'licensee'), iCorr = find(header, 'holderaddress', 'correspondence', 'serviceaddress');
if (iAddr < 0 || iHolder < 0) { console.error('Could not find address/holder columns in:', header); process.exit(1); }

const pcRe = /[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i;
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  const a = (f[iAddr] || '').trim(); const h = (f[iHolder] || '').trim();
  if (!a || !h) continue;
  let p = iPc >= 0 ? (f[iPc] || '').trim().toUpperCase() : ''; if (!p) p = (a.match(pcRe) || [''])[0].toUpperCase();
  if (!/^HA\d/.test(p.replace(/\s+/g, ''))) continue;
  rows.push({ a, p, t: iType >= 0 ? (f[iType] || 'Licence').trim() : 'Licence', h, c: iCorr >= 0 ? (f[iCorr] || '').trim() : '' });
}
fs.writeFileSync('lib/data/harrow-licences.js', 'export const HARROW_LICENCES = ' + JSON.stringify(rows) + ';\n');
console.log(`Wrote lib/data/harrow-licences.js — ${rows.length} Harrow licensed properties.`);
