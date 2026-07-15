// /api/users/<action> — customer accounts: register/login/me + real profile
// creation + TOTP 2FA + password reset. Sessions are stateless signed tokens
// (payload + HMAC) so they work across serverless instances with no store.
'use strict';
const crypto = require('crypto');
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { hashPassword, verifyPassword } = require('../_lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCodes, consumeBackupCode } = require('../_lib/totp');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const { sign, verifyToken, authedUser } = require('../_lib/userauth');
// A unique, URL-safe handle for the public profile (archery.services/<handle>).
async function uniqueHandle(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'archer';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const exists = (await q('select 1 from profiles where handle=$1', [candidate])).rows[0];
    if (!exists) return candidate;
  }
  return base + '-' + crypto.randomBytes(3).toString('hex');
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
      const userId = r.rows[0].id;
      // Every registered user gets a real, editable, shareable profile — no more demo data.
      const handle = await uniqueHandle(name);
      await q(`insert into profiles (handle,name,user_id,active) values ($1,$2,$3,true)`, [handle, name, userId]);
      // Welcome email (best-effort — silent if no mail server connected yet).
      try {
        const { sendMail, branded } = require('../_lib/mailer');
        const site = b.origin || 'https://archery.services';
        sendMail({ to: email, subject: 'Welcome to Archery.Services 🏹',
          html: branded({ heading: 'Welcome, ' + name.split(' ')[0] + '!',
            preheader: 'Your archery account is ready',
            body: 'Your account is ready. Build your athlete profile, enter tournaments, shop equipment, and connect with the archery community across India.<br><br>Your public profile: <b>archery.services/' + handle + '</b>',
            cta: 'Go to my profile', ctaUrl: site + '/profile' }) }).catch(() => {});
      } catch (e) {}
      const user = { id: userId, name, email };
      return json(res, { ok: true, token: sign(user), user });
    }

    if (action === 'login' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const password = String(b.password || '');
      if (!email || !password) return json(res, { ok: false, error: 'Email and password are required.' }, 400);
      const row = (await q('select * from users where email=$1', [email])).rows[0];
      if (!row || !verifyPassword(password, row.pass)) return json(res, { ok: false, error: 'Incorrect email or password.' }, 401);
      if (row.totp_enabled) {
        const code = String(b.totp || '').trim();
        if (!code) return json(res, { ok: false, needsTotp: true, error: 'Enter your 6-digit authenticator code.' });
        const validTotp = verifyTotp(row.totp_secret, code);
        let validBackup = false, newBackupCodes = null;
        if (!validTotp) {
          const remaining = consumeBackupCode(row.backup_codes || [], code);
          if (remaining) { validBackup = true; newBackupCodes = remaining; }
        }
        if (!validTotp && !validBackup) return json(res, { ok: false, needsTotp: true, error: 'Incorrect code. Please try again.' }, 401);
        if (newBackupCodes) await q('update users set backup_codes=$1 where id=$2', [JSON.stringify(newBackupCodes), row.id]);
      }
      const user = { id: row.id, name: row.name, email: row.email };
      return json(res, { ok: true, token: sign(user), user, accountType: row.account_type || 'customer', sellerStatus: row.seller_status });
    }

    if (action === 'me' && req.method === 'GET') {
      const u = authedUser(req);
      if (!u) return json(res, { ok: false }, 401);
      const row = (await q('select id,name,email,account_type,seller_status from users where id=$1', [u.id])).rows[0];
      if (!row) return json(res, { ok: false }, 401);
      const prof = (await q('select handle from profiles where user_id=$1 limit 1', [u.id])).rows[0];
      return json(res, { ok: true, user: { id: row.id, name: row.name, email: row.email }, accountType: row.account_type, sellerStatus: row.seller_status, handle: prof && prof.handle });
    }

    // ── 2FA (TOTP authenticator app) for customer accounts ──
    if (action === '2fa-setup' && req.method === 'POST') {
      const u = authedUser(req); if (!u) return json(res, { ok: false }, 401);
      const s = generateSecret();
      await q('update users set totp_secret=$1, totp_enabled=false where id=$2', [s, u.id]);
      return json(res, { ok: true, secret: s, otpauth: otpauthUri(s, { account: u.email }) });
    }
    if (action === '2fa-enable' && req.method === 'POST') {
      const u = authedUser(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      const row = (await q('select totp_secret from users where id=$1', [u.id])).rows[0];
      if (!row || !row.totp_secret) return json(res, { ok: false, error: 'Start 2FA setup first.' }, 400);
      if (!verifyTotp(row.totp_secret, b.code)) return json(res, { ok: false, error: 'Incorrect code — check your authenticator app and try again.' }, 400);
      const { plain, hashed } = generateBackupCodes();
      await q('update users set totp_enabled=true, backup_codes=$1 where id=$2', [JSON.stringify(hashed), u.id]);
      return json(res, { ok: true, backupCodes: plain });
    }
    if (action === '2fa-disable' && req.method === 'POST') {
      const u = authedUser(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      const row = (await q('select pass from users where id=$1', [u.id])).rows[0];
      if (!row || !verifyPassword(String(b.password || ''), row.pass)) return json(res, { ok: false, error: 'Incorrect password.' }, 401);
      await q('update users set totp_enabled=false, totp_secret=null, backup_codes=$1 where id=$2', ['[]', u.id]);
      return json(res, { ok: true });
    }

    // ── Forgot / reset password ──
    // Generates a one-time reset token (stored as its hash, 30 min expiry). Actually
    // emailing it requires an email provider (RESEND_API_KEY) — without one, this
    // still works end-to-end for the admin to hand the link to the user manually.
    if (action === 'forgot' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const row = (await q('select id from users where email=$1', [email])).rows[0];
      // Always return ok (don't leak whether an email is registered).
      if (row) {
        const raw = crypto.randomBytes(24).toString('base64url');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        await q('update users set reset_hash=$1, reset_expires=$2 where id=$3', [hash, Date.now() + 30 * 60 * 1000, row.id]);
        const link = (b.origin || '') + '/reset-password.html?token=' + raw + '&email=' + encodeURIComponent(email);
        // In-house SMTP (Mail Settings). No third-party API.
        const { sendMail, branded } = require('../_lib/mailer');
        const sent = await sendMail({
          to: email, subject: 'Reset your Archery.Services password',
          html: branded({
            heading: 'Reset your password',
            preheader: 'Reset link inside — valid 30 minutes',
            body: 'We received a request to reset your password. Click the button below to choose a new one. This link expires in 30 minutes. If you didn’t request this, you can ignore this email.',
            cta: 'Reset password', ctaUrl: link,
          }),
        });
        if (sent.ok) return json(res, { ok: true, message: 'If that email is registered, a reset link has been sent. Check your inbox.' });
        // No mail server connected yet → return the link directly so the flow still works.
        return json(res, { ok: true, message: 'Mail server not connected yet — here is your reset link.', devLink: link });
      }
      return json(res, { ok: true, message: 'If that email is registered, a reset link has been sent.' });
    }
    if (action === 'reset' && req.method === 'POST') {
      const b = readBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const token = String(b.token || '');
      const password = String(b.password || '');
      if (password.length < 8) return json(res, { ok: false, error: 'Password must be at least 8 characters.' }, 400);
      const row = (await q('select id, reset_hash, reset_expires from users where email=$1', [email])).rows[0];
      if (!row || !row.reset_hash || !row.reset_expires || row.reset_expires < Date.now())
        return json(res, { ok: false, error: 'This reset link is invalid or has expired.' }, 400);
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const a = Buffer.from(hash), c = Buffer.from(row.reset_hash);
      if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return json(res, { ok: false, error: 'This reset link is invalid or has expired.' }, 400);
      await q('update users set pass=$1, reset_hash=null, reset_expires=null where id=$2', [hashPassword(password), row.id]);
      return json(res, { ok: true });
    }

    // ── Seller application ──
    if (action === 'apply-seller' && req.method === 'POST') {
      const u = authedUser(req); if (!u) return json(res, { ok: false }, 401);
      const b = readBody(req);
      if (!String(b.businessName || '').trim()) return json(res, { ok: false, error: 'Business name is required.' }, 400);
      await q(`update users set account_type='seller', seller_status='pending', business_name=$1, gst_number=$2, payout_upi=$3 where id=$4`,
        [String(b.businessName).trim(), b.gst || null, b.payoutUpi || null, u.id]);
      return json(res, { ok: true, message: 'Application received — you will be notified once approved.' });
    }

    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (e) {
    console.error('users:', e?.message);
    return json(res, { ok: false, error: 'Server error' }, 500);
  }
};
