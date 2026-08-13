// /api/federation-roster?federationId=N — real, read-only membership sync
// for a federation: an aggregated roster of every member of every club
// under that federation node (migration 026's hierarchy). Closes the
// "member sync" feature the district/state/national tiers have advertised
// (checkout-fee.js) since it was named and never built.
//
// Never public — a federation-wide roster is a bigger PII surface than any
// single club's (club-members.js's own "NEVER public" rule, scaled up).
// Authorised exactly like federation.js's write actions: staff, or an
// officer of this federation node OR any ancestor of it (a state officer
// can see every district beneath them; a district officer only their own).
'use strict';
const { cors, json } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { q } = require('../_lib/db');
const { isFederationOfficerOrAncestor, clubIdsUnderFederation } = require('../_lib/federation-lib');

async function requireStaffOrFederationOfficer(req, federationId) {
  const staff = await checkAdmin(req);
  if (staff) return staff;
  const member = await authedUserChecked(req);
  if (member && await isFederationOfficerOrAncestor(member.id, federationId)) {
    return { role: 'member:federation-officer', sid: member.id, name: member.name };
  }
  return null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);

  const federationId = parseInt(req.query.federationId, 10);
  if (!federationId) return json(res, { error: 'A federationId is required.' }, 400);

  try {
    const federation = (await q('select id, name, tier from federations where id=$1', [federationId])).rows[0];
    if (!federation) return json(res, { error: 'Not found' }, 404);
    if (!(await requireStaffOrFederationOfficer(req, federationId))) return json(res, { error: 'Unauthorised' }, 401);

    const clubIds = await clubIdsUnderFederation(federationId);
    if (!clubIds.length) {
      return json(res, {
        federationId, federationName: federation.name, federationTier: federation.tier,
        clubs: [], membership: { total: 0, active: 0, coaches: 0, officials: 0 },
        byDiscipline: [], byClub: [],
      });
    }

    const [clubs, membership, byDiscipline, byClub] = await Promise.all([
      q('select id, name, city, region from clubs where id = any($1) order by name', [clubIds]),
      q(`select count(*)::int total,
                count(*) filter (where status='active')::int active,
                count(*) filter (where member_role='coach')::int coaches,
                count(*) filter (where member_role='official')::int officials,
                count(*) filter (where added_at > now() - interval '30 days')::int joined_30d
           from club_members where club_id = any($1)`, [clubIds]),
      q(`select coalesce(nullif(discipline,''),'Unspecified') discipline, count(*)::int n
           from club_members where club_id = any($1) and status='active' group by 1 order by n desc`, [clubIds]),
      q(`select c.id club_id, c.name club_name, count(cm.id)::int member_count
           from clubs c left join club_members cm on cm.club_id = c.id and cm.status='active'
          where c.id = any($1) group by c.id, c.name order by member_count desc`, [clubIds]),
    ]);

    const m = membership.rows[0];
    return json(res, {
      federationId, federationName: federation.name, federationTier: federation.tier,
      clubs: clubs.rows.map(c => ({ id: c.id, name: c.name, city: c.city, region: c.region })),
      membership: {
        total: m.total, active: m.active, coaches: m.coaches, officials: m.officials, joined30d: m.joined_30d,
      },
      byDiscipline: byDiscipline.rows.map(r => ({ discipline: r.discipline, count: r.n })),
      byClub: byClub.rows.map(r => ({ clubId: r.club_id, clubName: r.club_name, memberCount: r.member_count })),
    });
  } catch (e) {
    console.error('federation-roster:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
