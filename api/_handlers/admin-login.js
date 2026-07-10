// /api/admin/login — owner (master password) OR staff (username + password [+ TOTP]).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { adminToken, staffToken, verifyPassword } = require('../_lib/auth');
const { verifyTotp, consumeBackupCode } = require('../_lib/totp');
const { q } = require('../_lib/db');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);
  const b = readBody(req);

  // Owner: master password, no username.
  if (!b.username) {
    if (process.env.ADMIN_PASSWORD && b.password === process.env.ADMIN_PASSWORD) {
      return json(res, { ok: true, token: adminToken(), role: 'owner', name: 'Owner' });
    }
    return json(res, { ok: false, error: 'Wrong password' }, 401);
  }

  // Staff: username + password [+ TOTP].
  try {
    const username = String(b.username).trim().toLowerCase();
    const row = (await q('select * from staff where lower(username)=$1', [username])).rows[0];
    if (!row || row.active === false || !verifyPassword(String(b.password || ''), row.pass))
      return json(res, { ok: false, error: 'Incorrect username or password' }, 401);
    if (row.totp_enabled) {
      const code = String(b.totp || '').trim();
      if (!code) return json(res, { ok: false, needsTotp: true, error: 'Enter your 6-digit authenticator code.' });
      const validTotp = verifyTotp(row.totp_secret, code);
      let validBackup = false, newBackupCodes = null;
      if (!validTotp) {
        const remaining = consumeBackupCode(row.backup_codes || [], code);
        if (remaining) { validBackup = true; newBackupCodes = remaining; }
      }
      if (!validTotp && !validBackup) return json(res, { ok: false, needsTotp: true, error: 'Incorrect code.' }, 401);
      if (newBackupCodes) await q('update staff set backup_codes=$1 where id=$2', [JSON.stringify(newBackupCodes), row.id]);
    }
    await q('update staff set last_login=now() where id=$1', [row.id]).catch(() => {});
    const staff = { id: row.id, role: row.role, name: row.name, username: row.username };
    return json(res, { ok: true, token: staffToken(staff), role: row.role, name: row.name });
  } catch (e) {
    console.error('staff login:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
