// /api/users/<register|login|me> — customer accounts.
// Passwords: scrypt salt:hash. Sessions: stateless signed token (payload + HMAC),
// so it works across serverless instances with no session store.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const secret = () => 'archery-users-v1:' + (process.env.ADMIN_PASSWORD || 'set-admin-password');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
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

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    if (action === 'register' && req.method === 'POST') {
      const b = readBody(req);
      const name = String(b.name || '').trim().slice(0, 80);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
      const password = String(b.password || '');
      if (!name || !email || !password) return json(res, { ok: false, error: 'Name, email and password are required.' }, 400);
      if (!EMAIL_RE.test(email)) return json(res, { ok: false, error: 'Please enter a valid email address.' }, 400);
      if (password.length < 8) return json(res, { ok: false, error: 'Password must be at least 8 characters.' }, 400);
      const exists = (await q('select id from users where email=$1', [email])).rows[0];
      if (exists) return json(res, { ok: false, error: 'An account with this email already exists.' }, 409);
      const r = await q('insert into users (name,email,pass,created_at) values ($1,$2,$3,$4) returning id',
        [name, email, hashPassword(password), Date.now()]);
      const user = { id: r.rows[0].id, name, email };
      return json(res, { ok: true, token: sign(user), user });
    }
    if (action === 'login' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      if (!email || !password) return json(res, { ok: false, error: 'Email and password are required.' }, 400);
      const row = (await q('select * from users where email=$1', [email])).rows[0];
      if (!row || !verifyPassword(password, row.pass)) return json(res, { ok: false, error: 'Incorrect email or password.' }, 401);
      const user = { id: row.id, name: row.name, email: row.email };
      return json(res, { ok: true, token: sign(user), user });
    }
    if (action === 'me' && req.method === 'GET') {
      const h = req.headers['authorization'] || '';
      const u = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
      return u ? json(res, { ok: true, user: u }) : json(res, { ok: false }, 401);
    }
    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (e) {
    console.error('users:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
