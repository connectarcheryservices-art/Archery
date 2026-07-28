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
const { q } = require('../_lib/db');

const ROLES = ['archer', 'coach', 'official'];
const DIVISIONS = ['', 'recurve', 'compound', 'barebow'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // §1.4 default-deny: a roster is not public.
  const actor = checkAdmin(req);
  if (!actor) return json(res, { error: 'Unauthorised' }, 401);

  const id = req.query.id;
  try {
    if (req.method === 'GET') {
      const clubId = parseInt(req.query.clubId || req.query.club, 10);
      if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);
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

      // The club must exist — no orphan members.
      const club = (await q('select id from clubs where id=$1', [clubId])).rows[0];
      if (!club) return json(res, { error: 'That club does not exist.' }, 404);

      const role = ROLES.includes(b.memberRole) ? b.memberRole : 'archer';
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
        [clubId, userId, name, email, discipline, role]);
      return json(res, { ok: true, id: r.rows[0].id, linked: userId != null });
    }

    if (id && req.method === 'PUT') {
      const b = readBody(req);
      const sets = [], vals = [];
      if (b.status !== undefined) { sets.push(`status=$${vals.push(b.status === 'inactive' ? 'inactive' : 'active')}`); }
      if (b.discipline !== undefined && DIVISIONS.includes(b.discipline)) { sets.push(`discipline=$${vals.push(b.discipline)}`); }
      if (b.memberRole !== undefined && ROLES.includes(b.memberRole)) { sets.push(`member_role=$${vals.push(b.memberRole)}`); }
      if (!sets.length) return json(res, { error: 'Nothing to update.' }, 400);
      vals.push(parseInt(id, 10));
      await q(`update club_members set ${sets.join(',')} where id=$${vals.length}`, vals);
      return json(res, { ok: true });
    }

    if (id && req.method === 'DELETE') {
      await q('delete from club_members where id=$1', [parseInt(id, 10)]);
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('club-members:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
