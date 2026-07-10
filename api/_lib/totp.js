// TOTP (RFC 6238) / HOTP (RFC 4226) — authenticator-app 2FA, zero external deps.
// Works with Google Authenticator, Authy, 1Password, Microsoft Authenticator —
// any standard TOTP app, since they all implement this exact RFC.
'use strict';
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += B32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += B32_ALPHABET.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes)); // 20 bytes = 32-char base32, standard strength
}

// HOTP per RFC 4226: HMAC-SHA1(key, counter) -> dynamic truncation -> N-digit code.
function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 |
                (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) >>> 0;
  return String(code % 10 ** digits).padStart(digits, '0');
}

// TOTP per RFC 6238: HOTP with counter = floor(unixTime / step).
function totp(secretBase32, { step = 30, digits = 6, time = Date.now() } = {}) {
  return hotp(secretBase32, Math.floor(time / 1000 / step), digits);
}

// Verify allowing ±window steps of clock drift (default ±1 → 90s tolerance).
function verifyTotp(secretBase32, token, { step = 30, digits = 6, window = 1, time = Date.now() } = {}) {
  const t = String(token || '').trim();
  if (!/^\d{6,8}$/.test(t)) return false;
  const counter = Math.floor(time / 1000 / step);
  for (let e = -window; e <= window; e++) {
    if (timingSafeEqual(hotp(secretBase32, counter + e, digits), t)) return true;
  }
  return false;
}
function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function otpauthUri(secretBase32, { issuer = 'Archery.Services', account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// One-time backup codes: return {plain:[...10 codes for the user], hashed:[...to store]}.
function generateBackupCodes(n = 10) {
  const plain = [], hashed = [];
  for (let i = 0; i < n; i++) {
    const code = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    plain.push(code);
    hashed.push(crypto.createHash('sha256').update(code).digest('hex'));
  }
  return { plain, hashed };
}
function consumeBackupCode(hashedList, code) {
  const h = crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest('hex');
  const idx = (hashedList || []).indexOf(h);
  if (idx === -1) return null;
  const remaining = hashedList.slice(); remaining.splice(idx, 1);
  return remaining;
}

module.exports = { generateSecret, totp, verifyTotp, otpauthUri, generateBackupCodes, consumeBackupCode, base32Encode, base32Decode, hotp };
