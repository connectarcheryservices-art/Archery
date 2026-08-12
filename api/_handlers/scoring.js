// /api/scoring/<action> — the arrow/end/match scoring domain (DOMAIN.md).
// Setup resources (categories/events/event-categories/entries/matches) are
// owner/manager-authored records (no dedicated "judge" staff role exists
// yet — ROLES in staff.js is ['manager','editor','support'] — so scoring
// write access is owner/manager only for now, matching "a scoring bug is a
// stolen medal" severity; a judge role is real follow-on work, not a
// silent guess). Reads are public — "live results are a view" (DOMAIN.md §1).
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');
const { computeMatchState } = require('../_lib/scoring-db');
const { rankingScoreForResult, selectBest7 } = require('../_lib/ranking');

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
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      if (!b.eventCategoryId || !b.athleteId) return json(res, { error: 'eventCategoryId and athleteId are required' }, 400);
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
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const matchEntryId = parseInt(b.matchEntryId, 10);
      const endNumber = parseInt(b.endNumber, 10);
      const arrows = Array.isArray(b.arrows) ? b.arrows : [];
      if (!matchEntryId || !Number.isFinite(endNumber) || !arrows.length) {
        return json(res, { error: 'matchEntryId, endNumber and a non-empty arrows array are required' }, 400);
      }
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
      const endRow = await q(
        `insert into ends (match_entry_id,end_number,is_shootoff,shootoff_sequence,judge,client_id)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [matchEntryId, endNumber, !!b.isShootoff, b.shootoffSequence || null, b.judge || (actor.name || null), b.clientId || null]);
      const endId = endRow.rows[0].id;
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i];
        await q(
          `insert into arrows (end_id,sequence,value,is_x,is_miss,x_coord,y_coord,client_id,actor)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [endId, i + 1, Number(a.value), !!a.isX, !!a.isMiss, a.x ?? null, a.y ?? null, a.clientId || null, actor.name || actor.username || 'owner']);
      }
      await writeAudit({ req, actor, action: 'create', resourceType: 'ends', resourceId: endId,
        after: { matchEntryId, endNumber, arrowCount: arrows.length } });
      return json(res, { ok: true, id: endId });
    }

    // ── SHOOTOFF JUDGE DECISION: record closest-to-centre (Art. 12.5.2.2) ──
    if (action === 'shootoff-judge' && req.method === 'POST') {
      const actor = await requireScorer(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const endId = parseInt(b.endId, 10);
      if (!endId) return json(res, { error: 'endId is required' }, 400);
      await q('update ends set judged_closest_to_centre=$1, judge=$2 where id=$3', [!!b.closest, b.judge || actor.name || null, endId]);
      await writeAudit({ req, actor, action: 'update', resourceType: 'ends', resourceId: endId, after: { judgedClosestToCentre: !!b.closest } });
      return json(res, { ok: true });
    }

    // ── RANKING RESULT: record a final position for an entry, compute its
    // ranking_score from the (partially verified) percentage table — see
    // migration 022 for why an unconfigured position is refused, not guessed. ──
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
      const positionPercentages = Object.fromEntries(pctRows.map(r => [r.position, Number(r.percent)]));
      const monthsOld = Number(b.monthsOld) || 0;
      const computed = rankingScoreForResult({ eventGroup, finalPosition, monthsOld }, positionPercentages);
      if (computed.score == null) {
        return json(res, { ok: false, error: `Cannot compute a ranking score: ${computed.reason}. ${computed.reason === 'position_percentage_not_configured' ? 'Position ' + finalPosition + ' has no verified percentage yet — add it to ranking_position_percentages once sourced from the primary document.' : ''}` }, 422);
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

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('scoring:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
