// /api/selection/<action> — squad/team selection from the platform's own
// published ranking (never a hand-typed list — CLAUDE.md §1.1). A
// selection snapshots the ranking at generation time (append-only, same
// philosophy as arrows/ends); staff may override an algorithmic pick, but
// only with a recorded reason, and the override is itself audited.
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { checkAdmin } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { writeAudit } = require('../_lib/audit');

const rowToObj = row => { const o = {}; for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v; return o; };
async function requireStaff(req) {
  const actor = await checkAdmin(req);
  if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) return null;
  return actor;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = req.query.action;
  try {
    // ── GENERATE: top `size` athletes from the LATEST published ranking
    // list for this category. Refuses if no ranking has ever been
    // published — never falls back to guessing a squad. ──
    if (action === 'generate' && req.method === 'POST') {
      const actor = await requireStaff(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const categoryId = parseInt(b.categoryId, 10);
      const size = parseInt(b.size, 10);
      const name = String(b.name || '').trim().slice(0, 200);
      if (!categoryId || !Number.isFinite(size) || size < 1) return json(res, { error: 'categoryId and a positive size are required' }, 400);
      if (!name) return json(res, { error: 'A selection name is required' }, 400);

      const list = (await q(
        `select id, published_at from ranking_lists where category_id=$1 order by published_at desc limit 1`,
        [categoryId])).rows[0];
      if (!list) return json(res, { ok: false, error: 'No ranking has ever been published for this category — publish one first (see /api/scoring/publish-ranking).' }, 400);

      const entries = (await q(
        `select re.athlete_id, re.rank, re.added_ranking_score
           from ranking_entries re where re.ranking_list_id=$1
          order by re.rank asc limit $2`,
        [list.id, size])).rows;
      if (!entries.length) return json(res, { ok: false, error: 'The latest published ranking for this category is empty.' }, 400);

      const sel = await q(
        `insert into selections (category_id, ranking_list_id, name, size, created_by) values ($1,$2,$3,$4,$5) returning id`,
        [categoryId, list.id, name, size, actor.name]);
      const selectionId = sel.rows[0].id;
      for (const e of entries) {
        await q(
          `insert into selection_entries (selection_id, athlete_id, rank_at_selection, score_at_selection) values ($1,$2,$3,$4)`,
          [selectionId, e.athlete_id, e.rank, e.added_ranking_score]);
      }
      await writeAudit({ req, actor, action: 'create', resourceType: 'selections', resourceId: selectionId,
        after: { categoryId, rankingListId: list.id, name, size, athleteCount: entries.length } });
      return json(res, { ok: true, selectionId, rankingListId: list.id, athleteCount: entries.length });
    }

    // ── LIST: selections for a category (public read). ──
    if (action === 'list' && req.method === 'GET') {
      const categoryId = parseInt(req.query.categoryId, 10);
      if (!categoryId) return json(res, { error: 'categoryId is required' }, 400);
      const rows = (await q(
        `select id, name, size, finalized, created_at from selections where category_id=$1 order by created_at desc`,
        [categoryId])).rows;
      return json(res, rows.map(rowToObj));
    }

    // ── GET: one selection with its entries + athlete names (public read). ──
    if (action === 'get' && req.method === 'GET') {
      const selectionId = parseInt(req.query.id, 10);
      if (!selectionId) return json(res, { error: 'id is required' }, 400);
      const selection = (await q('select * from selections where id=$1', [selectionId])).rows[0];
      if (!selection) return json(res, { error: 'Not found' }, 404);
      const entries = (await q(
        `select se.*, a.name as athlete_name from selection_entries se
           join athletes a on a.id = se.athlete_id
          where se.selection_id=$1 order by se.rank_at_selection asc`,
        [selectionId])).rows;
      return json(res, { ok: true, selection: rowToObj(selection), entries: entries.map(rowToObj) });
    }

    // ── OVERRIDE: staff flips an entry's inclusion — a reason is required
    // whenever excluding a selected athlete (an injury, a withdrawal, a
    // disciplinary matter — this is exactly the kind of decision a
    // federation must be able to justify later). ──
    if (action === 'override' && req.method === 'POST') {
      const actor = await requireStaff(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const selectionId = parseInt(b.selectionId, 10);
      const athleteId = parseInt(b.athleteId, 10);
      const included = !!b.included;
      const reason = String(b.reason || '').trim().slice(0, 500);
      if (!selectionId || !athleteId) return json(res, { error: 'selectionId and athleteId are required' }, 400);
      if (!included && !reason) return json(res, { error: 'A reason is required to exclude a selected athlete.' }, 400);
      const selection = (await q('select finalized from selections where id=$1', [selectionId])).rows[0];
      if (!selection) return json(res, { error: 'Unknown selection' }, 404);
      if (selection.finalized) return json(res, { error: 'This selection is finalized and can no longer be changed.' }, 409);
      const r = await q(
        `update selection_entries set included=$1, override_reason=$2, overridden_by=$3, overridden_at=now()
          where selection_id=$4 and athlete_id=$5 returning id`,
        [included, reason || null, actor.name, selectionId, athleteId]);
      if (!r.rows[0]) return json(res, { error: 'That athlete is not in this selection.' }, 404);
      await writeAudit({ req, actor, action: 'update', resourceType: 'selection_entries', resourceId: r.rows[0].id, after: { included, reason } });
      return json(res, { ok: true });
    }

    // ── FINALIZE: locks the selection against further changes. ──
    if (action === 'finalize' && req.method === 'POST') {
      const actor = await requireStaff(req);
      if (!actor) return json(res, { error: 'Unauthorised' }, 401);
      const b = readBody(req);
      const selectionId = parseInt(b.selectionId, 10);
      if (!selectionId) return json(res, { error: 'selectionId is required' }, 400);
      const r = await q(`update selections set finalized=true where id=$1 returning id`, [selectionId]);
      if (!r.rows[0]) return json(res, { error: 'Unknown selection' }, 404);
      await writeAudit({ req, actor, action: 'update', resourceType: 'selections', resourceId: selectionId, after: { finalized: true } });
      return json(res, { ok: true });
    }

    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('selection:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
