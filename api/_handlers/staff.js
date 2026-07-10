// /api/staff  and  /api/staff/<id>  — employee accounts. Owner/manager only.
// Also handles the acting admin's own 2FA (/api/staff/me/2fa-*) so staff can
// secure their own login.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin, can, hashPassword } = require('../_lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCodes } = require('../_lib/totp');
const { q } = require('../_lib/db');

const ROLES = ['manager', 'editor', 'support'];
const rowOut = r => ({ id: r.id, name: r.name, username: r.username, email: r.email, role: r.role, active: r.active, twoFactor: !!r.totp_enabled, lastLogin: r.last_login, createdAt: r.created_at });

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);

  const id = req.query.id;         // /api/staff/<id>
  const sub = req.query.action;    // /api/staff/<id>/<action> — reserved

  try {
    // Any signed-in admin (owner or staff) can set up 2FA on their OWN account.
    if (id === 'me') {
      if (actor.role === 'owner') return json(res, { error: 'The owner secures login via the master password + Vercel env; per-account 2FA applies to staff accounts.' }, 400);
      const me = (await q('select * from staff where id=$1', [actor.sid])).rows[0];
      if (!me) return json(res, { error: 'Not found' }, 404);
      if (sub === '2fa-setup' && req.method === 'POST') {
        const s = generateSecret();
        await q('update staff set totp_secret=$1, totp_enabled=false where id=$2', [s, me.id]);
        return json(res, { ok: true, secret: s, otpauth: otpauthUri(s, { account: me.username }) });
      }
      if (sub === '2fa-enable' && req.method === 'POST') {
        const b = readBody(req);
        if (!me.totp_secret || !verifyTotp(me.totp_secret, b.code)) return json(res, { ok: false, error: 'Incorrect code.' }, 400);
        const { plain, hashed } = generateBackupCodes();
        await q('update staff set totp_enabled=true, backup_codes=$1 where id=$2', [JSON.stringify(hashed), me.id]);
        return json(res, { ok: true, backupCodes: plain });
      }
      if (req.method === 'GET') return json(res, { ok: true, me: rowOut(me) });
      return json(res, { error: 'Method not allowed' }, 405);
    }

    // Managing OTHER staff requires manage_staff (owner or manager).
    if (!can(actor, 'manage_staff')) return json(res, { error: 'Only the owner or a manager can manage staff accounts.' }, 403);

    if (!id && req.method === 'GET') {
      const r = await q('select * from staff order by id desc');
      return json(res, r.rows.map(rowOut));
    }
    if (!id && req.method === 'POST') {
      const b = readBody(req);
      const name = String(b.name || '').trim().slice(0, 80);
      const username = String(b.username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
      const password = String(b.password || '');
      const role = ROLES.includes(b.role) ? b.role : 'support';
      if (!name || !username || !password) return json(res, { error: 'Name, username and password are required.' }, 400);
      if (password.length < 8) return json(res, { error: 'Password must be at least 8 characters.' }, 400);
      const taken = (await q('select 1 from staff where lower(username)=$1', [username])).rows[0];
      if (taken) return json(res, { error: 'That username is already taken.' }, 409);
      const r = await q('insert into staff (name,username,email,pass,role,created_by) values ($1,$2,$3,$4,$5,$6) returning id',
        [name, username, b.email || null, hashPassword(password), role, actor.name || actor.username || 'owner']);
      return json(res, { ok: true, id: r.rows[0].id });
    }
    if (id && req.method === 'PUT') {
      const b = readBody(req);
      const sets = [], vals = [];
      if (b.name !== undefined) { sets.push(`name=$${vals.push(String(b.name).slice(0, 80))}`); }
      if (b.email !== undefined) { sets.push(`email=$${vals.push(b.email || null)}`); }
      if (b.role !== undefined && ROLES.includes(b.role)) { sets.push(`role=$${vals.push(b.role)}`); }
      if (b.active !== undefined) { sets.push(`active=$${vals.push(!!b.active)}`); }
      if (b.password) { if (String(b.password).length < 8) return json(res, { error: 'Password must be at least 8 characters.' }, 400); sets.push(`pass=$${vals.push(hashPassword(b.password))}`); }
      if (b.reset2fa) { sets.push(`totp_enabled=false`); sets.push(`totp_secret=null`); sets.push(`backup_codes='[]'`); }
      if (!sets.length) return json(res, { error: 'Nothing to update.' }, 400);
      vals.push(parseInt(id));
      await q(`update staff set ${sets.join(',')} where id=$${vals.length}`, vals);
      return json(res, { ok: true });
    }
    if (id && req.method === 'DELETE') {
      await q('delete from staff where id=$1', [parseInt(id)]);
      return json(res, { ok: true });
    }
    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('staff:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
