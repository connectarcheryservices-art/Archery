// Bridges the pure scoring engine (api/_lib/scoring.js) to real database
// rows. This is the only place scoring.js's inputs get built from SQL — the
// engine itself never touches the database (DOMAIN.md §1: store arrows, not
// scores; a score is always a SUM computed here, never a cached column).
'use strict';
const { q } = require('./db');
const scoring = require('./scoring');

async function loadMatchEntryEnds(matchEntryId) {
  const ends = (await q(
    `select id, end_number, is_shootoff, shootoff_sequence, judged_closest_to_centre
       from ends where match_entry_id=$1 and is_shootoff is not true
       order by end_number`, [matchEntryId])).rows;
  const out = [];
  for (const e of ends) {
    const arrows = (await q(
      `select value, is_x, is_miss from arrows
        where end_id=$1 and superseded_by is null order by sequence`, [e.id])).rows;
    out.push({ endNumber: e.end_number, arrows });
  }
  return out;
}

async function loadShootoffRounds(matchEntryIdA, matchEntryIdB) {
  const endsA = (await q(
    `select id, shootoff_sequence, judged_closest_to_centre from ends
      where match_entry_id=$1 and is_shootoff is true order by shootoff_sequence`, [matchEntryIdA])).rows;
  const endsB = (await q(
    `select id, shootoff_sequence, judged_closest_to_centre from ends
      where match_entry_id=$1 and is_shootoff is true order by shootoff_sequence`, [matchEntryIdB])).rows;
  const rounds = [];
  const n = Math.min(endsA.length, endsB.length);
  for (let i = 0; i < n; i++) {
    const arrowsA = (await q(`select value, is_x, is_miss from arrows where end_id=$1 and superseded_by is null order by sequence`, [endsA[i].id])).rows;
    const arrowsB = (await q(`select value, is_x, is_miss from arrows where end_id=$1 and superseded_by is null order by sequence`, [endsB[i].id])).rows;
    let judgedClosestSide = null;
    if (endsA[i].judged_closest_to_centre === true) judgedClosestSide = 1;
    else if (endsB[i].judged_closest_to_centre === true) judgedClosestSide = 2;
    rounds.push({ sequence: endsA[i].shootoff_sequence, arrowsA, arrowsB, judgedClosestSide });
  }
  return rounds;
}

// Full computed state for a match: set/cumulative score, whether it's
// decided, and (if tied at the cap) shoot-off resolution — all derived
// live from arrows, never from a stored "winner" column except as a cache
// of what was already computed (matches.winner_match_entry_id is set once,
// by this function's caller, and is never the source of truth on read).
async function computeMatchState(matchId) {
  const match = (await q('select * from matches where id=$1', [matchId])).rows[0];
  if (!match) return null;
  const entries = (await q(
    `select me.*, a.name as athlete_name from match_entries me
       join entries e on e.id = me.entry_id
       join athletes a on a.id = e.athlete_id
      where me.match_id=$1 order by me.side`, [matchId])).rows;
  if (entries.length !== 2 && match.kind !== 'qualification') {
    return { match, entries, state: null, error: 'match does not have both sides recorded yet' };
  }
  if (match.kind === 'qualification') {
    // Qualification is one archer's round — just their total, no opponent.
    const ends = await loadMatchEntryEnds(entries[0].id);
    const total = ends.reduce((s, e) => s + scoring.endTotal(e.arrows), 0);
    return { match, entries, state: { total, endsPlayed: ends.length } };
  }
  const [entryA, entryB] = entries;
  const endsA = await loadMatchEntryEnds(entryA.id);
  const endsB = await loadMatchEntryEnds(entryB.id);
  let state = match.format === 'set'
    ? scoring.setPlayState(endsA, endsB, match.team_type)
    : scoring.cumulativeState(endsA, endsB, match.team_type);

  let shootoff = null;
  if (!state.done && state.tiedAtCap) {
    const rounds = await loadShootoffRounds(entryA.id, entryB.id);
    if (rounds.length) {
      shootoff = scoring.resolveShootoff(rounds);
      if (shootoff.resolved) state = { ...state, done: true, winnerSide: shootoff.winnerSide };
    }
  }
  return { match, entries, state, shootoff };
}

// If a match is now decided AND wired to a next-round match
// (matches.next_match_id/next_side, migration 023), insert the winner's
// entry into that next match's slot — real bracket advancement, not just a
// round-1 pairing tool. Idempotent (ON CONFLICT DO NOTHING via the existing
// unique(match_id,side,entry_id) constraint acting as a natural guard —
// re-checking an already-decided match after another end/judge-call retry
// must not error or duplicate the advancement).
async function maybeAdvanceWinner(matchId) {
  const result = await computeMatchState(matchId);
  if (!result || !result.state || !result.state.done || result.state.winnerSide == null) return null;
  const match = result.match;
  if (!match.next_match_id || !match.next_side) return null;
  const winnerEntry = result.entries.find(e => e.side === result.state.winnerSide);
  if (!winnerEntry) return null;
  const existing = await q('select 1 from match_entries where match_id=$1 and side=$2', [match.next_match_id, match.next_side]);
  if (existing.rows[0]) return null; // already advanced
  await q('insert into match_entries (match_id,side,entry_id) values ($1,$2,$3)', [match.next_match_id, match.next_side, winnerEntry.entry_id]);
  return { nextMatchId: match.next_match_id, nextSide: match.next_side, entryId: winnerEntry.entry_id };
}

module.exports = { loadMatchEntryEnds, loadShootoffRounds, computeMatchState, maybeAdvanceWinner };
