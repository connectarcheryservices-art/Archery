// /api/admin/login — owner (master password [+ TOTP]) OR staff (username + password [+ TOTP]).
//
// THREAT_MODEL T5 fixes applied here:
//   1. Rate limited (per-IP and per-identity, DB-backed — see _lib/ratelimit.js).
//      Previously: unlimited guesses against a single master password.
//   2. Owner password compared in CONSTANT TIME. Previously a plain `===`, while
//      timingEq() already existed in _lib/auth.js and simply wasn't used here.
//   3. Owner supports TOTP. Previously staff had 2FA and the OWNER — the most
//      privileged account on the platform — did not.
//   4. Username enumeration closed: scrypt runs even when the row is absent, so a
//      valid username can't be identified with a stopwatch.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { adminToken, staffToken, verifyPassword, timingEq, hashPassword } = require('../_lib/auth');
const { verifyTotp, consumeBackupCode } = require('../_lib/totp');
const { guard, record } = require('../_lib/ratelimit');
const { q } = require('../_lib/db');

// A real scrypt hash to compare against when the account doesn't exist, so the
// "no such user" path costs the same as the "wrong password" path.
const DUMMY_HASH = hashPassword(require('crypto').randomBytes(32).toString('hex'));

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);

  const b = readBody(req);
  const isOwner = !b.username;
  const identity = isOwner ? 'owner' : String(b.username || '').trim().toLowerCase();

  // 1. Rate limit BEFORE doing any work.
  const blocked = await guard(req, identity, { idMax: 8, ipMax: 20, windowMin: 15 });
  if (blocked) {
    res.setHeader('Retry-After', String(blocked.retryAfter));
    return json(res, {
      ok: false,
      error: blocked.error
        ? 'Sign-in is temporarily unavailable. Please try again shortly.'
        : `Too many sign-in attempts. Try again in ${Math.ceil(blocked.retryAfter / 60)} minute(s).`,
    }, 429);
  }

  const fail = async (msg, extra = {}, code = 401) => {
    await record(isOwner ? 'id:owner' : 'id:' + identity, { ok: false, identity, req });
    await record('ip:' + require('../_lib/ratelimit').clientIp(req), { ok: false, identity, req });
    return json(res, { ok: false, error: msg, ...extra }, code);
  };
  const pass = async (payload) => {
    await record('id:' + identity, { ok: true, identity, req });
    return json(res, { ok: true, ...payload });
  };

  try {
    // ───────────── OWNER ─────────────
    if (isOwner) {
      const expected = process.env.ADMIN_PASSWORD || '';
      // Constant-time. timingEq handles length mismatch safely.
      const okPw = !!expected && timingEq(String(b.password || ''), expected);
      if (!okPw) return fail('Wrong password');

      // Owner 2FA, if enrolled.
      const sec = (await q('select * from owner_security where id=1').catch(() => ({ rows: [] }))).rows[0];
      if (sec && sec.totp_enabled) {
        const code = String(b.totp || '').trim();
        if (!code) return json(res, { ok: false, needsTotp: true, error: 'Enter your 6-digit authenticator code.' });
        let valid = verifyTotp(sec.totp_secret, code);
        if (!valid) {
          const remaining = consumeBackupCode(sec.backup_codes || [], code);
          if (remaining) {
            valid = true;
            await q('update owner_security set backup_codes=$1 where id=1', [JSON.stringify(remaining)]).catch(() => {});
          }
        }
        if (!valid) return fail('Incorrect code.', { needsTotp: true });
      }
      return pass({ token: adminToken(), role: 'owner', name: 'Owner', twoFactor: !!(sec && sec.totp_enabled) });
    }

    // ───────────── STAFF ─────────────
    const row = (await q('select * from staff where lower(username)=$1', [identity])).rows[0];
    // Always run scrypt — equal work whether or not the account exists (T5.4).
    const okPw = verifyPassword(String(b.password || ''), row ? row.pass : DUMMY_HASH);
    if (!row || row.active === false || !okPw) return fail('Incorrect username or password');

    if (row.totp_enabled) {
      const code = String(b.totp || '').trim();
      if (!code) return json(res, { ok: false, needsTotp: true, error: 'Enter your 6-digit authenticator code.' });
      let valid = verifyTotp(row.totp_secret, code);
      if (!valid) {
        const remaining = consumeBackupCode(row.backup_codes || [], code);
        if (remaining) {
          valid = true;
          await q('update staff set backup_codes=$1 where id=$2', [JSON.stringify(remaining), row.id]).catch(() => {});
        }
      }
      if (!valid) return fail('Incorrect code.', { needsTotp: true });
    }
    await q('update staff set last_login=now() where id=$1', [row.id]).catch(() => {});
    const staff = { id: row.id, role: row.role, name: row.name, username: row.username };
    return pass({ token: staffToken(staff), role: row.role, name: row.name });
  } catch (e) {
    console.error('admin login:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
