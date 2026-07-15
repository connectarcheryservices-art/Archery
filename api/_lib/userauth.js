// Customer (non-admin) session tokens. ONE implementation.
//
// Extracted 2026-07-15 from my-profile.js:9 and users-action.js:12, which each
// defined an identical copy. The coach needs it too, and a secret with three
// copies gets rotated in two of them.
//
// ⚠ THREAT_MODEL T4 / CLAUDE.md §1.2 — "No secret signs two things. Session
// secret ≠ user token secret ≠ admin password ≠ webhook secret. Nothing is ever
// signed with a human-chosen password."
//
// This code VIOLATES that rule today: user session tokens are signed with
// ADMIN_PASSWORD. Consequences, spelled out so nobody has to rediscover them:
//   * rotating the admin password silently signs out every customer;
//   * anyone who learns the admin password can mint a token for ANY user id;
//   * it is a human-chosen password being used as a signing key.
// The fix is Phase 1.1 (split secrets: USER_TOKEN_SECRET, rotate, add exp+jti).
// It is deliberately NOT bundled into the Phase 0 AI change — it logs out every
// user on deploy and needs its own migration and comms. Consolidating it here
// makes that fix a one-line change instead of a hunt.
'use strict';
const crypto = require('crypto');

const secret = () => 'archery-users-v1:' + (process.env.ADMIN_PASSWORD || 'set-admin-password');

function sign(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, name: user.name, email: user.email })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
}

function authedUser(req) {
  const h = req.headers['authorization'] || '';
  return verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
}

module.exports = { sign, verifyToken, authedUser, secret };
