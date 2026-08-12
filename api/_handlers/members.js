// /api/members/<action> — the capability surface for platform MEMBERS
// (athletes, coaches, officials), as opposed to /api/staff (your employees).
// CLAUDE.md §1.4/§1.5: every write here is authorised by a specific
// capability and writes an audit row. See api/_lib/member-capability.js for
// the design principle: a self-declared label never grants access to
// someone else's data — only mutual consent (coach-athlete) or explicit
// staff approval (claims, certifications) does.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { q, withTransaction } = require('../_lib/db');
const { checkAdmin } = require('../_lib/auth');
const { authedUserChecked } = require('../_lib/userauth');
const { writeAudit } = require('../_lib/audit');
const { isMinor } = require('../_lib/age');
const { canActForAthlete, isClubAdmin } = require('../_lib/member-capability');

const SPORT_CLASSES = ['PI1', 'PI2', 'VI1', 'VI2'];

async function requireMember(req) {
  const claims = await authedUserChecked(req);
  if (!claims) return null;
  const row = (await q('select id, name, email, member_role from users where id=$1', [claims.id])).rows[0];
  return row || null;
}
// Same as requireMember(), but additionally refuses a CONFIRMED minor
// (a real date_of_birth on file, computed fresh, under 18) whose parent has
// not granted consent — for actions that are "processing beyond a bare
// account" (CLAUDE.md §1.8, DPDP s.9(3)): creating a public athlete
// profile, or a data-sharing relationship with a third-party coach. An
// account with no date_of_birth on file (registered before migration 027)
// is treated as unknown, not minor — never blocked here on a guess.
async function requireConsentedMember(req) {
  const claims = await authedUserChecked(req);
  if (!claims) return null;
  const row = (await q('select id, name, email, member_role, date_of_birth, parent_consent_status from users where id=$1', [claims.id])).rows[0];
  if (!row) return null;
  if (isMinor(row.date_of_birth) === true && row.parent_consent_status !== 'granted') return { blocked: true };
  return row;
}
async function requireStaff(req) {
  const actor = await checkAdmin(req);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) return null;
  return actor;
}
const memberActor = (member, role) => ({ role: 'member:' + role, sid: member.id, name: member.name });
const CONSENT_REQUIRED_MSG = "A parent or guardian's consent is required before this account can do this — check your dashboard for status.";
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
      // Coach license joined in here too — the whole reason coach licensing
      // exists is so an athlete/parent deciding whether to accept a link
      // sees something real, not a bare name (previously the entire visible
      // credential was zero information beyond who accepted).
      const myCoaches = athlete ? (await q(
        `select ca.id, ca.coach_user_id, ca.status, ca.requested_by, u.name as coach_name,
                cc.level as coach_license_level, cc.status as coach_license_status
           from coach_athletes ca join users u on u.id = ca.coach_user_id
           left join coach_certifications cc on cc.user_id = ca.coach_user_id
          where ca.athlete_id=$1 order by ca.created_at desc`, [athlete.id])).rows : [];
      const certification = (await q('select level, issuing_body, status, approved_at from official_certifications where user_id=$1', [member.id])).rows[0] || null;
      const coachLicense = (await q('select level, discipline, issuing_body, status, approved_at from coach_certifications where user_id=$1', [member.id])).rows[0] || null;
      const assignments = (await q(
        `select eo.event_id, eo.role, ev.name as event_name from event_officials eo
           join events ev on ev.id = eo.event_id where eo.user_id=$1 order by eo.created_at desc`, [member.id])).rows;
      const dobRow = (await q('select date_of_birth, parent_consent_status from users where id=$1', [member.id])).rows[0];
      const minor = isMinor(dobRow && dobRow.date_of_birth);
      const classification = athlete ? (await q(
        `select sport_class, status, review_due_date, classified_by from classifications where athlete_id=$1 and superseded_by is null`,
        [athlete.id])).rows[0] || null : null;
      const pendingClassificationRequest = athlete ? (await q(
        `select sport_class_requested from classification_requests where athlete_id=$1 and status='pending'`,
        [athlete.id])).rows[0] || null : null;
      return json(res, { ok: true, memberRole: member.member_role, athlete, coaching, myCoaches, certification, coachLicense, assignments,
        classification, pendingClassificationRequest,
        isMinor: minor === true, parentConsentStatus: dobRow ? dobRow.parent_consent_status : 'not_required',
        consentBlocked: minor === true && dobRow && dobRow.parent_consent_status !== 'granted' });
    }

    // ── BECOME-ATHLETE: create MY OWN athletes row (instant, safe — no
    // identity conflict possible for a brand-new row). Idempotent. ──
    if (action === 'become-athlete' && req.method === 'POST') {
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
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
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
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
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
      await q('update users set member_role=$1 where id=$2', ['coach', member.id]);
      await writeAudit({ req, actor: memberActor(member, 'coach'), action: 'update', resourceType: 'users', resourceId: member.id, after: { memberRole: 'coach' } });
      return json(res, { ok: true });
    }

    // ── REQUEST-COACH-LICENSE: self-declare, staff-approved — separate
    // table from official_certifications (migration 032's header explains
    // why: a person can hold a coach license AND a judge certification at
    // once). Requesting this grants no capability by itself — coach-link
    // still works without it (unchanged); this exists so an athlete/parent
    // deciding whether to accept a coach-link request can see something
    // real instead of nothing (see my-status below). ──
    if (action === 'request-coach-license' && req.method === 'POST') {
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
      const b = readBody(req);
      const level = ['club', 'state', 'national', 'international'].includes(b.level) ? b.level : 'club';
      const discipline = ['recurve', 'compound', 'barebow'].includes(b.discipline) ? b.discipline : null;
      const r = await q(
        `insert into coach_certifications (user_id, level, discipline, issuing_body, status)
         values ($1,$2,$3,$4,'pending')
         on conflict (user_id) do update
           set level=excluded.level, discipline=excluded.discipline, issuing_body=excluded.issuing_body, status='pending', approved_by=null, approved_at=null
           where coach_certifications.status='revoked'
         returning id, status`,
        [member.id, level, discipline, String(b.issuingBody || '').slice(0, 120) || null]);
      if (r.rows[0]) {
        await writeAudit({ req, actor: memberActor(member, 'coach'), action: 'create', resourceType: 'coach_certifications', resourceId: r.rows[0].id, after: { level, discipline, status: r.rows[0].status } });
        return json(res, { ok: true, licenseId: r.rows[0].id, status: r.rows[0].status });
      }
      const existing = (await q('select id, status, level from coach_certifications where user_id=$1', [member.id])).rows[0];
      return json(res, { ok: true, licenseId: existing.id, status: existing.status, unchanged: true });
    }

    if (action === 'pending-coach-licenses' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select cc.id, cc.user_id, cc.level, cc.discipline, cc.issuing_body, cc.created_at, u.name, u.email
           from coach_certifications cc join users u on u.id = cc.user_id
          where cc.status='pending' order by cc.created_at`)).rows;
      return json(res, rows);
    }

    if (action === 'approve-coach-license' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const licenseId = parseInt(b.licenseId, 10);
      if (!licenseId) return json(res, { error: 'licenseId is required' }, 400);
      const newStatus = b.approve ? 'approved' : 'revoked';
      const r = await q(
        `update coach_certifications set status=$1, approved_by=$2, approved_at=now() where id=$3 returning id`,
        [newStatus, staff.name, licenseId]);
      if (!r.rows[0]) return json(res, { error: 'Unknown coach license' }, 404);
      await writeAudit({ req, actor: staff, action: 'update', resourceType: 'coach_certifications', resourceId: licenseId, after: { status: newStatus } });
      return json(res, { ok: true, status: newStatus });
    }

    // ── COACH-LINK: request a relationship. Either the coach requests an
    // athlete, or an athlete invites a coach — the OTHER side must accept
    // (coach-link-respond) before it's active. ──
    if (action === 'coach-link' && req.method === 'POST') {
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
      const b = readBody(req);
      let coachUserId, athleteId, requestedBy;
      if (b.athleteId) {
        coachUserId = member.id; athleteId = parseInt(b.athleteId, 10); requestedBy = 'coach';
      } else if (b.coachUserId || b.coachEmail) {
        athleteId = await ownAthleteId(member.id);
        if (!athleteId) return json(res, { error: 'You need an athlete profile before inviting a coach — see become-athlete.' }, 400);
        // A bare numeric id was the only way to invite a coach — no way for
        // an athlete to find one without already knowing their raw id.
        // Email lookup (same fix already applied to federation officer
        // assignment) at least lets them use something they'd actually have.
        if (b.coachEmail) {
          const u = (await q('select id from users where email=$1', [String(b.coachEmail).trim().toLowerCase()])).rows[0];
          if (!u) return json(res, { error: 'No registered user with that email.' }, 404);
          coachUserId = u.id;
        } else {
          coachUserId = parseInt(b.coachUserId, 10);
        }
        requestedBy = 'athlete';
      } else {
        return json(res, { error: 'athleteId (as coach) or coachUserId/coachEmail (as athlete) is required' }, 400);
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
      // Consent only gates ACCEPTING (creates a real data-sharing
      // relationship) — declining is always allowed regardless of consent
      // status, since it reduces exposure rather than creating it, and a
      // minor must always be able to say no.
      const b = readBody(req);
      const member = b.accept ? await requireConsentedMember(req) : await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
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
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
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

    // ── REQUEST-CLASSIFICATION: self (or an active coach, on behalf of
    // their athlete) applies for a real Para classification panel to
    // review. The platform performs no medical/functional assessment here —
    // a real classification panel does that in person (World Archery Para
    // Archery Classification Rules, Art. 7); this just opens the request
    // for staff to record that panel's outcome against (see
    // approve-classification). Sport classes are PI1/PI2 (physical) and
    // VI1/VI2 (vision) — the actual codes the current (2026-01-27) rulebook
    // uses; see migration 030's header for why this differs from the
    // "W1/Open/VI1/VI2/VI3" wording still elsewhere in CLAUDE.md/DOMAIN.md. ──
    if (action === 'request-classification' && req.method === 'POST') {
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
      const b = readBody(req);
      const athleteId = parseInt(b.athleteId, 10) || await ownAthleteId(member.id);
      if (!athleteId) return json(res, { error: 'No athlete profile to request classification for.' }, 400);
      if (!(await canActForAthlete(member.id, athleteId))) return json(res, { error: 'You can only request classification for your own athlete profile or one you actively coach.' }, 403);
      if (!SPORT_CLASSES.includes(b.sportClass)) return json(res, { error: `sportClass must be one of ${SPORT_CLASSES.join(', ')}` }, 400);
      const pending = (await q(`select id from classification_requests where athlete_id=$1 and status='pending'`, [athleteId])).rows[0];
      if (pending) return json(res, { ok: true, requestId: pending.id, status: 'pending', unchanged: true });
      const r = await q(
        `insert into classification_requests (athlete_id, requested_by, sport_class_requested, note) values ($1,$2,$3,$4) returning id`,
        [athleteId, member.id, b.sportClass, String(b.note || '').slice(0, 500) || null]);
      await writeAudit({ req, actor: memberActor(member, 'athlete'), action: 'create', resourceType: 'classification_requests', resourceId: r.rows[0].id, after: { athleteId, sportClass: b.sportClass } });
      return json(res, { ok: true, requestId: r.rows[0].id, status: 'pending' });
    }

    // ── MY-CLASSIFICATION: an athlete's own current classification (or
    // their coach's view of it), for the dashboard. ──
    if (action === 'my-classification' && req.method === 'GET') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const athleteId = parseInt(req.query.athleteId, 10) || await ownAthleteId(member.id);
      if (!athleteId || !(await canActForAthlete(member.id, athleteId))) return json(res, { ok: true, classification: null });
      const row = (await q(
        `select sport_class, status, review_due_date, classified_by, created_at from classifications where athlete_id=$1 and superseded_by is null`,
        [athleteId])).rows[0] || null;
      const pendingReq = (await q(`select sport_class_requested, created_at from classification_requests where athlete_id=$1 and status='pending'`, [athleteId])).rows[0] || null;
      return json(res, { ok: true, classification: row, pendingRequest: pendingReq });
    }

    // ── DOPING EDUCATION: completion tracking only — no doping-related
    // determination is made here (see migration 033's header for why a TUE
    // workflow and whereabouts tracking are deliberately NOT built). This
    // is the same shape as any e-learning completion record, moved from
    // localStorage-only to a real account so it survives a new device. ──
    if (action === 'complete-doping-module' && req.method === 'POST') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const moduleId = String(b.moduleId || '').trim().slice(0, 80);
      if (!moduleId) return json(res, { error: 'moduleId is required' }, 400);
      const r = await q(
        `insert into doping_education_progress (user_id, module_id) values ($1,$2)
         on conflict (user_id, module_id) do nothing returning id`,
        [member.id, moduleId]);
      if (r.rows[0]) await writeAudit({ req, actor: memberActor(member, 'member'), action: 'create', resourceType: 'doping_education_progress', resourceId: r.rows[0].id, after: { moduleId } });
      return json(res, { ok: true });
    }

    if (action === 'my-doping-education' && req.method === 'GET') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q('select module_id, completed_at from doping_education_progress where user_id=$1', [member.id])).rows;
      return json(res, { ok: true, completed: rows.map(r => r.module_id), rows });
    }

    // ── STAFF: who's completed anti-doping education — a federation
    // compliance question ("who needs a reminder"), not a doping
    // determination. ──
    if (action === 'doping-education-compliance' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select u.id as user_id, u.name, u.email, u.member_role, count(dep.id)::int as modules_completed, max(dep.completed_at) as last_completed
           from users u left join doping_education_progress dep on dep.user_id = u.id
          where u.member_role in ('athlete','coach','official')
          group by u.id, u.name, u.email, u.member_role
          order by modules_completed asc, u.name`)).rows;
      return json(res, rows);
    }

    // ── REQUEST-JOIN-CLUB: self-service. Approved by that club's admin
    // (migration 031) or staff — never automatic. ──
    if (action === 'request-join-club' && req.method === 'POST') {
      const member = await requireConsentedMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      if (member.blocked) return json(res, { error: CONSENT_REQUIRED_MSG }, 403);
      const b = readBody(req);
      const clubId = parseInt(b.clubId, 10);
      if (!clubId) return json(res, { error: 'clubId is required' }, 400);
      const club = (await q('select id from clubs where id=$1 and active=true', [clubId])).rows[0];
      if (!club) return json(res, { error: 'That club does not exist.' }, 404);
      const already = (await q(`select id from club_members where club_id=$1 and user_id=$2 and status='active'`, [clubId, member.id])).rows[0];
      if (already) return json(res, { ok: true, alreadyMember: true });
      const pending = (await q(`select id from club_join_requests where club_id=$1 and user_id=$2 and status='pending'`, [clubId, member.id])).rows[0];
      if (pending) return json(res, { ok: true, requestId: pending.id, status: 'pending', unchanged: true });
      const r = await q(
        `insert into club_join_requests (club_id, user_id, discipline, note) values ($1,$2,$3,$4) returning id`,
        [clubId, member.id, String(b.discipline || '').slice(0, 40) || null, String(b.note || '').slice(0, 500) || null]);
      await writeAudit({ req, actor: memberActor(member, 'member'), action: 'create', resourceType: 'club_join_requests', resourceId: r.rows[0].id, after: { clubId } });
      return json(res, { ok: true, requestId: r.rows[0].id, status: 'pending' });
    }

    // ── MY-CLUBS: a member's own active memberships + pending requests. ──
    if (action === 'my-clubs' && req.method === 'GET') {
      const member = await requireMember(req);
      if (!member) return json(res, { error: 'Unauthorised' }, 401);
      const memberships = (await q(
        `select cm.club_id, c.name as club_name, cm.member_role, cm.status
           from club_members cm join clubs c on c.id = cm.club_id where cm.user_id=$1`, [member.id])).rows;
      const pendingRequests = (await q(
        `select cjr.club_id, c.name as club_name, cjr.created_at
           from club_join_requests cjr join clubs c on c.id = cjr.club_id where cjr.user_id=$1 and cjr.status='pending'`, [member.id])).rows;
      return json(res, { ok: true, memberships, pendingRequests });
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

    // ── STAFF: review pending classification requests, record the real
    // panel's outcome. Staff never invents the sport class or status — this
    // is transcription of a real, external, already-completed evaluation
    // (Art. 33's "Notification of Classification Outcome"), same posture as
    // shootoff-judge and correct-arrow elsewhere in this codebase: the
    // platform records an adjudicated fact, it doesn't produce one. ──
    if (action === 'pending-classifications' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select cr.id, cr.athlete_id, cr.sport_class_requested, cr.note, cr.created_at, a.name as athlete_name
           from classification_requests cr join athletes a on a.id = cr.athlete_id
          where cr.status='pending' order by cr.created_at`)).rows;
      return json(res, rows);
    }

    // ── APPROVED-CLASSIFICATIONS: staff-only list of current classifications
    // (superseded_by is null), for the "who's classified as what" view. ──
    if (action === 'approved-classifications' && req.method === 'GET') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select c.id, c.athlete_id, c.sport_class, c.status, c.review_due_date, c.classified_by, c.created_at, a.name as athlete_name
           from classifications c join athletes a on a.id = c.athlete_id
          where c.superseded_by is null order by c.created_at desc`)).rows;
      return json(res, rows);
    }

    if (action === 'approve-classification' && req.method === 'POST') {
      const staff = await requireStaff(req);
      if (!staff) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const requestId = parseInt(b.requestId, 10);
      if (!requestId) return json(res, { error: 'requestId is required' }, 400);
      const reqRow = (await q(`select * from classification_requests where id=$1 and status='pending'`, [requestId])).rows[0];
      if (!reqRow) return json(res, { error: 'No pending request with that id' }, 404);
      if (!b.approve) {
        await q(`update classification_requests set status='rejected', reviewed_by=$1, reviewed_at=now() where id=$2`, [staff.name, requestId]);
        await writeAudit({ req, actor: staff, action: 'update', resourceType: 'classification_requests', resourceId: requestId, after: { approved: false } });
        return json(res, { ok: true });
      }
      const sportClass = SPORT_CLASSES.includes(b.sportClass) ? b.sportClass : reqRow.sport_class_requested;
      // Art. 18/19: the real Sport Class Statuses. 'pending'/'not_eligible'
      // don't belong here — approving IS the panel having reached an
      // outcome; a not-eligible outcome is recorded via that status below,
      // still as an approval (the request was properly reviewed), not a
      // rejection (which means "we're not recording this request at all").
      const status = ['confirmed', 'review_nao', 'review_frd', 'not_eligible'].includes(b.status) ? b.status : null;
      if (!status) return json(res, { error: 'status must be one of confirmed, review_nao, review_frd, not_eligible' }, 400);
      if (status === 'review_frd' && !b.reviewDueDate) return json(res, { error: 'reviewDueDate is required for review_frd (Art. 19.1.3 — typically no more than 4 years out)' }, 400);
      const classifiedBy = String(b.classifiedBy || '').trim();
      if (!classifiedBy) return json(res, { error: 'classifiedBy (the real classification panel/classifier of record, Art. 7) is required' }, 400);
      const newRowId = await withTransaction(async (client) => {
        const old = await client.query(`select id from classifications where athlete_id=$1 and superseded_by is null`, [reqRow.athlete_id]);
        const inserted = await client.query(
          `insert into classifications (athlete_id, sport_class, status, review_due_date, classified_by, request_id, note, actor)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [reqRow.athlete_id, sportClass, status, b.reviewDueDate || null, classifiedBy, requestId, String(b.note || '').slice(0, 500) || null, staff.name]);
        if (old.rows[0]) await client.query('update classifications set superseded_by=$1 where id=$2', [inserted.rows[0].id, old.rows[0].id]);
        return inserted.rows[0].id;
      });
      await q(`update classification_requests set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2`, [staff.name, requestId]);
      await writeAudit({ req, actor: staff, action: 'create', resourceType: 'classifications', resourceId: newRowId, after: { athleteId: reqRow.athlete_id, sportClass, status } });
      return json(res, { ok: true, classificationId: newRowId, status });
    }

    // ── CLUB ADMIN (scoped, not global staff) OR staff: review join requests.
    // The first real use of migration 031's club-scoped capability — a club
    // admin manages their own club without needing owner/manager access to
    // every club on the platform. ──
    if (action === 'pending-club-joins' && req.method === 'GET') {
      const clubId = parseInt(req.query.clubId, 10);
      if (!clubId) return json(res, { error: 'clubId is required' }, 400);
      const staff = await checkAdmin(req);
      let authorized = !!staff;
      if (!authorized) {
        const member = await authedUserChecked(req);
        authorized = !!(member && await isClubAdmin(member.id, clubId));
      }
      if (!authorized) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select cjr.id, cjr.user_id, cjr.discipline, cjr.note, cjr.created_at, u.name, u.email
           from club_join_requests cjr join users u on u.id = cjr.user_id
          where cjr.club_id=$1 and cjr.status='pending' order by cjr.created_at`, [clubId])).rows;
      return json(res, rows);
    }

    if (action === 'approve-club-join' && req.method === 'POST') {
      const b = readBody(req);
      const requestId = parseInt(b.requestId, 10);
      if (!requestId) return json(res, { error: 'requestId is required' }, 400);
      const reqRow = (await q(`select * from club_join_requests where id=$1 and status='pending'`, [requestId])).rows[0];
      if (!reqRow) return json(res, { error: 'No pending request with that id' }, 404);
      const staff = await checkAdmin(req);
      let actor = staff;
      if (!actor) {
        const member = await authedUserChecked(req);
        if (member && await isClubAdmin(member.id, reqRow.club_id)) actor = { role: 'member:club-admin', sid: member.id, name: member.name };
      }
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const actorLabel = actor.name || actor.username || 'owner';
      if (!b.approve) {
        await q(`update club_join_requests set status='rejected', reviewed_by=$1, reviewed_at=now() where id=$2`, [actorLabel, requestId]);
        await writeAudit({ req, actor, action: 'update', resourceType: 'club_join_requests', resourceId: requestId, after: { approved: false } });
        return json(res, { ok: true });
      }
      const userRow = (await q('select name, email from users where id=$1', [reqRow.user_id])).rows[0];
      const memberRow = await q(
        `insert into club_members (club_id, user_id, name, email, discipline, member_role, status)
         values ($1,$2,$3,$4,$5,'archer','active')
         on conflict (club_id, user_id) do update set status='active' returning id`,
        [reqRow.club_id, reqRow.user_id, userRow.name, userRow.email, reqRow.discipline || '']);
      await q(`update club_join_requests set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2`, [actorLabel, requestId]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'club_members', resourceId: memberRow.rows[0].id, after: { clubId: reqRow.club_id, userId: reqRow.user_id, viaJoinRequest: true } });
      return json(res, { ok: true, memberId: memberRow.rows[0].id });
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
