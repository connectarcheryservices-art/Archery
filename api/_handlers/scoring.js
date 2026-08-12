// /api/scoring/<action> — the arrow/end/match scoring domain (DOMAIN.md).
// Setup resources (categories/events/event-categories/matches/generate-draw/
// qualify/publish-ranking) stay owner/manager-only — restructuring a
// competition is an internal-staff action. Recording arrows (end,
// shootoff-judge) additionally accepts a real assigned+certified official
// (migration 024, api/_lib/member-capability.js) — a competition can have
// many volunteer judges who are not company staff. Registering an entry
// additionally accepts the athlete themself or their active coach. Reads
// are public — "live results are a view" (DOMAIN.md §1).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q, withTransaction } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');
const { computeMatchState, maybeAdvanceWinner } = require('../_lib/scoring-db');
const { rankingScoreForResult, selectBest7 } = require('../_lib/ranking');
const { generateBracket, roundCount, advancesTo } = require('../_lib/seeding');
const { requireScorerForMatchEntry, requireScorerForEnd, canActForAthlete, isAthleteConsentBlocked } = require('../_lib/member-capability');
const { authedUserChecked } = require('../_lib/userauth');

const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };
async function requireScorer(req) {
  const actor = await checkAdmin(req);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) return null;
  return actor;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    // ── CATEGORIES ──
    if (action === 'categories') {
      if (req.method === 'GET') {
        const r = await q('select * from categories order by division, gender, age_class');
        return json(res, r.rows.map(rowToObj));
      }
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      if (!['recurve', 'compound', 'barebow'].includes(b.division)) return json(res, { error: 'Invalid division' }, 400);
      if (!['men', 'women', 'mixed'].includes(b.gender)) return json(res, { error: 'Invalid gender' }, 400);
      if (!['u15', 'u18', 'u21', 'senior', 'master50'].includes(b.ageClass)) return json(res, { error: 'Invalid age class' }, 400);
      const r = await q(
        `insert into categories (division,gender,age_class,para_class) values ($1,$2,$3,$4)
         on conflict (division,gender,age_class,para_class) do update set division=excluded.division
         returning id`,
        [b.division, b.gender, b.ageClass, b.paraClass || null]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'categories', resourceId: r.rows[0].id, after: b });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── EVENTS ──
    if (action === 'events') {
      if (req.method === 'GET') {
        const r = await q('select * from events order by starts_on desc nulls last, id desc');
        return json(res, r.rows.map(rowToObj));
      }
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      if (!String(b.name || '').trim()) return json(res, { error: 'Event name is required' }, 400);
      const r = await q(
        `insert into events (tournament_id,name,sanctioning_body,wa_ranking_group,venue,starts_on,ends_on)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.tournamentId || null, String(b.name).trim().slice(0, 200), b.sanctioningBody || null,
         b.waRankingGroup || null, b.venue || null, b.startsOn || null, b.endsOn || null]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'events', resourceId: r.rows[0].id, after: b });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── EVENT CATEGORIES (round config: distance, band, format-driving info) ──
    if (action === 'event-categories') {
      if (req.method === 'GET') {
        const eventId = parseInt(req.query.eventId, 10);
        const r = eventId
          ? await q('select * from event_categories where event_id=$1 order by id', [eventId])
          : await q('select * from event_categories order by id desc limit 200');
        return json(res, r.rows.map(rowToObj));
      }
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      if (!b.eventId || !b.categoryId) return json(res, { error: 'eventId and categoryId are required' }, 400);
      if (b.distanceBand && !['long', 'short'].includes(b.distanceBand)) return json(res, { error: 'distanceBand must be long or short' }, 400);
      const arrowsPerEnd = [3, 6].includes(Number(b.arrowsPerEnd)) ? Number(b.arrowsPerEnd) : 6;
      const r = await q(
        `insert into event_categories (event_id,category_id,round_name,distance_m,distance_band,face_size_cm,arrows_per_end)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.eventId, b.categoryId, b.roundName || null, b.distanceM || null, b.distanceBand || null, b.faceSizeCm || null, arrowsPerEnd]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'event_categories', resourceId: r.rows[0].id, after: b });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── ENTRIES ──
    if (action === 'entries') {
      if (req.method === 'GET') {
        const eventCategoryId = parseInt(req.query.eventCategoryId, 10);
        if (!eventCategoryId) return json(res, { error: 'eventCategoryId is required' }, 400);
        const r = await q('select * from entries where event_category_id=$1 order by id', [eventCategoryId]);
        return json(res, r.rows.map(rowToObj));
      }
      const b = readBody(req);
      if (!b.eventCategoryId || !b.athleteId) return json(res, { error: 'eventCategoryId and athleteId are required' }, 400);
      // Registration: owner/manager, OR the athlete themself, OR their
      // active coach (migration 024) — self-service entry, not staff-only.
      let actor = await requireScorer(req);
      if (!actor) {
        const member = await authedUserChecked(req);
        if (member && await canActForAthlete(member.id, parseInt(b.athleteId, 10))) {
          actor = { role: 'member', sid: member.id, name: member.name };
        }
      }
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      // A tournament entry is real processing (a public result tied to a
      // real name) — gated on the ATHLETE's consent status, not who's
      // submitting it. Even staff cannot register a non-consented minor
      // (CLAUDE.md §1.8/DPDP s.9(3) is about the data, not the actor).
      if (await isAthleteConsentBlocked(parseInt(b.athleteId, 10))) {
        return json(res, { error: "This athlete's account needs parental consent before they can be registered for an event." }, 403);
      }
      const r = await q(
        `insert into entries (event_category_id,athlete_id,target_assignment) values ($1,$2,$3) returning id`,
        [b.eventCategoryId, b.athleteId, b.targetAssignment || null]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'entries', resourceId: r.rows[0].id, after: b });
      return json(res, { ok: true, id: r.rows[0].id });
    }

    // ── MATCHES: create (with both sides) + list ──
    if (action === 'matches') {
      if (req.method === 'GET') {
        const eventCategoryId = parseInt(req.query.eventCategoryId, 10);
        const r = eventCategoryId
          ? await q('select * from matches where event_category_id=$1 order by id', [eventCategoryId])
          : await q('select * from matches order by id desc limit 200');
        return json(res, r.rows.map(rowToObj));
      }
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      if (!['qualification', 'elimination', 'final'].includes(b.kind)) return json(res, { error: 'Invalid kind' }, 400);
      if (!['set', 'cumulative'].includes(b.format)) return json(res, { error: 'Invalid format' }, 400);
      const teamType = ['individual', 'team', 'mixed_team'].includes(b.teamType) ? b.teamType : 'individual';
      if (!Array.isArray(b.entryIds) || !b.entryIds.length) return json(res, { error: 'At least one entryId is required' }, 400);
      if (b.kind !== 'qualification' && b.entryIds.length !== 2) return json(res, { error: 'A match needs exactly two sides' }, 400);
      const targetPointsToWin = b.format === 'set' ? (teamType === 'individual' ? 6 : 5) : null;
      const endsToPlay = b.format === 'cumulative' ? (teamType === 'individual' ? 5 : 4) : null;
      const m = await q(
        `insert into matches (event_category_id,kind,format,team_type,bracket_position,target_points_to_win,ends_to_play)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.eventCategoryId, b.kind, b.format, teamType, b.bracketPosition || null, targetPointsToWin, endsToPlay]);
      const matchId = m.rows[0].id;
      for (let i = 0; i < b.entryIds.length; i++) {
        await q('insert into match_entries (match_id,side,entry_id) values ($1,$2,$3)', [matchId, i + 1, b.entryIds[i]]);
      }
      await writeAudit({ req, actor, action: 'create', resourceType: 'matches', resourceId: matchId, after: b });
      return json(res, { ok: true, id: matchId });
    }

    // ── MATCH: full computed state (public — "live results are a view") ──
    if (action === 'match') {
      const matchId = parseInt(req.query.id, 10);
      if (!Number.isFinite(matchId)) return json(res, { error: 'Bad id' }, 400);
      const result = await computeMatchState(matchId);
      if (!result) return json(res, { error: 'Not found' }, 404);
      return json(res, { ok: true, ...result });
    }

    // ── END: record one end + its arrows. Offline-first (client_id idempotency). ──
    if (action === 'end' && req.method === 'POST') {
      const b = readBody(req);
      const matchEntryId = parseInt(b.matchEntryId, 10);
      const endNumber = parseInt(b.endNumber, 10);
      const arrows = Array.isArray(b.arrows) ? b.arrows : [];
      if (!matchEntryId || !Number.isFinite(endNumber) || !arrows.length) {
        return json(res, { error: 'matchEntryId, endNumber and a non-empty arrows array are required' }, 400);
      }
      // Staff (owner/manager), OR a real assigned+certified official for the
      // event this match belongs to (migration 024) — never a self-declared
      // "I'm a judge" claim (member-capability.js).
      const actor = await requireScorerForMatchEntry(req, matchEntryId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      for (const a of arrows) {
        const v = Number(a.value);
        if (!Number.isFinite(v) || v < 0 || v > 10) return json(res, { error: 'Every arrow value must be 0-10' }, 400);
        if (a.isX && v !== 10) return json(res, { error: 'is_x can only be set on a value-10 arrow (Art. 12.2)' }, 400);
      }
      // Idempotent: if this client_id was already recorded, return the
      // existing end rather than creating a duplicate (ADR-0006 offline-first
      // — a retried request after a dropped connection must not double-score).
      if (b.clientId) {
        const existing = await q('select id from ends where client_id=$1', [b.clientId]);
        if (existing.rows[0]) return json(res, { ok: true, id: existing.rows[0].id, alreadyRecorded: true });
      }
      const actorLabel = actor.name || actor.username || 'owner';
      // (match_entry_id, end_number, shootoff_sequence) is UNIQUE (migration
      // 029 — the original migration-021 constraint never actually enforced
      // this: NULL shootoff_sequence made every regular end "distinct" from
      // every other, so a resubmission under a fresh client_id silently
      // inserted a SECOND end instead of colliding). Checked up front, not
      // caught after the fact — an in-transaction rollback-after-error round
      // trip is exactly the kind of edge case a lightweight local Postgres
      // bridge is least likely to get byte-for-byte right, and checking
      // first is also just clearer: the client_id check right above does
      // the same "look before you insert" idempotency check for the same
      // reason. Two real cases: (1) the exact same values resubmitted from
      // a second device/session with no client_id match — benign, same
      // idempotency as above; (2) a genuine disagreement — never silently
      // pick a winner, log it for a judge (ADR-0006 §5, THREAT_MODEL T13
      // "judge-adjudicated conflicts").
      const existingEnd = (await q(
        `select id from ends where match_entry_id=$1 and end_number=$2 and shootoff_sequence is not distinct from $3`,
        [matchEntryId, endNumber, b.shootoffSequence || null])).rows[0];
      if (existingEnd) {
        const existingArrows = (await q(
          `select value, is_x, is_miss from arrows where end_id=$1 and superseded_by is null order by sequence`,
          [existingEnd.id])).rows;
        const same = existingArrows.length === arrows.length && existingArrows.every((ea, i) =>
          Number(ea.value) === Number(arrows[i].value) && !!ea.is_x === !!arrows[i].isX && !!ea.is_miss === !!arrows[i].isMiss);
        if (same) return json(res, { ok: true, id: existingEnd.id, alreadyRecorded: true });
        const conflict = await q(
          `insert into scoring_conflicts (match_entry_id,end_number,existing_end_id,submitted_arrows,submitted_client_id,submitted_device_id,submitted_by)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [matchEntryId, endNumber, existingEnd.id, JSON.stringify(arrows), b.clientId || null, b.deviceId || null, actorLabel]);
        await writeAudit({ req, actor, action: 'create', resourceType: 'scoring_conflicts', resourceId: conflict.rows[0].id,
          after: { matchEntryId, endNumber, existingEndId: existingEnd.id } });
        return json(res, { error: 'This end was already recorded with different values by another device — a judge needs to review it.',
          conflict: true, conflictId: conflict.rows[0].id, existingEndId: existingEnd.id }, 409);
      }
      // Genuine race (two requests both passed the check above before
      // either inserted) still can't double-score — the unique index is the
      // real backstop — it just surfaces as a plain 500 in that rare case
      // rather than a clean conflict record. Deliberately not caught here:
      // see the comment above for why an in-transaction catch-and-recover
      // isn't the mechanism this relies on.
      const endId = await withTransaction(async (client) => {
        const endRow = await client.query(
          `insert into ends (match_entry_id,end_number,is_shootoff,shootoff_sequence,judge,client_id,device_id)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [matchEntryId, endNumber, !!b.isShootoff, b.shootoffSequence || null, b.judge || (actor.name || null), b.clientId || null, b.deviceId || null]);
        const id = endRow.rows[0].id;
        for (let i = 0; i < arrows.length; i++) {
          const a = arrows[i];
          await client.query(
            `insert into arrows (end_id,sequence,value,is_x,is_miss,x_coord,y_coord,client_id,actor)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, i + 1, Number(a.value), !!a.isX, !!a.isMiss, a.x ?? null, a.y ?? null, a.clientId || null, actorLabel]);
        }
        return id;
      });
      await writeAudit({ req, actor, action: 'create', resourceType: 'ends', resourceId: endId,
        after: { matchEntryId, endNumber, arrowCount: arrows.length } });
      const meRow = (await q('select match_id from match_entries where id=$1', [matchEntryId])).rows[0];
      const advanced = meRow ? await maybeAdvanceWinner(meRow.match_id) : null;
      return json(res, { ok: true, id: endId, advanced });
    }

    // ── CORRECT-ARROW: supersede one already-recorded arrow with a new value
    // + a reason (ADR-0007 — the write path the schema has had since
    // migration 021 but nothing ever used: correction_reason/superseded_by/
    // actor). Never an UPDATE on the old row — a new row, old row points
    // forward. computeMatchState already filters `superseded_by is null`, so
    // this takes effect immediately without touching that read path. ──
    if (action === 'correct-arrow' && req.method === 'POST') {
      const b = readBody(req);
      const arrowId = parseInt(b.arrowId, 10);
      const reason = String(b.reason || '').trim();
      const v = Number(b.value);
      if (!arrowId || !reason) return json(res, { error: 'arrowId and reason are required' }, 400);
      if (!Number.isFinite(v) || v < 0 || v > 10) return json(res, { error: 'value must be 0-10' }, 400);
      if (b.isX && v !== 10) return json(res, { error: 'is_x can only be set on a value-10 arrow (Art. 12.2)' }, 400);
      const old = (await q('select id, end_id, sequence, value, is_x, is_miss, superseded_by from arrows where id=$1', [arrowId])).rows[0];
      if (!old) return json(res, { error: 'Not found' }, 404);
      if (old.superseded_by) return json(res, { error: 'This arrow was already corrected once — correct the newer row instead.' }, 409);
      const actor = await requireScorerForEnd(req, old.end_id);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const actorLabel = actor.name || actor.username || 'owner';
      const newArrowId = await withTransaction(async (client) => {
        const inserted = await client.query(
          `insert into arrows (end_id,sequence,value,is_x,is_miss,correction_reason,actor)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [old.end_id, old.sequence, v, !!b.isX, !!b.isMiss, reason, actorLabel]);
        await client.query('update arrows set superseded_by=$1 where id=$2', [inserted.rows[0].id, old.id]);
        return inserted.rows[0].id;
      });
      await writeAudit({ req, actor, action: 'update', resourceType: 'arrows', resourceId: old.id,
        before: { value: old.value, isX: old.is_x, isMiss: old.is_miss },
        after: { value: v, isX: !!b.isX, isMiss: !!b.isMiss, reason, newArrowId } });
      const endRow3 = (await q('select match_entry_id from ends where id=$1', [old.end_id])).rows[0];
      const meRow3 = endRow3 ? (await q('select match_id from match_entries where id=$1', [endRow3.match_entry_id])).rows[0] : null;
      const advanced = meRow3 ? await maybeAdvanceWinner(meRow3.match_id) : null;
      return json(res, { ok: true, oldArrowId: old.id, newArrowId, advanced });
    }

    // ── CONFLICTS: list open scoring conflicts for a match entry, side by
    // side with the end already on record, so a judge can actually compare
    // before deciding (ADR-0006 §5). ──
    if (action === 'conflicts' && req.method === 'GET') {
      const matchEntryId = parseInt(req.query.matchEntryId, 10);
      if (!matchEntryId) return json(res, { error: 'matchEntryId is required' }, 400);
      const actor = await requireScorerForMatchEntry(req, matchEntryId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const rows = (await q(
        `select * from scoring_conflicts where match_entry_id=$1 and status='open' order by created_at`, [matchEntryId])).rows;
      const withExisting = await Promise.all(rows.map(async (c) => {
        const existingArrows = (await q(
          `select value, is_x, is_miss from arrows where end_id=$1 and superseded_by is null order by sequence`, [c.existing_end_id])).rows;
        return { ...rowToObj(c), existingArrows };
      }));
      return json(res, { ok: true, conflicts: withExisting });
    }

    // ── RESOLVE-CONFLICT: a judge's decision closes a scoring_conflicts row.
    // Never auto-resolved — a human always picks. Whatever is picked goes
    // through the SAME correct-arrow supersede mechanism above, so the
    // resolution itself is just as auditable as any other correction. ──
    if (action === 'resolve-conflict' && req.method === 'POST') {
      const b = readBody(req);
      const conflictId = parseInt(b.conflictId, 10);
      const resolution = b.resolution;
      if (!conflictId || !['kept_existing', 'used_submitted', 'entered_new'].includes(resolution)) {
        return json(res, { error: 'conflictId and a valid resolution are required' }, 400);
      }
      const conflict = (await q('select * from scoring_conflicts where id=$1', [conflictId])).rows[0];
      if (!conflict) return json(res, { error: 'Not found' }, 404);
      if (conflict.status !== 'open') return json(res, { error: 'This conflict was already resolved.' }, 409);
      const actor = await requireScorerForMatchEntry(req, conflict.match_entry_id);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const actorLabel = actor.name || actor.username || 'owner';
      let newValues = null;
      if (resolution === 'used_submitted') newValues = conflict.submitted_arrows;
      if (resolution === 'entered_new') {
        newValues = Array.isArray(b.arrows) ? b.arrows : [];
        if (!newValues.length) return json(res, { error: 'entered_new requires an arrows array' }, 400);
        for (const a of newValues) {
          const v = Number(a.value);
          if (!Number.isFinite(v) || v < 0 || v > 10) return json(res, { error: 'Every arrow value must be 0-10' }, 400);
        }
      }
      const reasonNote = String(b.resolutionNote || '').trim() ||
        (resolution === 'kept_existing' ? 'Judge confirmed the originally recorded values.'
          : resolution === 'used_submitted' ? "Judge accepted the second device's submitted values."
            : 'Judge entered a fresh corrected value.');
      if (newValues) {
        const existingArrows = (await q(
          `select id, sequence, value, is_x, is_miss from arrows where end_id=$1 and superseded_by is null order by sequence`,
          [conflict.existing_end_id])).rows;
        await withTransaction(async (client) => {
          for (let i = 0; i < existingArrows.length && i < newValues.length; i++) {
            const oldA = existingArrows[i], newA = newValues[i];
            const inserted = await client.query(
              `insert into arrows (end_id,sequence,value,is_x,is_miss,correction_reason,actor)
               values ($1,$2,$3,$4,$5,$6,$7) returning id`,
              [conflict.existing_end_id, oldA.sequence, Number(newA.value), !!newA.isX, !!newA.isMiss, reasonNote, actorLabel]);
            await client.query('update arrows set superseded_by=$1 where id=$2', [inserted.rows[0].id, oldA.id]);
          }
        });
      }
      await q(
        `update scoring_conflicts set status='resolved', resolved_by=$1, resolution=$2, resolution_note=$3, resolved_at=now() where id=$4`,
        [actorLabel, resolution, reasonNote, conflictId]);
      await writeAudit({ req, actor, action: 'update', resourceType: 'scoring_conflicts', resourceId: conflictId,
        after: { resolution, resolutionNote: reasonNote } });
      const meRow4 = (await q('select match_id from match_entries where id=$1', [conflict.match_entry_id])).rows[0];
      const advanced = meRow4 ? await maybeAdvanceWinner(meRow4.match_id) : null;
      return json(res, { ok: true, advanced });
    }

    // ── SHOOTOFF JUDGE DECISION: record closest-to-centre (Art. 12.5.2.2) ──
    if (action === 'shootoff-judge' && req.method === 'POST') {
      const b = readBody(req);
      const endId = parseInt(b.endId, 10);
      if (!endId) return json(res, { error: 'endId is required' }, 400);
      const actor = await requireScorerForEnd(req, endId);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      await q('update ends set judged_closest_to_centre=$1, judge=$2 where id=$3', [!!b.closest, b.judge || actor.name || null, endId]);
      await writeAudit({ req, actor, action: 'update', resourceType: 'ends', resourceId: endId, after: { judgedClosestToCentre: !!b.closest } });
      const endRow = (await q('select match_entry_id from ends where id=$1', [endId])).rows[0];
      const meRow2 = endRow ? (await q('select match_id from match_entries where id=$1', [endRow.match_entry_id])).rows[0] : null;
      const advanced = meRow2 ? await maybeAdvanceWinner(meRow2.match_id) : null;
      return json(res, { ok: true, advanced });
    }

    // ── RANKING RESULT: record a final position for an entry, compute its
    // ranking_score from the (partially verified) percentage table — see
    // migration 022 for the platform's own always-computable percentage curve. ──
    if (action === 'ranking-result' && req.method === 'POST') {
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const athleteId = parseInt(b.athleteId, 10);
      const eventCategoryId = parseInt(b.eventCategoryId, 10);
      const finalPosition = parseInt(b.finalPosition, 10);
      const eventGroup = parseInt(b.eventGroup, 10);
      if (!athleteId || !eventCategoryId || !Number.isFinite(finalPosition) || !Number.isFinite(eventGroup)) {
        return json(res, { error: 'athleteId, eventCategoryId, finalPosition and eventGroup are required' }, 400);
      }
      const pctRows = (await q('select position, percent from ranking_position_percentages')).rows;
      const overrides = Object.fromEntries(pctRows.map(r => [r.position, Number(r.percent)]));
      const monthsOld = Number(b.monthsOld) || 0;
      const computed = rankingScoreForResult({ eventGroup, finalPosition, monthsOld }, overrides);
      if (computed.score == null) {
        return json(res, { ok: false, error: `Cannot compute a ranking score: ${computed.reason}` }, 422);
      }
      const r = await q(
        `insert into ranking_results (athlete_id,event_category_id,final_position,base_points,position_pct,period_multiplier,ranking_score)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [athleteId, eventCategoryId, finalPosition, computed.basePoints, computed.positionPct, computed.periodMultiplier, computed.score]);
      await writeAudit({ req, actor, action: 'create', resourceType: 'ranking_results', resourceId: r.rows[0].id, after: { athleteId, eventCategoryId, finalPosition, rankingScore: computed.score } });
      return json(res, { ok: true, id: r.rows[0].id, rankingScore: computed.score });
    }

    // ── PUBLISH RANKING: compute best-7 (4 outdoor + 2 indoor + 1 field) per
    // athlete in a category and publish a new ranking_list (DOMAIN.md §4:
    // "a ranking is computed and published, never typed"). ──
    if (action === 'publish-ranking' && req.method === 'POST') {
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const categoryId = parseInt(b.categoryId, 10);
      if (!categoryId) return json(res, { error: 'categoryId is required' }, 400);
      // Never rank two divisions in one list (DOMAIN.md §4) — the query is
      // scoped to exactly one categories row (one division×gender×age_class×para_class).
      const rows = (await q(
        `select rr.athlete_id, rr.ranking_score, ec.round_type
           from ranking_results rr
           join event_categories ec on ec.id = rr.event_category_id
          where ec.category_id = $1`, [categoryId])).rows;
      const byAthlete = new Map();
      for (const row of rows) {
        if (!row.round_type) continue; // round_type not classified -> cannot count toward best-7 composition
        const list = byAthlete.get(row.athlete_id) || [];
        list.push({ roundType: row.round_type, score: Number(row.ranking_score) });
        byAthlete.set(row.athlete_id, list);
      }
      const entries = [];
      for (const [athleteId, results] of byAthlete) {
        const best7 = selectBest7(results);
        if (best7.chosen.length) entries.push({ athleteId, total: best7.total, complete: best7.complete });
      }
      entries.sort((a, b2) => b2.total - a.total);
      const list = await q('insert into ranking_lists (category_id) values ($1) returning id', [categoryId]);
      const listId = list.rows[0].id;
      for (let i = 0; i < entries.length; i++) {
        await q('insert into ranking_entries (ranking_list_id,athlete_id,added_ranking_score,rank) values ($1,$2,$3,$4)',
          [listId, entries[i].athleteId, entries[i].total, i + 1]);
      }
      await writeAudit({ req, actor, action: 'create', resourceType: 'ranking_lists', resourceId: listId, after: { categoryId, entryCount: entries.length } });
      return json(res, { ok: true, listId, entries });
    }

    // ── RANKING: public read of the latest published list for a category ──
    if (action === 'ranking') {
      const categoryId = parseInt(req.query.categoryId, 10);
      if (!categoryId) return json(res, { error: 'categoryId is required' }, 400);
      const list = (await q('select id, published_at from ranking_lists where category_id=$1 order by published_at desc limit 1', [categoryId])).rows[0];
      if (!list) return json(res, { ok: true, list: null, entries: [] });
      const entries = (await q(
        `select re.rank, re.athlete_id, re.added_ranking_score, a.name as athlete_name
           from ranking_entries re join athletes a on a.id = re.athlete_id
          where re.ranking_list_id = $1 order by re.rank`, [list.id])).rows;
      return json(res, { ok: true, list: rowToObj(list), entries: entries.map(rowToObj) });
    }

    // ── QUALIFY: compute qual_rank for every entry from its qualification-
    // round matches (Art. 12.5.1 ranking-tie resolution — DOMAIN.md §3.4).
    // Each archer's qualification round is its own kind='qualification'
    // match with exactly one match_entry (side 1) — not a 2-sided match. ──
    if (action === 'qualify' && req.method === 'POST') {
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const eventCategoryId = parseInt(b.eventCategoryId, 10);
      if (!eventCategoryId) return json(res, { error: 'eventCategoryId is required' }, 400);
      const ec = (await q('select distance_band from event_categories where id=$1', [eventCategoryId])).rows[0];
      if (!ec) return json(res, { error: 'Unknown event category' }, 404);
      const qualMatches = (await q(
        `select m.id as match_id, me.id as match_entry_id, me.entry_id
           from matches m join match_entries me on me.match_id = m.id
          where m.event_category_id = $1 and m.kind = 'qualification'`, [eventCategoryId])).rows;
      const candidates = [];
      for (const row of qualMatches) {
        const ends = (await q('select id from ends where match_entry_id=$1 and is_shootoff is not true', [row.match_entry_id])).rows;
        let arrows = [];
        for (const e of ends) {
          const a = (await q('select value, is_x from arrows where end_id=$1 and superseded_by is null', [e.id])).rows;
          arrows = arrows.concat(a);
        }
        candidates.push({ id: row.entry_id, arrows });
      }
      if (!candidates.length) return json(res, { ok: false, error: 'No qualification results recorded for this event category yet' }, 400);
      const { resolveRankingTies } = require('../_lib/scoring');
      const ranked = resolveRankingTies(candidates, ec.distance_band || 'short');
      for (let i = 0; i < ranked.length; i++) {
        await q('update entries set qual_rank=$1 where id=$2', [i + 1, ranked[i].id]);
      }
      await writeAudit({ req, actor, action: 'update', resourceType: 'entries', resourceId: eventCategoryId, after: { qualified: ranked.length } });
      return json(res, { ok: true, ranked: ranked.map((r, i) => ({ entryId: r.id, qualRank: i + 1, total: r.total, tiedGroup: r.tiedGroup })) });
    }

    // ── GENERATE-DRAW: build the FULL elimination bracket (every round, not
    // just round 1) from qual_rank (DOMAIN.md: "seeds elimination (1v64,
    // 2v63)"). Round 1 uses seeding.js's bracket-correct pairing/slot order
    // (fixed to properly separate top seeds — see that file's header
    // comment). Rounds 2+ are created as empty skeleton matches wired via
    // next_match_id/next_side (migration 023); a round-1 bye advances its
    // entry into the skeleton immediately, and a real match's winner
    // advances automatically when it resolves (maybeAdvanceWinner, called
    // from the 'end' and 'shootoff-judge' actions below). A bye is reported
    // but never given a fabricated match row. ──
    if (action === 'generate-draw' && req.method === 'POST') {
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const eventCategoryId = parseInt(b.eventCategoryId, 10);
      if (!eventCategoryId) return json(res, { error: 'eventCategoryId is required' }, 400);
      const ecRow = (await q(
        `select ec.*, c.division from event_categories ec join categories c on c.id = ec.category_id where ec.id=$1`, [eventCategoryId])).rows[0];
      if (!ecRow) return json(res, { error: 'Unknown event category' }, 404);
      const entries = (await q('select id, qual_rank from entries where event_category_id=$1 and qual_rank is not null order by qual_rank', [eventCategoryId])).rows;
      if (!entries.length) return json(res, { ok: false, error: 'No qualified entries — run "qualify" first' }, 400);
      const bracket = generateBracket(entries.map(e => ({ id: e.id, qualRank: e.qual_rank })));
      const format = ecRow.division === 'compound' ? 'cumulative' : 'set'; // Art. 12.1.4
      const targetPointsToWin = format === 'set' ? 6 : null;
      const endsToPlay = format === 'cumulative' ? 5 : null;
      const totalRounds = roundCount(bracket.bracketSize);

      // Skeleton matches for rounds 2..totalRounds, built from the final
      // backward so each round's next_match_id can point at an already-
      // created row. Keyed by "round-matchIndex" -> matches.id.
      const skeletonIds = {};
      for (let round = totalRounds; round >= 2; round--) {
        const matchesInRound = bracket.bracketSize / Math.pow(2, round);
        for (let idx = 0; idx < matchesInRound; idx++) {
          const nextId = round < totalRounds ? skeletonIds[`${round + 1}-${Math.floor(idx / 2)}`] : null;
          const nextSide = idx % 2 === 0 ? 1 : 2;
          const label = round === totalRounds ? 'Final' : `Round ${round} #${idx + 1}`;
          const row = await q(
            `insert into matches (event_category_id,kind,format,team_type,bracket_position,target_points_to_win,ends_to_play,round,next_match_id,next_side)
             values ($1,'elimination',$2,'individual',$3,$4,$5,$6,$7,$8) returning id`,
            [eventCategoryId, format, label, targetPointsToWin, endsToPlay, round, nextId || null, nextId ? nextSide : null]);
          skeletonIds[`${round}-${idx}`] = row.rows[0].id;
        }
      }

      // Round 1: real matches (wired to the round-2 skeleton) or byes
      // (whose entry advances into the skeleton immediately, no match row).
      const createdMatches = [];
      for (const m of bracket.matches) {
        const { nextMatchIndex, nextSide } = advancesTo(m.matchIndex);
        const nextMatchId = totalRounds >= 2 ? skeletonIds[`2-${nextMatchIndex}`] : null;
        if (m.bye || !m.entryA || !m.entryB) {
          if (nextMatchId && m.entryA) {
            await q('insert into match_entries (match_id,side,entry_id) values ($1,$2,$3) on conflict do nothing', [nextMatchId, nextSide, m.entryA.id]);
          }
          createdMatches.push({ ...m, matchId: null, round: 1 });
          continue;
        }
        const matchRow = await q(
          `insert into matches (event_category_id,kind,format,team_type,bracket_position,target_points_to_win,ends_to_play,round,next_match_id,next_side)
           values ($1,'elimination',$2,'individual',$3,$4,$5,1,$6,$7) returning id`,
          [eventCategoryId, format, m.bracketPosition, targetPointsToWin, endsToPlay, nextMatchId, nextMatchId ? nextSide : null]);
        const matchId = matchRow.rows[0].id;
        await q('insert into match_entries (match_id,side,entry_id) values ($1,1,$2)', [matchId, m.entryA.id]);
        await q('insert into match_entries (match_id,side,entry_id) values ($1,2,$2)', [matchId, m.entryB.id]);
        createdMatches.push({ ...m, matchId, round: 1 });
      }
      await writeAudit({ req, actor, action: 'create', resourceType: 'matches', resourceId: eventCategoryId,
        after: { bracketSize: bracket.bracketSize, totalRounds, matchesCreated: createdMatches.filter(m => m.matchId).length, byes: createdMatches.filter(m => m.bye).length } });
      return json(res, { ok: true, bracketSize: bracket.bracketSize, totalRounds, matches: createdMatches });
    }

    // ── BRACKET: public read of every match in an event_category's draw,
    // grouped by round, each with live computed state ("live results are a
    // view" — DOMAIN.md §1). ──
    if (action === 'bracket') {
      const eventCategoryId = parseInt(req.query.eventCategoryId, 10);
      if (!eventCategoryId) return json(res, { error: 'eventCategoryId is required' }, 400);
      const rows = (await q(`select id, round, bracket_position from matches where event_category_id=$1 and kind='elimination' order by round, id`, [eventCategoryId])).rows;
      const byRound = {};
      for (const row of rows) {
        const state = await computeMatchState(row.id);
        (byRound[row.round] = byRound[row.round] || []).push({ matchId: row.id, bracketPosition: row.bracket_position, ...state });
      }
      return json(res, { ok: true, rounds: byRound });
    }

    // ── ACTIVE-DRAWS: public list of event_categories that have a real
    // generated draw (at least one elimination match), for a directory
    // view like draw.html's "Active Draws" tab. Completion state is left
    // to the bracket view (computeMatchState is per-match and too costly
    // to run for every match of every draw just to list them). ──
    if (action === 'active-draws') {
      const rows = (await q(`
        select ec.id as event_category_id, ec.round_name, ec.distance_m,
               ev.name as event_name, ev.starts_on, ev.venue,
               c.division, c.gender, c.age_class,
               count(m.id)::int as total_matches,
               max(m.round) as total_rounds
          from event_categories ec
          join events ev on ev.id = ec.event_id
          join categories c on c.id = ec.category_id
          join matches m on m.event_category_id = ec.id and m.kind = 'elimination'
         group by ec.id, ec.round_name, ec.distance_m, ev.name, ev.starts_on, ev.venue, c.division, c.gender, c.age_class
         order by ev.starts_on desc nulls last, ec.id desc
         limit 100`)).rows;
      return json(res, { ok: true, draws: rows.map(rowToObj) });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('scoring:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
