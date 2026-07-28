// Club portal tests — CLAUDE.md §1.10 (auth is in scope) + §1.1/§1.4/§1.6.
// Drives the REAL handlers (crud.js via resource handlers, and club-members.js);
// only Postgres is stubbed. Each assertion maps to a constitution clause.
'use strict';
const { R, stubDb, call, check, section, report } = require('./helpers');

process.env.ADMIN_PASSWORD = 'club-portal-test-owner-password';

// ── in-memory stand-in ───────────────────────────────────────────────────
const DB = { clubs: [], members: [], users: [], failNext: false };
let lastSQL = [];
const reset = () => { DB.clubs = []; DB.members = []; DB.users = []; DB.failNext = false; lastSQL = []; };
reset();

stubDb(async (sql, params = []) => {
  lastSQL.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (DB.failNext) throw new Error('db down');

  // clubs (generic crud)
  if (s.startsWith('select * from clubs')) {
    // public list carries "active is not false"; admin list does not
    let rows = DB.clubs;
    if (s.includes('active is not false')) rows = rows.filter(c => c.active !== false);
    return { rows };
  }
  if (s.startsWith('insert into clubs')) {
    const row = { id: DB.clubs.length + 1 };
    // crud builds "insert into clubs (colA,colB,...) values ($1,$2,...)"
    const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(c => c.trim());
    cols.forEach((c, i) => row[c] = params[i]);
    DB.clubs.push(row);
    return { rows: [{ id: row.id }] };
  }
  if (s.startsWith('select * from clubs where id')) return { rows: DB.clubs.filter(c => c.id === params[0]) };

  // club_members
  if (s.startsWith('select id from clubs where id')) return { rows: DB.clubs.filter(c => c.id === params[0]).map(c => ({ id: c.id })) };
  if (s.startsWith('select id from users where email')) return { rows: DB.users.filter(u => u.email === params[0]).map(u => ({ id: u.id })) };
  if (s.startsWith('select id, club_id, user_id, name')) return { rows: DB.members.filter(m => m.club_id === params[0]) };
  if (s.startsWith('insert into club_members')) {
    const row = { id: DB.members.length + 1, club_id: params[0], user_id: params[1], name: params[2], email: params[3], discipline: params[4], member_role: params[5], status: 'active' };
    DB.members.push(row);
    return { rows: [{ id: row.id }] };
  }
  if (s.startsWith('update club_members')) return { rows: [] };
  if (s.startsWith('delete from club_members')) { DB.members = DB.members.filter(m => m.id !== params[params.length - 1]); return { rows: [] }; }
  return { rows: [] };
});

// resource handlers route table CRUD; club-members is its own handler.
const resource = require(R('api/_handlers/resource.js'));
const resourceId = require(R('api/_handlers/resource-id.js'));
const clubMembers = require(R('api/_handlers/club-members.js'));
const { adminToken } = require(R('api/_lib/auth.js'));
const OWNER = adminToken();

const clubsList  = (opts = {}) => call(resource,   { method: opts.method || 'GET', query: { resource: 'clubs' }, ...opts });
const clubCreate = (body, opts = {}) => call(resource, { method: 'POST', query: { resource: 'clubs' }, body, ...opts });

