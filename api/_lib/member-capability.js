// Capability checks for PLATFORM MEMBERS (athletes, coaches, officials) —
// the counterpart to api/_lib/auth.js's can() (which governs STAFF, i.e.
// your employees). CLAUDE.md §1.4: capability, not "is logged in." Every
// function here answers one narrow, specific question and touches the
// database itself — nothing is inferred from a JWT claim, because roles
// must be read fresh on every request (§1.4) and because the elevated
// capabilities modeled here (coach access to an athlete, an official's
// right to score a match) are relationships that can be revoked at any
// time and must reflect that instantly, not after a token expires.
'use strict';
const { q } = require('./db');
const { checkAdmin } = require('./auth');
const { authedUserChecked } = require('./userauth');
const { isMinor } = require('./age');

// Is this athlete's underlying account a confirmed minor whose parent has
// NOT granted consent? Gates real processing (a public tournament entry,
// live results tied to their name) regardless of who's submitting it —
// even staff, since CLAUDE.md §1.8/DPDP s.9(3) is about the DATA being
// processed, not who initiates it. An athletes row with no linked account
// (nothing to check DOB against) is never blocked here.
async function isAthleteConsentBlocked(athleteId) {
  if (!athleteId) return false;
  const row = (await q(
    `select u.date_of_birth, u.parent_consent_status from athletes a
       join users u on u.id = a.user_id where a.id=$1`, [athleteId])).rows[0];
  if (!row) return false;
  return isMinor(row.date_of_birth) === true && row.parent_consent_status !== 'granted';
}

// Is this user the athlete themself (athletes.user_id, migration 024)?
async function isOwnAthlete(userId, athleteId) {
  if (!userId || !athleteId) return false;
  const row = (await q('select 1 from athletes where id=$1 and user_id=$2', [athleteId, userId])).rows[0];
  return !!row;
}

// Is this user an ACTIVE (mutually-consented) coach of this athlete?
async function isActiveCoach(coachUserId, athleteId) {
  if (!coachUserId || !athleteId) return false;
  const row = (await q(
    `select 1 from coach_athletes where coach_user_id=$1 and athlete_id=$2 and status='active'`,
    [coachUserId, athleteId])).rows[0];
  return !!row;
}

// Can this member act on behalf of this athlete (register them for an
// event, edit their public profile)? Self, or an active coach — never a
// pending/revoked coach link.
async function canActForAthlete(userId, athleteId) {
  return (await isOwnAthlete(userId, athleteId)) || (await isActiveCoach(userId, athleteId));
}

// Is this user a staff-approved, currently-certified official, AND actually
// assigned to the given event? Both conditions matter independently: a
// revoked certification must lose scoring rights everywhere immediately,
// and an approved official is still scoped to only the events they're
// assigned to (real competitions assign judges per event, not globally).
async function isAssignedCertifiedOfficial(userId, eventId) {
  if (!userId || !eventId) return false;
  const cert = (await q(`select 1 from official_certifications where user_id=$1 and status='approved'`, [userId])).rows[0];
  if (!cert) return false;
  const assignment = (await q('select 1 from event_officials where event_id=$1 and user_id=$2', [eventId, userId])).rows[0];
  return !!assignment;
}

// event_id for a match_entries.id — walks match_entries -> matches ->
// event_categories. Returns null if the chain doesn't resolve (bad id).
async function eventIdForMatchEntry(matchEntryId) {
  const row = (await q(
    `select ec.event_id from match_entries me
       join matches m on m.id = me.match_id
       join event_categories ec on ec.id = m.event_category_id
      where me.id=$1`, [matchEntryId])).rows[0];
  return row ? row.event_id : null;
}

// event_id for an ends.id — one hop further via match_entry_id.
async function eventIdForEnd(endId) {
  const row = (await q(
    `select ec.event_id from ends e
       join match_entries me on me.id = e.match_entry_id
       join matches m on m.id = me.match_id
       join event_categories ec on ec.id = m.event_category_id
      where e.id=$1`, [endId])).rows[0];
  return row ? row.event_id : null;
}

// The combined scorer gate for actions tied to a specific match_entry
// (currently: recording an end). Staff (owner/manager) pass unconditionally
// — same as requireScorer() in scoring.js — with NO extra query, so the
// common internal-staff path costs nothing extra. Otherwise, an authed
// member is checked against isAssignedCertifiedOfficial() for the event
// that owns this match_entry. Returns an actor-shaped object for the audit
// log either way, or null (caller must respond 401).
async function requireScorerForMatchEntry(req, matchEntryId) {
  const staff = await checkAdmin(req);
  if (staff && (staff.role === 'owner' || staff.role === 'manager')) return staff;
  const member = await authedUserChecked(req);
  if (!member) return null;
  const eventId = await eventIdForMatchEntry(matchEntryId);
  if (!eventId) return null;
  if (!(await isAssignedCertifiedOfficial(member.id, eventId))) return null;
  // sid (not userId) — writeAudit (api/_lib/audit.js) computes actor_id as
  // String(actor.sid ?? 'owner'). Every other actor object in this codebase
  // (checkAdmin's staff actor, memberActor in members.js) uses sid for
  // exactly this reason; getting the field name wrong here silently
  // collapses every official's audit rows onto the literal 'owner' sentinel
  // (caught by adversarial security review, 2026-08-12 — see git log).
  return { role: 'official', name: member.name || ('member#' + member.id), sid: member.id };
}

// Same gate, resolved from an ends.id instead (shootoff-judge action).
async function requireScorerForEnd(req, endId) {
  const staff = await checkAdmin(req);
  if (staff && (staff.role === 'owner' || staff.role === 'manager')) return staff;
  const member = await authedUserChecked(req);
  if (!member) return null;
  const eventId = await eventIdForEnd(endId);
  if (!eventId) return null;
  if (!(await isAssignedCertifiedOfficial(member.id, eventId))) return null;
  // sid (not userId) — writeAudit (api/_lib/audit.js) computes actor_id as
  // String(actor.sid ?? 'owner'). Every other actor object in this codebase
  // (checkAdmin's staff actor, memberActor in members.js) uses sid for
  // exactly this reason; getting the field name wrong here silently
  // collapses every official's audit rows onto the literal 'owner' sentinel
  // (caught by adversarial security review, 2026-08-12 — see git log).
  return { role: 'official', name: member.name || ('member#' + member.id), sid: member.id };
}

// Is userId an ACTIVE admin of THIS specific club (migration 031)? Scoped,
// not global — a club admin manages their own club's roster/join requests
// without needing owner/manager/editor/support access to every club on the
// platform. This is the club-scoped counterpart to what federation.js
// already does ad hoc for federation officers (hasJurisdiction) — CLAUDE.md
// §3's "a club admin is an actor within a club" only existed for
// federations before this.
async function isClubAdmin(userId, clubId) {
  if (!userId || !clubId) return false;
  const row = (await q(
    `select 1 from club_members where user_id=$1 and club_id=$2 and member_role='admin' and status='active'`,
    [userId, clubId])).rows[0];
  return !!row;
}

module.exports = {
  isOwnAthlete, isActiveCoach, canActForAthlete, isAthleteConsentBlocked,
  isAssignedCertifiedOfficial, eventIdForMatchEntry, eventIdForEnd,
  requireScorerForMatchEntry, requireScorerForEnd, isClubAdmin,
};
