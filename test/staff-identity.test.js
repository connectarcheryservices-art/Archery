// Staff identity: created as a local part, signs in with either form.
'use strict';
const { R, stubDb, call, check, section, report } = require('./helpers');

process.env.ADMIN_PASSWORD = 'owner-master-password-for-test';

const DB = { staff: [], attempts: [] };
stubDb(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (s.startsWith('select * from staff where lower(username)')) return { rows: DB.staff.filter(x => x.username === params[0]) };
  if (s.startsWith('select 1 from staff where lower(username)')) return { rows: DB.staff.filter(x => x.username === params[0]).map(() => ({ '?column?': 1 })) };
  if (s.startsWith('select * from staff where id')) return { rows: DB.staff.filter(x => x.id === params[0]) };
  if (s.startsWith('select * from staff order by')) return { rows: DB.staff };
  if (s.startsWith('insert into staff')) {
    const row = { id: DB.staff.length + 1, name: params[0], username: params[1], email: params[2], pass: params[3], role: params[4], active: true };
    DB.staff.push(row); return { rows: [{ id: row.id }] };
  }
  if (s.startsWith('select count(*)::int n')) return { rows: [{ n: DB.attempts.filter(a => a.key === params[0] && !a.ok).length, last: null }] };
  if (s.startsWith('insert into login_attempts')) { DB.attempts.push({ key: params[0], ok: params[2] }); return { rows: [] }; }
  if (s.startsWith('update staff set last_login')) return { rows: [] };
  if (s.startsWith('select * from owner_security')) return { rows: [] };
  return { rows: [] };
});

const staff = require(R('api/_handlers/staff.js'));
const login = require(R('api/_handlers/admin-login.js'));
const { adminToken, normalizeStaffUsername, staffLoginId } = require(R('api/_lib/auth.js'));
const OWNER = adminToken();
const clear = () => { DB.attempts.length = 0; };

(async () => {
  section('creating staff with a work identity');
  let r = await call(staff, { method: 'POST', token: OWNER, body: { name: 'Sid Prasad', username: 'Sid@Archery.Services', password: 'a-good-password', role: 'editor' } });
  check(r.body.ok === true, 'owner can create a staff account using the full address');
  check(DB.staff[0].username === 'sid', `stored as the local part only ("${DB.staff[0].username}") — existing accounts unaffected`);

  r = await call(staff, { method: 'GET', token: OWNER });
  check(r.body[0].loginId === 'sid@archery.services', `listed with the full sign-in address (${r.body[0].loginId})`);
  check(typeof r.body[0].id === 'number', 'each account has a numeric staff ID (#' + r.body[0].id + ')');

  section('signing in — both forms must work');
  clear();
  r = await call(login, { body: { username: 'sid@archery.services', password: 'a-good-password' } });
  check(r.body.ok === true, 'signs in with "sid@archery.services"');
  clear();
  r = await call(login, { body: { username: 'sid', password: 'a-good-password' } });
  check(r.body.ok === true, 'signs in with just "sid" (backward compatible)');
  clear();
  r = await call(login, { body: { username: '  SID@ARCHERY.SERVICES ', password: 'a-good-password' } });
  check(r.body.ok === true, 'case and whitespace tolerant');

  section('a foreign domain is not silently accepted');
  check(normalizeStaffUsername('sid@gmail.com') !== 'sid', 'sid@gmail.com does NOT resolve to sid');
  clear();
  r = await call(login, { body: { username: 'sid@gmail.com', password: 'a-good-password' } });
  check(r.body.ok === false, 'so signing in with a foreign domain is rejected');

  section('duplicates');
  r = await call(staff, { method: 'POST', token: OWNER, body: { name: 'Other', username: 'sid', password: 'another-password' } });
  check(r.status === 409, 'the same address cannot be taken twice');
  r = await call(staff, { method: 'POST', token: OWNER, body: { name: 'Other', username: 'SID@archery.services', password: 'another-password' } });
  check(r.status === 409, 'nor via a different spelling of the same address');

  check(staffLoginId('') === '', 'an empty username yields no address (no bare "@archery.services")');

  process.exit(report() === 0 ? 0 : 1);
})();
