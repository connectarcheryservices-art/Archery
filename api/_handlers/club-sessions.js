// /api/club-sessions — a club's practice sessions + attendance (migration 039).
//   GET    ?clubId=N               list sessions for a club, with attendance counts
//   GET    /:id                    one session + full roster/attendance detail
//   POST   {clubId, title, sessionDate, startTime?, endTime?, coachUserId?, notes?}
//   PUT    /:id  {title?, sessionDate?, startTime?, endTime?, coachUserId?, notes?}
//   PUT    /:id/attendance  {records:[{memberId, status}]}   mark/update attendance
//   DELETE /:id
//
// Authorised by: global staff, OR the club's scoped admin (isClubAdmin), OR
// an active coach-role member of the SAME club (isCoachOfClub) — a coach
// can run sessions and take attendance for their own club without needing
// the admin's roster/join-approval powers (member-capability.js's own
// comment on isCoachOfClub explains the split). Never public — a roster's
// attendance is exactly the kind of thing club_members.js already treats
// as non-public (CLAUDE.md §1.8's spirit: a minor's practice attendance is
// not something to expose beyond the people running the club).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');
const { isClubAdmin, isCoachOfClub } = require('../_lib/member-capability');

const ATTENDANCE_STATUSES = ['present', 'absent', 'excused'];

async function requireStaffClubAdminOrCoach(req, clubId) {
  const staff = await checkAdmin(req);
  if (staff) return staff;
  const member = await authedUserChecked(req);
  if (!member) return null;
  if (await isClubAdmin(member.id, clubId)) return { role: 'member:club-admin', sid: member.id, name: member.name };
  if (await isCoachOfClub(member.id, clubId)) return { role: 'member:club-coach', sid: member.id, name: member.name };
  return null;
}

