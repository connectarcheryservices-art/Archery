// Admin auth for serverless — two kinds of actor, both stateless (no session store):
//   • OWNER — the creator. Authenticates with the master ADMIN_PASSWORD.
//             Token = HMAC(ADMIN_PASSWORD). Full control, always.
//   • STAFF — employees created by the owner. Authenticate with username +
//             password (scrypt) [+ TOTP 2FA if enabled]. Token is a signed
//             {sid,role,name} payload — no session store needed.
//
// checkAdmin(req) returns an actor object (truthy) or null (falsy), so every
// existing `if (!checkAdmin(req))` callsite keeps working unchanged. New code
// can read actor.role / actor.name / actor.sid for role-gated endpoints.
'use strict';
const crypto = require('crypto');

const SECRET = () => process.env.ADMIN_PASSWORD || 'no-admin-password-set';

function timingEq(x, y) {
  const a = Buffer.from(String(x)), b = Buffer.from(String(y));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// ── owner token (master password, unchanged shape for backward compatibility) ──
function adminToken() {
  return crypto.createHmac('sha256', SECRET()).update('archery-admin-v1').digest('hex');
}

// ── staff token: s.<base64url payload>.<hmac> ──
function staffToken(staff) {
  const body = Buffer.from(JSON.stringify({ sid: staff.id, role: staff.role, name: staff.name, username: staff.username })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  return 's.' + body + '.' + sig;
}

function actorFromToken(t) {
  if (!process.env.ADMIN_PASSWORD || !t) return null;
  if (timingEq(t, adminToken())) return { role: 'owner', name: 'Owner' };
  if (t.startsWith('s.')) {
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    const [, body, sig] = parts;
    const expected = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
    if (!timingEq(sig, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      return { role: p.role || 'support', name: p.name || 'Staff', username: p.username, sid: p.sid };
    } catch (e) { return null; }
  }
  return null;
}

function checkAdmin(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return actorFromToken(t);
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

module.exports = { adminToken, staffToken, checkAdmin, can, hashPassword, verifyPassword, timingEq };
