// /api/members/<action> — the capability surface for platform MEMBERS
// (athletes, coaches, officials), as opposed to /api/staff (your employees).
// CLAUDE.md §1.4/§1.5: every write here is authorised by a specific
// capability and writes an audit row. See api/_lib/member-capability.js for
// the design principle: a self-declared label never grants access to
// someone else's data — only mutual consent (coach-athlete) or explicit
// staff approval (claims, certifications) does.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { q } = require('../_lib/db');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { writeAudit } = require('../_lib/audit');

async function requireMember(req) {
  const claims = await authedUserChecked(req);
  if (!claims) return null;
  const row = (await q('select id, name, email, member_role from users where id=$1', [claims.id])).rows[0];
  return row || null;
}
async function requireStaff(req) {
  const actor = await checkAdmin(req);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) return null;
  return actor;
}
const memberActor = (member, role) => ({ role: 'member:' + role, sid: member.id, name: member.name });
async function ownAthleteId(userId) {
  const row = (await q('select id from athletes where user_id=$1', [userId])).rows[0];
  return row ? row.id : null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    // ── MY STATUS: what can I do right now? (authed member) ──
    if (action === 'my-status') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const athlete = (await q('select id, name from athletes where user_id=$1', [member.id])).rows[0] || null;
      const coaching = (await q(
        `select ca.id, ca.athlete_id, ca.status, ca.requested_by, a.name as athlete_name
           from coach_athletes ca join athletes a on a.id = ca.athlete_id
          where ca.coach_user_id=$1 order by ca.created_at desc`, [member.id])).rows;
      const myCoaches = athlete ? (await q(
        `select ca.id, ca.coach_user_id, ca.status, ca.requested_by, u.name as coach_name
           from coach_athletes ca join users u on u.id = ca.coach_user_id
          where ca.athlete_id=$1 order by ca.created_at desc`, [athlete.id])).rows : [];
      const certification = (await q('select level, issuing_body, status, approved_at from official_certifications where user_id=$1', [member.id])).rows[0] || null;
      const assignments = (await q(
        `select eo.event_id, eo.role, ev.name as event_name from event_officials eo
           join events ev on ev.id = eo.event_id where eo.user_id=$1 order by eo.created_at desc`, [member.id])).rows;
      return json(res, { ok: true, memberRole: member.member_role, athlete, coaching, myCoaches, certification, assignments });
    }

    // ── BECOME-ATHLETE: create MY OWN athletes row (instant, safe — no
    // identity conflict possible for a brand-new row). Idempotent. ──
    if (action === 'become-athlete' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const existing = await ownAthleteId(member.id);
      if (existing) return json(res, { ok: true, athleteId: existing, alreadyLinked: true });
      const b = readBody(req);
      const name = String(b.name || member.name || '').trim().slice(0, 120) || member.name;
      const r = await q(
        `insert into athletes (name, state, discipline, active, user_id) values ($1,$2,$3,true,$4) returning id`,
        [name, String(b.state || '').slice(0, 80), String(b.discipline || '').slice(0, 40), member.id]);
      await q('update users set member_role=$1 where id=$2', ['athlete', member.id]);
      await writeAudit({ req, actor: memberActor(member, 'athlete'), action: 'create', resourceType: 'athletes', resourceId: r.rows[0].id, after: { name, userId: member.id, self: true } });
      return json(res, { ok: true, athleteId: r.rows[0].id });
    }

    // ── CLAIM-ATHLETE: request to link ME to an EXISTING (pre-populated)
    // athletes row — needs staff approval (approve-claim), since that row
    // could genuinely belong to someone else. ──
    if (action === 'claim-athlete' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const athleteId = parseInt(b.athleteId, 10);
      if (!athleteId) return json(res, { error: 'athleteId is required' }, 400);
      const athlete = (await q('select id, user_id from athletes where id=$1', [athleteId])).rows[0];
      if (!athlete) return json(res, { error: 'Unknown athlete' }, 404);
      if (athlete.user_id) return json(res, { ok: false, error: 'This athlete profile is already linked to an account.' }, 409);
      if (await ownAthleteId(member.id)) return json(res, { ok: false, error: 'Your account is already linked to an athlete profile.' }, 409);
      const already = (await q('select id from athlete_claim_requests where athlete_id=$1 and status=$2', [athleteId, 'pending'])).rows[0];
      if (already) {
        const mine = (await q('select 1 from athlete_claim_requests where id=$1 and user_id=$2', [already.id, member.id])).rows[0];
        if (mine) return json(res, { ok: true, claimId: already.id, alreadyPending: true });
        return json(res, { ok: false, error: 'This athlete profile already has a pending claim.' }, 409);
      }
      // One outstanding claim per ACCOUNT, not just per athlete — otherwise
      // a single account can pending-squat every unclaimed athlete profile
      // platform-wide (athlete_claim_pending_idx only limits per-athlete;
      // caught by adversarial security review, 2026-08-12).
      const myPending = (await q(`select id, athlete_id from athlete_claim_requests where user_id=$1 and status='pending'`, [member.id])).rows[0];
      if (myPending) return json(res, { ok: false, error: 'You already have a pending claim on another athlete profile — withdraw or wait for that one to be reviewed first.', existingClaimId: myPending.id }, 409);
      const r = await q('insert into athlete_claim_requests (user_id, athlete_id) values ($1,$2) returning id', [member.id, athleteId]);
      await writeAudit({ req, actor: memberActor(member, 'athlete'), action: 'create', resourceType: 'athlete_claim_requests', resourceId: r.rows[0].id, after: { athleteId } });
      return json(res, { ok: true, claimId: r.rows[0].id });
    }

    // ── BECOME-COACH: self-label. Grants no capability by itself — every
    // real coach->athlete relationship still needs the athlete's consent. ──
    if (action === 'become-coach' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      await q('update users set member_role=$1 where id=$2', ['coach', member.id]);
      await writeAudit({ req, actor: memberActor(member, 'coach'), action: 'update', resourceType: 'users', resourceId: member.id, after: { memberRole: 'coach' } });
      return json(res, { ok: true });
    }

    // ── COACH-LINK: request a relationship. Either the coach requests an
    // athlete, or an athlete invites a coach — the OTHER side must accept
    // (coach-link-respond) before it's active. ──
    if (action === 'coach-link' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      let coachUserId, athleteId, requestedBy;
      if (b.athleteId) {
        coachUserId = member.id; athleteId = parseInt(b.athleteId, 10); requestedBy = 'coach';
      } else if (b.coachUserId) {
        athleteId = await ownAthleteId(member.id);
        if (!athleteId) return json(res, { error: 'You need an athlete profile before inviting a coach — see become-athlete.' }, 400);
        coachUserId = parseInt(b.coachUserId, 10); requestedBy = 'athlete';
      } else {
        return json(res, { error: 'athleteId (as coach) or coachUserId (as athlete) is required' }, 400);
      }
      if (!coachUserId || !athleteId) return json(res, { error: 'Invalid athleteId/coachUserId' }, 400);
      if (coachUserId === (await q('select user_id from athletes where id=$1', [athleteId])).rows[0]?.user_id) {
        return json(res, { error: 'A coach cannot link themselves as their own athlete.' }, 400);
      }
      const r = await q(
        `insert into coach_athletes (coach_user_id, athlete_id, status, requested_by)
         values ($1,$2,'pending',$3)
         on conflict (coach_user_id, athlete_id) do update
           set status='pending', requested_by=excluded.requested_by, responded_at=null, created_at=now()
           where coach_athletes.status='revoked'
         returning id, status`,
        [coachUserId, athleteId, requestedBy]);
      // r.rows[0] is empty when the ON CONFLICT ... WHERE guard didn't match
      // (an existing pending/active link) — nothing was actually written, so
      // don't write an audit row asserting a 'create' that didn't happen
      // (caught by adversarial security review, 2026-08-12).
      if (r.rows[0]) {
        await writeAudit({ req, actor: memberActor(member, requestedBy), action: 'create', resourceType: 'coach_athletes', resourceId: r.rows[0].id, after: { coachUserId, athleteId, requestedBy } });
        return json(res, { ok: true, linkId: r.rows[0].id, status: r.rows[0].status });
      }
      const existing = (await q('select id, status from coach_athletes where coach_user_id=$1 and athlete_id=$2', [coachUserId, athleteId])).rows[0];
      return json(res, { ok: true, linkId: existing.id, status: existing.status, unchanged: true });
    }

    // ── COACH-LINK-RESPOND: the non-requesting party accepts or declines. ──
    if (action === 'coach-link-respond' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const linkId = parseInt(b.linkId, 10);
      if (!linkId) return json(res, { error: 'linkId is required' }, 400);
      const link = (await q('select * from coach_athletes where id=$1', [linkId])).rows[0];
      if (!link) return json(res, { error: 'Unknown link' }, 404);
      if (link.status !== 'pending') return json(res, { error: 'This link is not pending.' }, 409);
      const athlete = (await q('select user_id from athletes where id=$1', [link.athlete_id])).rows[0];
      const responderIsAthlete = athlete && athlete.user_id === member.id;
      const responderIsCoach = link.coach_user_id === member.id;
      const expectedResponder = link.requested_by === 'coach' ? 'athlete' : 'coach';
      const responderOk = expectedResponder === 'athlete' ? responderIsAthlete : responderIsCoach;
      if (!responderOk) return json(res, { error: 'Only the other party to this request can respond.' }, 403);
      const newStatus = b.accept ? 'active' : 'revoked';
      await q('update coach_athletes set status=$1, responded_at=now() where id=$2', [newStatus, linkId]);
      await writeAudit({ req, actor: memberActor(member, expectedResponder), action: 'update', resourceType: 'coach_athletes', resourceId: linkId, after: { status: newStatus } });
      return json(res, { ok: true, status: newStatus });
    }

    // ── REVOKE-COACH-LINK: either party can end an ACTIVE relationship at
    // any time — an athlete can always fire a coach; a coach can always
    // step down. ──
    if (action === 'revoke-coach-link' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const linkId = parseInt(b.linkId, 10);
      if (!linkId) return json(res, { error: 'linkId is required' }, 400);
      const link = (await q('select * from coach_athletes where id=$1', [linkId])).rows[0];
      if (!link) return json(res, { error: 'Unknown link' }, 404);
      const athlete = (await q('select user_id from athletes where id=$1', [link.athlete_id])).rows[0];
      const revokerIsCoach = link.coach_user_id === member.id;
      const revokerIsAthlete = athlete && athlete.user_id === member.id;
      if (!revokerIsCoach && !revokerIsAthlete) return json(res, { error: 'Only a party to this relationship can revoke it.' }, 403);
      await q(`update coach_athletes set status='revoked', responded_at=now() where id=$1`, [linkId]);
      // The actor's CAPACITY IN THIS RELATIONSHIP (coach or athlete), not
      // their possibly-unset/unrelated self-declared member_role — the
      // latter defaulted to 'athlete' even when a coach revoked, which is
      // the only place this relationship's audit trail records who acted
      // (caught by adversarial security review, 2026-08-12).
      await writeAudit({ req, actor: memberActor(member, revokerIsCoach ? 'coach' : 'athlete'), action: 'update', resourceType: 'coach_athletes', resourceId: linkId, after: { status: 'revoked' } });
      return json(res, { ok: true });
    }

    // ── REQUEST-CERTIFICATION: self-declare as an official candidate.
    // status stays 'pending' until staff approves (approve-certification) —
    // this alone grants no scoring capability. ──
    if (action === 'request-certification' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const level = ['club', 'state', 'national', 'international'].includes(b.level) ? b.level : 'club';
      const r = await q(
        `insert into official_certifications (user_id, level, issuing_body, status)
         values ($1,$2,$3,'pending')
         on conflict (user_id) do update
           set level=excluded.level, issuing_body=excluded.issuing_body, status='pending', approved_by=null, approved_at=null
           where official_certifications.status='revoked'
         returning id, status`,
        [member.id, level, String(b.issuingBody || '').slice(0, 120) || null]);
      await q('update users set member_role=$1 where id=$2', ['official', member.id]);
      // r.rows[0] is empty when the ON CONFLICT ... WHERE guard didn't match
      // (an existing pending/approved certification) — the row (and its real
      // level/status) is untouched, so don't audit-log the request-supplied
      // level as if it had taken effect (caught by adversarial security
      // review, 2026-08-12).
      if (r.rows[0]) {
        await writeAudit({ req, actor: memberActor(member, 'official'), action: 'create', resourceType: 'official_certifications', resourceId: r.rows[0].id, after: { level, status: r.rows[0].status } });
        return json(res, { ok: true, certificationId: r.rows[0].id, status: r.rows[0].status });
      }
      const existing = (await q('select id, status, level from official_certifications where user_id=$1', [member.id])).rows[0];
      return json(res, { ok: true, certificationId: existing.id, status: existing.status, unchanged: true });
    }

    // ── EVENT-OFFICIALS: public read (who's judging this event). ──
    if (action === 'event-officials' && req.method === 'GET') {
      const eventId = parseInt(req.query.eventId, 10);
      if (!eventId) return json(res, { error: 'eventId is required' }, 400);
      const rows = (await q(
        `select eo.role, u.name from event_officials eo join users u on u.id = eo.user_id where eo.event_id=$1 order by eo.role, u.name`,
        [eventId])).rows;
      return json(res, rows);
    }

    // ── STAFF: review pending claims/certifications, assign officials ──
    if (action === 'pending-claims' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select acr.id, acr.user_id, acr.athlete_id, acr.created_at, u.name as user_name, u.email, a.name as athlete_name
           from athlete_claim_requests acr
           join users u on u.id = acr.user_id
           join athletes a on a.id = acr.athlete_id
          where acr.status='pending' order by acr.created_at`)).rows;
      return json(res, rows);
    }

    if (action === 'approve-claim' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const claimId = parseInt(b.claimId, 10);
      if (!claimId) return json(res, { error: 'claimId is required' }, 400);
      const claim = (await q(`select * from athlete_claim_requests where id=$1 and status='pending'`, [claimId])).rows[0];
      if (!claim) return json(res, { error: 'No pending claim with that id' }, 404);
      if (b.approve) {
        const athlete = (await q('select user_id from athletes where id=$1', [claim.athlete_id])).rows[0];
        if (athlete && athlete.user_id) return json(res, { ok: false, error: 'This athlete was linked to a different account in the meantime.' }, 409);
        // The claimant may have created (or been approved onto) a DIFFERENT
        // athletes row after filing this claim (e.g. via become-athlete) —
        // athletes.user_id is unique, so approving here would otherwise hit
        // a raw constraint violation, 500, and strand this claim at
        // 'pending' forever (caught by adversarial security review,
        // 2026-08-12). Refuse cleanly instead.
        const existingRow = (await q('select id from athletes where user_id=$1', [claim.user_id])).rows[0];
        if (existingRow) return json(res, { ok: false, error: 'This account is already linked to a different athlete profile — reject this claim, or unlink the other profile first.' }, 409);
        await q('update athletes set user_id=$1 where id=$2', [claim.user_id, claim.athlete_id]);
        await q('update users set member_role=$1 where id=$2', ['athlete', claim.user_id]);
        await q(`update athlete_claim_requests set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2`, [staff.name, claimId]);
      } else {
        await q(`update athlete_claim_requests set status='rejected', reviewed_by=$1, reviewed_at=now() where id=$2`, [staff.name, claimId]);
      }
      await writeAudit({ req, actor: staff, action: 'update', resourceType: 'athlete_claim_requests', resourceId: claimId, after: { approved: !!b.approve } });
      return json(res, { ok: true });
    }

    if (action === 'pending-certifications' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select oc.id, oc.user_id, oc.level, oc.issuing_body, oc.created_at, u.name, u.email
           from official_certifications oc join users u on u.id = oc.user_id
          where oc.status='pending' order by oc.created_at`)).rows;
      return json(res, rows);
    }

    // ── APPROVED-OFFICIALS: staff-only list of currently-approved officials,
    // for the "assign to event" workflow (admin.html). ──
    if (action === 'approved-officials' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select oc.user_id, oc.level, oc.issuing_body, oc.approved_at, u.name, u.email
           from official_certifications oc join users u on u.id = oc.user_id
          where oc.status='approved' order by u.name`)).rows;
      return json(res, rows);
    }

    if (action === 'approve-certification' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const certId = parseInt(b.certificationId, 10);
      if (!certId) return json(res, { error: 'certificationId is required' }, 400);
      const newStatus = b.approve ? 'approved' : 'revoked';
      const r = await q(
        `update official_certifications set status=$1, approved_by=$2, approved_at=now() where id=$3 returning id`,
        [newStatus, staff.name, certId]);
      if (!r.rows[0]) return json(res, { error: 'Unknown certification' }, 404);
      await writeAudit({ req, actor: staff, action: 'update', resourceType: 'official_certifications', resourceId: certId, after: { status: newStatus } });
      return json(res, { ok: true, status: newStatus });
    }

    if (action === 'assign-official' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const eventId = parseInt(b.eventId, 10);
      const userId = parseInt(b.userId, 10);
      const role = ['judge', 'technical_delegate', 'chief_judge'].includes(b.role) ? b.role : 'judge';
      if (!eventId || !userId) return json(res, { error: 'eventId and userId are required' }, 400);
      const r = await q(
        `insert into event_officials (event_id, user_id, role, assigned_by) values ($1,$2,$3,$4)
         on conflict (event_id, user_id) do update set role=excluded.role returning id`,
        [eventId, userId, role, staff.name]);
      await writeAudit({ req, actor: staff, action: 'create', resourceType: 'event_officials', resourceId: r.rows[0].id, after: { eventId, userId, role } });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    if (action === 'unassign-official' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const eventId = parseInt(b.eventId, 10);
      const userId = parseInt(b.userId, 10);
      if (!eventId || !userId) return json(res, { error: 'eventId and userId are required' }, 400);
      await q('delete from event_officials where event_id=$1 and user_id=$2', [eventId, userId]);
      await writeAudit({ req, actor: staff, action: 'delete', resourceType: 'event_officials', resourceId: null, after: { eventId, userId } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('members:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
