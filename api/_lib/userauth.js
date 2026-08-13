// Customer (non-admin) session tokens. ONE implementation.
//
// Extracted 2026-07-15 from my-profile.js:9 and users-action.js:12, which each
// defined an identical copy. The coach needs it too, and a secret with three
// copies gets rotated in two of them.
//
// Fixed 2026-08-12 (CLAUDE.md §1.2/§1.3, THREAT_MODEL T4): this used to sign
// customer tokens with ADMIN_PASSWORD — the same secret used for the owner's
// own login. Rotating the admin password silently signed out every customer,
// and anyone who learned the admin password could mint a token for ANY user
// id. Tokens also never expired and had no server-side revocation.
//
// Now: a dedicated USER_TOKEN_SECRET (never ADMIN_PASSWORD or any
// human-chosen password), a 30-day expiry claim, and a DB-backed revocation
// check (`users.token_valid_after`, migration 019) so a password reset or
// explicit logout invalidates existing tokens even though the stateless
// signature would otherwise still verify.
//
// Fixed 2026-08-13 (audit finding): the "unconfigured deployment fails safe"
// claim above used to be false — an unset USER_TOKEN_SECRET fell back to the
// FIXED STRING 'user-token-secret-not-configured', which is public (it's in
// this file, in a public repo) rather than a secret. Anyone could compute a
// valid HMAC for a forged {id: <any user id>} claim against a misconfigured
// deployment and mint a session for any user — the opposite of failing safe.
// Now an unconfigured secret makes verifyToken() reject EVERY token (nobody
// can be authenticated) and sign() refuse to mint one at all (loud failure,
// not a silent forgeable one) — a real fail-closed default.
'use strict';
const crypto = require('crypto');

const secret = () => process.env.USER_TOKEN_SECRET || null;

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(user) {
  const key = secret();
  if (!key) throw new Error('USER_TOKEN_SECRET is not configured — refusing to mint a customer session token.');
  const payload = Buffer.from(JSON.stringify({
    id: user.id, name: user.name, email: user.email,
    iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return payload + '.' + sig;
}

// Signature + expiry only. Does NOT check server-side revocation (that needs
// a DB read) — use authedUserChecked() for anything beyond a cheap sync gate.
function verifyToken(token) {
  const key = secret();
  if (!key) return null; // fail closed: nobody can be authenticated, not everybody
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch { return null; }
  if (!claims.exp || Date.now() > claims.exp) return null;
  return claims;
}

function authedUser(req) {
  const h = req.headers['authorization'] || '';
  return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
}

// Full check: signature + expiry + not-revoked. Every session must be
// revocable (CLAUDE.md §1.3) — a stateless token alone can't do that, so this
// cross-checks the token's issued-at time against the user's revocation
// watermark on every call.
async function authedUserChecked(req) {
  const claims = authedUser(req);
  if (!claims) return null;
  const { q } = require('./db');
  const row = (await q('select token_valid_after from users where id=$1', [claims.id])).rows[0];
  if (!row) return null;
  if (row.token_valid_after && claims.iat < Number(row.token_valid_after)) return null;
  return claims;
}

// Bump a user's revocation watermark so every token issued before this
// instant stops working — used on password reset and explicit logout.
async function revokeSessions(userId) {
  const { q } = require('./db');
  await q('update users set token_valid_after=$1 where id=$2', [Date.now(), userId]);
}

module.exports = { sign, verifyToken, authedUser, authedUserChecked, revokeSessions, secret };
