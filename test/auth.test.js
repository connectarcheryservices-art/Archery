// Auth tests — CLAUDE.md §1.10 ("tests before merge on money, auth, and scoring").
// Covers THREAT_MODEL T5: brute force, timing, enumeration, owner 2FA.
//
// These drive the REAL handlers. Only Postgres is stubbed (test/helpers.js), so
// what is exercised here is the code that ships.
'use strict';
const { R, stubDb, call, check, section, report } = require('./helpers');

process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple-owner';
const PW = process.env.ADMIN_PASSWORD;

// ── in-memory stand-in for the tables the login path touches ────────────────
const DB = { owner_security: null, login_attempts: [], staff: [] };
stubDb(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (s.startsWith('select * from owner_security')) return { rows: DB.owner_security ? [DB.owner_security] : [] };
  if (s.startsWith('insert into owner_security')) { DB.owner_security = { id: 1, totp_secret: params[0], totp_enabled: false, backup_codes: [] }; return { rows: [] }; }
  if (s.startsWith('update owner_security set totp_enabled=true')) { DB.owner_security.totp_enabled = true; DB.owner_security.backup_codes = JSON.parse(params[0]); return { rows: [] }; }
  if (s.startsWith('update owner_security set backup_codes')) { DB.owner_security.backup_codes = JSON.parse(params[0]); return { rows: [] }; }
  if (s.startsWith('update owner_security set totp_enabled=false')) { DB.owner_security = { id: 1, totp_secret: null, totp_enabled: false, backup_codes: [] }; return { rows: [] }; }
  if (s.startsWith('select count(*)::int n')) {
    const n = DB.login_attempts.filter(a => a.key === params[0] && !a.ok).length;
    return { rows: [{ n, last: n ? new Date().toISOString() : null }] };
  }
  if (s.startsWith('insert into login_attempts')) { DB.login_attempts.push({ key: params[0], ok: params[2] }); return { rows: [] }; }
  if (s.startsWith('select * from staff where lower(username)')) return { rows: DB.staff.filter(x => x.username.toLowerCase() === params[0]) };
  if (s.startsWith('select * from staff where id')) return { rows: DB.staff.filter(x => x.id === params[0]) };
  return { rows: [] };
});

const login = require(R('api/_handlers/admin-login.js'));
const staff = require(R('api/_handlers/staff.js'));
const { adminToken, hashPassword } = require(R('api/_lib/auth.js'));
const { totp } = require(R('api/_lib/totp.js'));

const clearLimits = () => { DB.login_attempts.length = 0; };

