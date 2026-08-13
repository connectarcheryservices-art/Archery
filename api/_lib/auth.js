// Admin auth for serverless — two kinds of actor:
//   • OWNER — the creator. Authenticates with the master ADMIN_PASSWORD.
//   • STAFF — employees created by the owner. Authenticate with username +
//             password (scrypt) [+ TOTP 2FA if enabled].
//
// Fixed 2026-08-12 (CLAUDE.md §1.2/§1.3, THREAT_MODEL T4/T5, matching the
// customer-token fix in userauth.js/migration 019): tokens used to be signed
// with ADMIN_PASSWORD itself (the owner token was literally
// HMAC(ADMIN_PASSWORD) — the LOGIN CREDENTIAL doubling as the SIGNING KEY),
// were constant/never expired, and staff role/name were trusted straight
// from the token payload with no per-request DB check — so a staff member
// demoted or deactivated kept their old privileges until they happened to
// log in again, which for a non-expiring token could be never.
//
// Now: a dedicated SESSION_SECRET (never ADMIN_PASSWORD, never a
// human-chosen password), tokens carry iat/exp (12h — shorter than the
// customer default, since this is the highest-privilege account class on
// the platform), and checkAdmin() is now async: for staff it re-reads
// role/name/active from the `staff` table on EVERY request (the token
// payload only carries which row to look up, never the role itself) and
// checks a revocation watermark (staff.token_valid_after /
// owner_security.token_valid_after, migration 020) so a password change
// invalidates old sessions immediately instead of leaving them valid until
// they happen to expire.
//
// checkAdmin(req) returns a Promise<actor|null> — every callsite must
// `await` it now (18 callsites, all already inside async functions, audited
// before this change).
//
// Fixed 2026-08-13 (audit finding): the "unconfigured deployment fails safe"
// claim above used to be false for SESSION_SECRET — an unset value fell back
// to the FIXED, PUBLIC string 'session-secret-not-configured', letting
// anyone forge a valid staff token ({sid: <any staff id>}) against a
// misconfigured deployment. Owner-role forgery had a real gate
// (`if (!process.env.ADMIN_PASSWORD) return null` below) but STAFF forgery
// did not — and a forged token for a staff row with role 'manager' grants
// full owner-equivalent capability per can() below. Now an unconfigured
// secret makes verify() reject EVERY token and sign() refuse to mint one —
// nobody can be authenticated, not everybody. The unused ADMIN_PW() fallback
// (never called, not exported, same stale pattern) is removed below too.
'use strict';
const crypto = require('crypto');
const { q } = require('./db');

const SESSION_SECRET = () => process.env.SESSION_SECRET || null;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h — short-lived, high-privilege session

function timingEq(x, y) {
  const a = Buffer.from(String(x)), b = Buffer.from(String(y));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── STAFF IDENTITY ───────────────────────────────────────────────────────────
// Staff sign in with a work identity, "<name>@archery.services", instead of an
// arbitrary username. Only the LOCAL PART is stored in staff.username, so every
// account created before this keeps working unchanged; the domain is presentation
// and is accepted (but not required) at sign-in.
const STAFF_DOMAIN = 'archery.services';

/** "Sid@Archery.Services" | "sid" -> "sid".  Safe, lowercase, no separators abuse. */
function normalizeStaffUsername(input) {
  let v = String(input || '').trim().toLowerCase();
  const at = v.indexOf('@');
  if (at > -1) {
    const domain = v.slice(at + 1);
    // Only strip OUR domain. A different domain is a typo, not an identity.
    if (domain === STAFF_DOMAIN) v = v.slice(0, at);
  }
  return v.replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}

/** The address a human sees and types: "sid" -> "sid@archery.services". */
function staffLoginId(username) {
  const u = normalizeStaffUsername(username);
  return u ? u + '@' + STAFF_DOMAIN : '';
}

// ── password hashing (scrypt salt:hash) — shared with staff + user accounts ──
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return timingEq(hash, test);
}

// ── signed session tokens: <base64url payload>.<hmac>, SESSION_SECRET-keyed ──
function sign(payload) {
  const key = SESSION_SECRET();
  if (!key) throw new Error('SESSION_SECRET is not configured — refusing to mint an admin/staff session token.');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  const key = SESSION_SECRET();
  if (!key) return null; // fail closed: nobody can be authenticated, not everybody
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return null; }
  if (!claims.exp || Date.now() > claims.exp) return null;
  return claims;
}

// Owner token: {role:'owner'}. No DB row identifies the owner (single
// env-var identity), so there's nothing to look up beyond the claim itself.
function adminToken() { return sign({ role: 'owner' }); }

// Staff token: {sid}. Deliberately carries NO role/name — those are always
// re-read from the staff table in checkAdmin(), never trusted from the token.
function staffToken(staff) { return sign({ sid: staff.id }); }

async function checkAdmin(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) return null;
  const claims = verify(t);
  if (!claims) return null;

  if (claims.role === 'owner') {
    if (!process.env.ADMIN_PASSWORD) return null;
    const sec = (await q('select token_valid_after from owner_security where id=1').catch(() => ({ rows: [] }))).rows[0];
    if (sec && sec.token_valid_after && claims.iat < Number(sec.token_valid_after)) return null;
    return { role: 'owner', name: 'Owner' };
  }

  if (claims.sid == null) return null;
  const row = (await q('select role, name, username, active, token_valid_after from staff where id=$1', [claims.sid]).catch(() => ({ rows: [] }))).rows[0];
  if (!row || row.active === false) return null;
  if (row.token_valid_after && claims.iat < Number(row.token_valid_after)) return null;
  return { role: row.role || 'support', name: row.name || 'Staff', username: row.username, sid: claims.sid };
}

// Bump a staff member's revocation watermark so every token issued before
// this instant stops working — called on password change.
async function revokeStaffSessions(staffId) {
  await q('update staff set token_valid_after=$1 where id=$2', [Date.now(), staffId]);
}

// Role gate for actions beyond "is some admin logged in". Owner + manager: everything.
//   editor:  content (products/tournaments/athletes/jobs/knowledge/news/profiles/forum), approvals — not staff/settings
//   support: orders, approvals (registrations/reports/applications), chat — not content edits, not staff/settings
function can(actor, action) {
  if (!actor) return false;
  if (actor.role === 'owner' || actor.role === 'manager') return true;
  if (action === 'manage_staff' || action === 'settings') return false;
  if (actor.role === 'editor') return action !== 'orders';
  if (actor.role === 'support') return action === 'orders' || action === 'approvals' || action === 'chat';
  return false;
}

module.exports = { adminToken, staffToken, checkAdmin, can, hashPassword, verifyPassword, timingEq,
                   revokeStaffSessions, STAFF_DOMAIN, normalizeStaffUsername, staffLoginId };