function actorLabel(actor) { return actor.name || actor.username || 'owner'; }

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = req.query.id ? parseInt(req.query.id, 10) : null;
  const isAttendanceRoute = req.query.action === 'attendance';

  try {
    if (req.method === 'GET' && !id) {
      const clubId = parseInt(req.query.clubId, 10);
      if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);
      if (!(await requireStaffClubAdminOrCoach(req, clubId))) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select s.id, s.club_id, s.title, s.session_date, s.start_time, s.end_time, s.notes,
                s.coach_user_id, u.name as coach_name, s.created_by, s.created_at,
                count(a.id) filter (where a.status='present') as present_count,
                count(a.id) filter (where a.status='absent')  as absent_count,
                count(a.id) filter (where a.status='excused') as excused_count
           from club_sessions s
           left join users u on u.id = s.coach_user_id
           left join club_attendance a on a.session_id = s.id
          where s.club_id = $1
          group by s.id, u.name
          order by s.session_date desc, s.id desc`, [clubId])).rows;
      return json(res, rows.map(r => ({
        id: r.id, clubId: r.club_id, title: r.title, sessionDate: r.session_date,
        startTime: r.start_time, endTime: r.end_time, notes: r.notes,
        coachUserId: r.coach_user_id, coachName: r.coach_name, createdBy: r.created_by, createdAt: r.created_at,
        presentCount: Number(r.present_count), absentCount: Number(r.absent_count), excusedCount: Number(r.excused_count),
      })));
    }

    if (req.method === 'GET' && id) {
      const session = (await q('select * from club_sessions where id=$1', [id])).rows[0];
      if (!session) return json(res, { error: 'Not found' }, 404);
      if (!(await requireStaffClubAdminOrCoach(req, session.club_id))) return json(res, { error: 'Unauthorised' }, 401);
      // Full active roster, LEFT JOINed against any attendance already
      // marked for this session — an unmarked member shows status: null,
      // never defaulted to "present" or "absent" (that would be recording
      // a fact nobody actually observed — CLAUDE.md §1.1).
      const roster = (await q(
        `select cm.id as member_id, cm.name, cm.member_role, a.status, a.marked_by, a.marked_at
           from club_members cm
           left join club_attendance a on a.session_id = $1 and a.member_id = cm.id
          where cm.club_id = $2 and cm.status = 'active'
          order by cm.member_role, cm.name`, [id, session.club_id])).rows;
      return json(res, {
        id: session.id, clubId: session.club_id, title: session.title, sessionDate: session.session_date,
        startTime: session.start_time, endTime: session.end_time, notes: session.notes,
        coachUserId: session.coach_user_id, createdBy: session.created_by, createdAt: session.created_at,
        roster: roster.map(r => ({
          memberId: r.member_id, name: r.name, memberRole: r.member_role,
          status: r.status, markedBy: r.marked_by, markedAt: r.marked_at,
        })),
      });
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      const clubId = parseInt(b.clubId, 10);
      const title = String(b.title || '').trim().slice(0, 120);
      if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);
      if (!title) return json(res, { error: 'A session title is required.' }, 400);
      const club = (await q('select id from clubs where id=$1', [clubId])).rows[0];
      if (!club) return json(res, { error: 'That club does not exist.' }, 404);
      const actor = await requireStaffClubAdminOrCoach(req, clubId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const sessionDate = String(b.sessionDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return json(res, { error: 'A valid session date (YYYY-MM-DD) is required.' }, 400);
      const r = await q(
        `insert into club_sessions (club_id, title, session_date, start_time, end_time, coach_user_id, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [clubId, title, sessionDate, String(b.startTime || '').slice(0, 10) || null, String(b.endTime || '').slice(0, 10) || null,
         b.coachUserId ? parseInt(b.coachUserId, 10) : null, String(b.notes || '').slice(0, 1000) || null, actorLabel(actor)]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'club_sessions', resourceId: r.rows[0].id, after: { clubId, title, sessionDate } });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    if (id && req.method === 'PUT' && isAttendanceRoute) {
      const session = (await q('select id, club_id from club_sessions where id=$1', [id])).rows[0];
      if (!session) return json(res, { error: 'Not found' }, 404);
      const actor = await requireStaffClubAdminOrCoach(req, session.club_id);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const records = Array.isArray(b.records) ? b.records : [];
      if (!records.length) return json(res, { error: 'No attendance records provided.' }, 400);
      const label = actorLabel(actor);
      let written = 0;
      for (const rec of records) {
        const memberId = parseInt(rec.memberId, 10);
        const status = ATTENDANCE_STATUSES.includes(rec.status) ? rec.status : null;
        if (!memberId || !status) continue;
        // The member must actually belong to this session's club — never
        // trust a memberId the client sends without checking it's real.
        const owns = (await q('select 1 from club_members where id=$1 and club_id=$2', [memberId, session.club_id])).rows[0];
        if (!owns) continue;
        await q(
          `insert into club_attendance (session_id, member_id, status, marked_by)
           values ($1,$2,$3,$4)
           on conflict (session_id, member_id) do update set status=excluded.status, marked_by=excluded.marked_by, marked_at=now()`,
          [id, memberId, status, label]);
        written++;
      }
      await writeAudit({ req, actor, action: 'update', resourceType: 'club_attendance', resourceId: id, after: { recordsWritten: written } });
      return json(res, { ok: true, recordsWritten: written });
    }

    if (id && req.method === 'PUT') {
      const existing = (await q('select id, club_id, title, session_date from club_sessions where id=$1', [id])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);
      const actor = await requireStaffClubAdminOrCoach(req, existing.club_id);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const sets = [], vals = [];
      if (b.title !== undefined) { const t = String(b.title).trim().slice(0, 120); if (t) sets.push(`title=$${vals.push(t)}`); }
      if (b.sessionDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(b.sessionDate))) sets.push(`session_date=$${vals.push(b.sessionDate)}`);
      if (b.startTime !== undefined) sets.push(`start_time=$${vals.push(String(b.startTime || '').slice(0, 10) || null)}`);
      if (b.endTime !== undefined) sets.push(`end_time=$${vals.push(String(b.endTime || '').slice(0, 10) || null)}`);
      if (b.coachUserId !== undefined) sets.push(`coach_user_id=$${vals.push(b.coachUserId ? parseInt(b.coachUserId, 10) : null)}`);
      if (b.notes !== undefined) sets.push(`notes=$${vals.push(String(b.notes || '').slice(0, 1000) || null)}`);
      if (!sets.length) return json(res, { error: 'Nothing to update.' }, 400);
      vals.push(id);
      await q(`update club_sessions set ${sets.join(',')} where id=$${vals.length}`, vals);
      await writeAudit({ req, actor, action: 'update', resourceType: 'club_sessions', resourceId: id,
        before: { title: existing.title, sessionDate: existing.session_date }, after: b });
      return json(res, { ok: true });
    }

    if (id && req.method === 'DELETE') {
      const existing = (await q('select id, club_id, title from club_sessions where id=$1', [id])).rows[0];
      if (!existing) return json(res, { error: 'Not found' }, 404);
      const actor = await requireStaffClubAdminOrCoach(req, existing.club_id);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      await q('delete from club_sessions where id=$1', [id]);
      await writeAudit({ req, actor, action: 'delete', resourceType: 'club_sessions', resourceId: id, before: { title: existing.title } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('club-sessions:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