(async () => {
  const OWNER = adminToken();

  // ─────────────────────────────────────────────────────────────────────────
  section('T5.1 — brute force is rate limited');
  clearLimits();
  let blockedAt = null;
  for (let i = 1; i <= 12; i++) {
    const r = await call(login, { body: { password: 'guess-' + i } });
    if (r.status === 429 && blockedAt === null) blockedAt = i;
  }
  check(blockedAt !== null && blockedAt <= 10, `brute force blocked (429) at attempt ${blockedAt} — was unlimited`);
  const r429 = await call(login, { body: { password: PW } });
  check(r429.status === 429, 'the CORRECT password is still refused while limited — no bypass');
  check(!!r429.headers['retry-after'], 'Retry-After header set');

  section('T5.1 — the limiter fails CLOSED');
  {
    const restore = stubDb(async () => { throw new Error('db down'); });
    delete require.cache[require.resolve(R('api/_lib/ratelimit.js'))];
    delete require.cache[require.resolve(R('api/_handlers/admin-login.js'))];
    const loginBroken = require(R('api/_handlers/admin-login.js'));
    const r = await call(loginBroken, { body: { password: PW } });
    check(r.status === 429, 'if the counter is unreachable, login refuses rather than allowing unlimited guesses');
    restore();
    delete require.cache[require.resolve(R('api/_lib/ratelimit.js'))];
    delete require.cache[require.resolve(R('api/_handlers/admin-login.js'))];
  }
  // re-require against the good stub for the remaining tests
  const login2 = require(R('api/_handlers/admin-login.js'));

  section('T5.2 — owner password compare');
  clearLimits();
  let r = await call(login2, { body: { password: PW } });
  check(r.body.ok === true && !!r.body.token, 'correct owner password signs in');
  clearLimits();
  r = await call(login2, { body: { password: PW + 'x' } });
  check(r.body.ok === false, 'a longer password with the right prefix is rejected');
  clearLimits();
  r = await call(login2, { body: { password: '' } });
  check(r.body.ok === false, 'empty password rejected');
  clearLimits();
  r = await call(login2, { body: {} });
  check(r.body.ok === false, 'missing password rejected (no undefined === undefined)');

  section('T5.4 — username enumeration');
  DB.staff.push({ id: 1, username: 'realstaff', name: 'Real', role: 'editor', active: true, pass: hashPassword('staff-password-here'), totp_enabled: false });
  const timeIt = async (username) => {
    const t0 = process.hrtime.bigint();
    clearLimits();
    await call(login2, { body: { username, password: 'wrong-password' } });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  let real = 0, fake = 0;
  const N = 5;
  for (let i = 0; i < N; i++) { real += await timeIt('realstaff'); fake += await timeIt('nosuchuser'); }
  real /= N; fake /= N;
  const delta = Math.abs(real - fake);
  const ratio = delta / Math.max(real, fake);
  check(ratio < 0.25, `existing vs nonexistent user indistinguishable by timing (${real.toFixed(0)}ms vs ${fake.toFixed(0)}ms, delta ${delta.toFixed(1)}ms)`);
  clearLimits();
  const a = await call(login2, { body: { username: 'realstaff', password: 'wrong' } });
  clearLimits();
  const b = await call(login2, { body: { username: 'nosuchuser', password: 'wrong' } });
  check(a.body.error === b.body.error, 'identical error message for both — no enumeration by response');

  section('T5.3 — owner 2FA enrollment');
  clearLimits();
  r = await call(staff, { query: { id: 'me', action: '2fa-setup' }, token: OWNER });
  check(r.body.ok === true && !!r.body.secret, 'owner can enrol 2FA (previously refused with a 400)');
  const secret = r.body.secret;
  check(/^[A-Z2-7]{32}$/.test(secret), 'secret is base32');

  r = await call(staff, { query: { id: 'me', action: '2fa-enable' }, token: OWNER, body: { code: '000000' } });
  check(r.body.ok === false, 'a wrong code does not enable 2FA');

  r = await call(staff, { query: { id: 'me', action: '2fa-enable' }, token: OWNER, body: { code: totp(secret) } });
  check(r.body.ok === true, 'a correct code enables 2FA');
  const backups = r.body.backupCodes || [];
  check(backups.length === 10, `10 backup codes issued (got ${backups.length})`);
  check(JSON.stringify(DB.owner_security.backup_codes).indexOf(backups[0]) === -1, 'backup codes are stored hashed, never plaintext');

  section('T5.3 — owner 2FA is enforced at login');
  clearLimits();
  r = await call(login2, { body: { password: PW } });
  check(r.body.ok === false && r.body.needsTotp === true, 'the master password ALONE no longer signs the owner in');
  clearLimits();
  r = await call(login2, { body: { password: PW, totp: '000000' } });
  check(r.body.ok === false, 'wrong TOTP rejected');
  clearLimits();
  r = await call(login2, { body: { password: PW, totp: totp(secret) } });
  check(r.body.ok === true && !!r.body.token, 'password + TOTP signs in');
  clearLimits();
  r = await call(login2, { body: { password: 'wrong', totp: totp(secret) } });
  check(r.body.ok === false, 'a valid TOTP does not rescue a wrong password');

  section('T5.3 — backup codes are single use');
  clearLimits();
  r = await call(login2, { body: { password: PW, totp: backups[0] } });
  check(r.body.ok === true, 'a backup code works as a second factor');
  clearLimits();
  r = await call(login2, { body: { password: PW, totp: backups[0] } });
  check(r.body.ok === false, 'the same backup code is refused the second time');

  section('T5.3 — 2FA cannot be stripped with a stolen token alone');
  r = await call(staff, { query: { id: 'me', action: '2fa-disable' }, token: OWNER, body: { code: '000000' } });
  check(r.body.ok === false, 'disable requires a live code, not just the session token');
  r = await call(staff, { query: { id: 'me', action: '2fa-disable' }, token: OWNER, body: { code: totp(secret) } });
  check(r.body.ok === true, 'owner with a live code can turn 2FA off');

  section('authorisation');
  r = await call(staff, { query: { id: 'me', action: '2fa-setup' } });
  check(r.status === 401, 'anonymous cannot start owner 2FA setup');
  r = await call(staff, { query: { id: 'me', action: '2fa-setup' }, token: 'not-a-real-token' });
  check(r.status === 401, 'a forged token is rejected');

  process.exit(report() === 0 ? 0 : 1);
})();
