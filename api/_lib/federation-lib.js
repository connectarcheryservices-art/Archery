// Shared federation-hierarchy helpers (migration 026's `federations` tree).
// Extracted from api/_handlers/federation.js so the SAME jurisdiction-walk
// logic backs every capability check across federation.js, rankings.js,
// federation-roster.js, federation-board.js — a security-critical
// tree-walk duplicated per-file is exactly the "secret with three copies"
// class of bug this codebase avoids elsewhere (userauth.js, esc.js).
'use strict';
const { q } = require('./db');

// Does userId hold one of `offices` (or ANY office, if offices is null) at
// federationId itself, or at any ANCESTOR of it? A national officer has
// jurisdiction over every state/district beneath them; a state officer
// over their districts; a district officer only over their own node.
async function hasJurisdiction(userId, federationId, offices = null) {
  if (!userId || !federationId) return false;
  let currentId = federationId;
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const row = (await q('select office from federation_members where user_id=$1 and federation_id=$2', [userId, currentId])).rows[0];
    if (row && (!offices || offices.includes(row.office))) return true;
    const parent = (await q('select parent_id from federations where id=$1', [currentId])).rows[0];
    currentId = parent ? parent.parent_id : null;
  }
  return false;
}
const isFederationOfficerOrAncestor = (userId, federationId) => hasJurisdiction(userId, federationId, null);
const isPresidentOrAncestor = (userId, federationId) => hasJurisdiction(userId, federationId, ['president']);

// The reverse walk: every federation id AT OR BELOW federationId (itself
// plus every descendant, however deep). A recursive CTE rather than a JS
// loop — unlike hasJurisdiction's single upward chain, this can fan out
// (a national node has many states, each with many districts), so the
// set-based form is both simpler and avoids an N+1 query per level.
async function federationDescendantIds(federationId) {
  if (!federationId) return [];
  const r = await q(
    `with recursive descendants as (
       select id from federations where id = $1
       union all
       select f.id from federations f join descendants d on f.parent_id = d.id
     )
     select id from descendants`,
    [federationId]);
  return r.rows.map(row => row.id);
}

// Every club whose federation_id resolves at-or-under federationId — the
// building block for both federation-roster.js (member sync) and
// rankings.js's federation-scoped leaderboard.
async function clubIdsUnderFederation(federationId) {
  const fedIds = await federationDescendantIds(federationId);
  if (!fedIds.length) return [];
  const r = await q('select id from clubs where federation_id = any($1)', [fedIds]);
  return r.rows.map(row => row.id);
}

module.exports = { hasJurisdiction, isFederationOfficerOrAncestor, isPresidentOrAncestor, federationDescendantIds, clubIdsUnderFederation };
