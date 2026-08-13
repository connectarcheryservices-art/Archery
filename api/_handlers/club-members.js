// /api/club-members — a club's membership roster. Admin-only.
//   GET  ?clubId=N        list the members of club N
//   POST {clubId, name, email?, discipline?, memberRole?}   add a member
//   PUT  /:id  {status?, discipline?, memberRole?}           update a member
//   DELETE /:id                                              remove a member
//
// Modelled on federation-members.js, with two deliberate differences:
//   1. It is a ROSTER — a member does NOT need a pre-existing platform account
//      (a club knows its archers before they sign up online). If the email
//      happens to match a users row we link it; otherwise user_id stays null.
//   2. Members are NEVER public (CLAUDE.md §1.8): every method requires an admin
//      token. discover.html shows clubs, never their member lists.
//
// No date of birth / age is accepted or stored — see migration 013 (DPDP s.9(3)).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');
const { isClubAdmin } = require('../_lib/member-capability');

const ROLES = ['archer', 'coach', 'official', 'admin'];
const DIVISIONS = ['', 'recurve', 'compound', 'barebow'];

// Global staff, OR a club admin scoped to THIS club (migration 031) — a
// club admin manages their own roster without needing owner/manager/
// editor/support access to every club on the platform. Granting the
// 'admin' role itself stays staff-only (checked at the call site below) —
// self-service admin proliferation would defeat the point of scoping.
async function requireStaffOrClubAdmin(req, clubId) {
  const staff = await checkAdmin(req);
  if (staff) return staff;
  const member = await authedUserChecked(req);
  if (member && await isClubAdmin(member.id, clubId)) {
    return { role: 'member:club-admin', sid: member.id, name: member.name };
  }
  return null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = req.query.id;
  try {
    if (req.method === 'GET') {
      const clubId = parseInt(req.query.clubId || req.query.club, 10);
      if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);
      // §1.4 default-deny: a roster is not public, but a club admin can see
      // their own club's — not just global staff.
      if (!(await requireStaffOrClubAdmin(req, clubId))) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select id, club_id, user_id, name, email, discipline, member_role, status, added_at
           from club_members where club_id=$1 order by member_role, name`, [clubId])).rows;
      return json(res, rows.map(r => ({
        id: r.id, clubId: r.club_id, userId: r.user_id, name: r.name, email: r.email,
        discipline: r.discipline, memberRole: r.member_role, status: r.status, addedAt: r.added_at,
      })));
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      const clubId = parseInt(b.clubId, 10);
      const name = String(b.name || '').trim().slice(0, 120);
      if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);
      if (!name) return json(res, { error: 'A member name is required.' }, 400);

      // Fixed 2026-08-13 (audit finding): the club-existence lookup used to
      // run BEFORE auth, so an unauthenticated caller could probe arbitrary
      // clubIds and tell which exist from the 404-vs-401 response alone —
      // an enumeration oracle with no credential required. requireStaffOrClub
      // Admin() works fine against a nonexistent clubId (isClubAdmin just
      // returns false), so auth can — and now does — run first.
      const actor = await requireStaffOrClubAdmin(req, clubId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);

      // The club must exist — no orphan members.
      const club = (await q('select id from clubs where id=$1', [clubId])).rows[0];
      if (!club) return json(res, { error: 'That club does not exist.' }, 404);

      const requestedRole = ROLES.includes(b.memberRole) ? b.memberRole : 'archer';
      if (requestedRole === 'admin' && !(await checkAdmin(req))) {
        return json(res, { error: 'Only staff can grant the club-admin role.' }, 403);
      }
      const discipline = DIVISIONS.includes(b.discipline) ? b.discipline : '';
      const email = b.email ? String(b.email).trim().toLowerCase() : null;

      // Link a platform account if the email matches one; otherwise roster-only.
      let userId = null;
      if (email) {
        const u = (await q('select id from users where email=$1', [email])).rows[0];
        if (u) userId = u.id;
      }

      const r = await q(
        `insert into club_members (club_id, user_id, name, email, discipline, member_role)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [clubId, userId, name, email, discipline, requestedRole]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'club_members', resourceId: r.rows[0].id,
        after: { clubId, name, email, discipline, memberRole: requestedRole } });
      return json(res, { ok: true, id: r.rows[0].id, linked: userId != null });
    }

    if (id && req.method === 'PUT') {
      const existing = (await q('select id, club_id, status, discipline, member_role from club_members where id=$1', [parseInt(id, 10)])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);
      const actor = await requireStaffOrClubAdmin(req, existing.club_id);
      // Same shape as chat.js's fix (2026-08-13): the member row must be
      // looked up before auth can even be evaluated (its club_id is the
      // scope), so — unlike POST above — this lookup can't be deferred.
      // Returning the SAME 404 for "no such member" and "not authorised"
      // avoids turning that into an existence oracle for a roster this
      // codebase's own header comment says is "NEVER public" (CLAUDE.md §1.8).
      if (!actor) return json(res, { error: 'Not found' }, 404);
      const b = readBody(req);
      if (b.memberRole === 'admin' && !(await checkAdmin(req))) {
        return json(res, { error: 'Only staff can grant the club-admin role.' }, 403);
      }
      const sets = [], vals = [];
      if (b.status !== undefined) { sets.push(`status=$${vals.push(b.status === 'inactive' ? 'inactive' : 'active')}`); }
      if (b.discipline !== undefined && DIVISIONS.includes(b.discipline)) { sets.push(`discipline=$${vals.push(b.discipline)}`); }
      if (b.memberRole !== undefined && ROLES.includes(b.memberRole)) { sets.push(`member_role=$${vals.push(b.memberRole)}`); }
      if (!sets.length) return json(res, { error: 'Nothing to update.' }, 400);
      vals.push(parseInt(id, 10));
      await q(`update club_members set ${sets.join(',')} where id=$${vals.length}`, vals);
      await writeAudit({ req, actor, action: 'update', resourceType: 'club_members', resourceId: parseInt(id, 10),
        before: { status: existing.status, discipline: existing.discipline, memberRole: existing.member_role },
        after: { status: b.status, discipline: b.discipline, memberRole: b.memberRole } });
      return json(res, { ok: true });
    }

    if (id && req.method === 'DELETE') {
      const existing = (await q('select id, club_id, name, member_role from club_members where id=$1', [parseInt(id, 10)])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);
      const actor = await requireStaffOrClubAdmin(req, existing.club_id);
      // Same 404-not-401 reasoning as PUT above.
      if (!actor) return json(res, { error: 'Not found' }, 404);
      await q('delete from club_members where id=$1', [parseInt(id, 10)]);
      await writeAudit({ req, actor, action: 'delete', resourceType: 'club_members', resourceId: parseInt(id, 10),
        before: { name: existing.name, memberRole: existing.member_role } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('club-members:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
