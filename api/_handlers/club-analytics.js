// /api/club-analytics?clubId=N — real, read-only analytics for a club's own
// roster/attendance/competitive activity. Closes part of the "club analytics"
// feature promised (and never built — audited 2026-07-22) by the Club/Range
// tier in checkout-fee.js/pricing.html. All numbers are real SELECTs against
// club_members/club_sessions/club_attendance/athletes/entries — no synthetic
// counts, no invented percentages (CLAUDE.md §1.1).
//
// Authorised exactly like club-sessions.js: global staff, OR the club's
// scoped admin, OR a coach of THIS club. Never public — attendance/roster
// data is not something to expose beyond the people running the club.
'use strict';
const { cors, json } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { isClubAdmin, isCoachOfClub } = require('../_lib/member-capability');

async function requireStaffClubAdminOrCoach(req, clubId) {
  const staff = await checkAdmin(req);
  if (staff) return staff;
  const member = await authedUserChecked(req);
  if (!member) return null;
  if (await isClubAdmin(member.id, clubId)) return { role: 'member:club-admin', sid: member.id, name: member.name };
  if (await isCoachOfClub(member.id, clubId)) return { role: 'member:club-coach', sid: member.id, name: member.name };
  return null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);

  const clubId = parseInt(req.query.clubId, 10);
  if (!clubId) return json(res, { error: 'A clubId is required.' }, 400);

  try {
    const club = (await q('select id, name from clubs where id=$1', [clubId])).rows[0];
    if (!club) return json(res, { error: 'Not found' }, 404);
    if (!(await requireStaffClubAdminOrCoach(req, clubId))) return json(res, { error: 'Unauthorised' }, 401);

    const [membership, growth, byDiscipline, sessions, attendanceByMonth, memberAttendance, competitive] = await Promise.all([
      q(`select count(*)::int total,
                count(*) filter (where status='active')::int active,
                count(*) filter (where user_id is not null)::int linked_accounts,
                count(*) filter (where member_role='coach')::int coaches,
                count(*) filter (where member_role='official')::int officials,
                count(*) filter (where added_at > now() - interval '30 days')::int joined_30d
           from club_members where club_id=$1`, [clubId]),
      q(`select to_char(date_trunc('month', added_at),'Mon YYYY') m, count(*)::int n
           from club_members where club_id=$1 and added_at > now() - interval '6 months'
          group by 1, date_trunc('month', added_at) order by date_trunc('month', added_at)`, [clubId]),
      q(`select coalesce(nullif(discipline,''),'Unspecified') discipline, count(*)::int n
           from club_members where club_id=$1 and status='active' group by 1 order by n desc`, [clubId]),
      q(`select count(*)::int total,
                count(*) filter (where session_date > now() - interval '30 days')::int last_30d
           from club_sessions where club_id=$1`, [clubId]),
      q(`select to_char(date_trunc('month', s.session_date),'Mon YYYY') m,
                count(a.id) filter (where a.status='present')::int present,
                count(a.id) filter (where a.status='absent')::int absent,
                count(a.id) filter (where a.status='excused')::int excused
           from club_sessions s join club_attendance a on a.session_id=s.id
          where s.club_id=$1 and s.session_date > now() - interval '6 months'
          group by 1, date_trunc('month', s.session_date) order by date_trunc('month', s.session_date)`, [clubId]),
      q(`select cm.id member_id, cm.name,
                count(a.id) filter (where a.status='present')::int present,
                count(a.id) filter (where a.status='absent')::int absent
           from club_members cm join club_attendance a on a.member_id=cm.id
          where cm.club_id=$1 and cm.status='active'
          group by cm.id, cm.name
         having count(a.id) filter (where a.status in ('present','absent')) >= 3
            and (count(a.id) filter (where a.status='present'))::numeric /
                nullif(count(a.id) filter (where a.status in ('present','absent')),0) < 0.75
          order by (count(a.id) filter (where a.status='present'))::numeric /
                   nullif(count(a.id) filter (where a.status in ('present','absent')),0) asc
          limit 10`, [clubId]),
      q(`select count(distinct at.id)::int athletes,
                count(distinct e.event_category_id)::int categories_entered,
                count(distinct ev.tournament_id)::int tournaments,
                count(e.id)::int total_entries
           from athletes at
           left join entries e on e.athlete_id = at.id
           left join event_categories ec on ec.id = e.event_category_id
           left join events ev on ev.id = ec.event_id
          where at.club_id=$1`, [clubId]),
    ]);

    const m = membership.rows[0], s = sessions.rows[0], c = competitive.rows[0];
    return json(res, {
      clubId, clubName: club.name,
      membership: {
        total: m.total, active: m.active, linkedAccounts: m.linked_accounts,
        coaches: m.coaches, officials: m.officials, joined30d: m.joined_30d,
      },
      growthByMonth: growth.rows.map(r => ({ month: r.m, count: r.n })),
      byDiscipline: byDiscipline.rows.map(r => ({ discipline: r.discipline, count: r.n })),
      sessions: { total: s.total, last30d: s.last_30d },
      attendanceByMonth: attendanceByMonth.rows.map(r => ({
        month: r.m, present: r.present, absent: r.absent, excused: r.excused,
        rate: (r.present + r.absent) > 0 ? Math.round((r.present / (r.present + r.absent)) * 100) : null,
      })),
      lowAttendance: memberAttendance.rows.map(r => ({
        memberId: r.member_id, name: r.name, present: r.present, absent: r.absent,
        rate: Math.round((r.present / (r.present + r.absent)) * 100),
      })),
      competitive: {
        athletesLinked: c.athletes, tournamentsEntered: c.tournaments,
        categoriesEntered: c.categories_entered, totalEntries: c.total_entries,
      },
    });
  } catch (e) {
    console.error('club-analytics:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
