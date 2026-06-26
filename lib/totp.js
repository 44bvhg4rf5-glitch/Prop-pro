import crypto from 'crypto';

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) + base32 + recovery codes. No deps.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function genSecret(len = 20) {
  const buf = crypto.randomBytes(len);
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  s = String(s || '').replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function hotp(secret, counter) {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return (bin % 1000000).toString().padStart(6, '0');
}
export function verifyTotp(secret, token, window = 1) {
  token = String(token || '').replace(/\D/g, '');
  if (token.length !== 6) return false;
  const t = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) if (hotp(secret, t + w) === token) return true;
  return false;
}
export function otpauthURI(secret, label, issuer = 'PropMail Pro') {
  return 'otpauth://totp/' + encodeURIComponent(issuer + ':' + label) + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&period=30&digits=6';
}
export function genRecoveryCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) { const c = crypto.randomBytes(5).toString('hex'); codes.push(c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 10)); }
  return codes;
}
export function hashCode(c) { return crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex'); }
// Pretty-print a secret in groups of 4 for manual entry.
export function groupSecret(s) { return String(s).replace(/(.{4})/g, '$1 ').trim(); }