(async () => {
  section('§1.4 — default deny on writes; public read is open');
  reset();
  let r = await clubCreate({ name: 'Rec Club' });
  check(r.status === 401, 'POST /api/clubs with no token → 401');
  r = await clubsList();
  check(r.status === 200 && Array.isArray(r.body), 'GET /api/clubs with no token → 200 array (public directory)');
  r = await call(clubMembers, { method: 'GET', query: { clubId: 1 } });
  check(r.status === 401, 'GET /api/club-members with no token → 401 (roster is never public, §1.8)');
  r = await call(clubMembers, { method: 'POST', body: { clubId: 1, name: 'X' } });
  check(r.status === 401, 'POST /api/club-members with no token → 401');

  section('§1.1 — no fabricated data');
  reset();
  r = await clubsList();
  check(r.status === 200 && r.body.length === 0, 'empty clubs table → [] (no seed rows)');
  DB.failNext = true;
  r = await clubsList();
  check(r.status === 503 && r.body && r.body.unavailable, 'DB unreachable → 503 {unavailable} (no fallback fiction)');
  DB.failNext = false;

  section('allow-list — a client cannot set arbitrary columns');
  reset();
  DB.clubs.push({ id: 99 }); // so id collision would be visible
  DB.clubs.length = 0;
  r = await clubCreate({ name: 'Allowed', active: true, id: 999, application_id: 7, evil: 'x', region: 'Asia' }, { token: OWNER });
  check(r.status === 200 && r.body.ok, 'admin can create a club');
  const insert = lastSQL.find(x => x.sql.toLowerCase().startsWith('insert into clubs'));
  const cols = insert.sql.slice(insert.sql.indexOf('(') + 1, insert.sql.indexOf(')')).split(',').map(c => c.trim());
  check(cols.includes('name') && cols.includes('active') && cols.includes('region'), 'allowed columns (name, active, region) are inserted');
  check(!cols.includes('id'), 'id is NOT settable by the client');
  check(!cols.includes('application_id'), 'application_id is NOT settable by the client (provenance is server-controlled)');
  check(!cols.includes('evil'), 'an unknown column is dropped');

  section('public visibility filter');
  reset();
  DB.clubs.push({ id: 1, name: 'Shown', active: true }, { id: 2, name: 'Hidden', active: false });
  r = await clubsList();
  check(r.body.length === 1 && r.body[0].name === 'Shown', 'public list hides inactive clubs');
  r = await clubsList({ token: OWNER });
  check(r.body.length === 2, 'admin list shows inactive clubs too');

  section('club-members — scoping (federation-members pattern)');
  reset();
  DB.clubs.push({ id: 5, name: 'Club Five', active: true });
  r = await call(clubMembers, { method: 'POST', token: OWNER, body: { clubId: 5, name: 'Asha', discipline: 'recurve', memberRole: 'coach' } });
  check(r.status === 200 && r.body.ok, 'admin adds a member to club 5');
  check(DB.members[0].club_id === 5, 'the member is scoped to club_id=5');
  check(DB.members[0].user_id === null, 'roster-only: no platform account required (member added without a users row)');
  r = await call(clubMembers, { method: 'POST', token: OWNER, body: { name: 'NoClub' } });
  check(r.status === 400, 'missing clubId → 400');
  r = await call(clubMembers, { method: 'POST', token: OWNER, body: { clubId: 5, name: '' } });
  check(r.status === 400, 'empty name → 400');
  r = await call(clubMembers, { method: 'POST', token: OWNER, body: { clubId: 404, name: 'Ghost' } });
  check(r.status === 404, 'member for a non-existent club → 404 (no orphans)');

  section('club-members — a matching email links the platform account');
  reset();
  DB.clubs.push({ id: 5, name: 'Club Five', active: true });
  DB.users.push({ id: 42, email: 'linked@x.com' });
  r = await call(clubMembers, { method: 'POST', token: OWNER, body: { clubId: 5, name: 'Linked', email: 'linked@x.com' } });
  check(DB.members[0].user_id === 42 && r.body.linked === true, 'a member whose email matches a user is linked to that account');

  section('club-members — GET is scoped, DELETE works');
  reset();
  DB.clubs.push({ id: 5, name: 'C', active: true });
  DB.members.push({ id: 1, club_id: 5, user_id: null, name: 'A', member_role: 'archer', status: 'active' });
  r = await call(clubMembers, { method: 'GET', token: OWNER, query: { clubId: 5 } });
  check(r.status === 200 && r.body.length === 1, 'GET ?clubId=5 lists that club’s members');
  const getSQL = lastSQL.find(x => x.sql.toLowerCase().startsWith('select id, club_id'));
  check(getSQL && getSQL.params[0] === 5, 'the list query is parameterised on club_id (=5)');
  r = await call(clubMembers, { method: 'DELETE', token: OWNER, query: { id: '1' } });
  check(r.status === 200 && r.body.ok, 'DELETE /api/club-members/1 removes the member');

  section('§1.6 — creating a club charges nothing');
  reset();
  DB.clubs.length = 0;
  await clubCreate({ name: 'Free Pilot' }, { token: OWNER });
  await call(clubMembers, { method: 'POST', token: OWNER, body: { clubId: 1, name: 'M' } }).catch(() => {});
  const touchedMoney = lastSQL.some(x => /insert into orders|razorpay|payment/i.test(x.sql));
  check(!touchedMoney, 'no order, no Razorpay, no payment path touched — onboarding a club is free');

  process.exit(report() === 0 ? 0 : 1);
})();
