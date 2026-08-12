// The scoring engine. Every rule here is cited to docs/DOMAIN.md, which
// cites World Archery Rulebook Book 3 (Target Archery), 2026-01-27. This
// module is pure computation over arrow rows — it never queries the
// database itself, so it can be tested exhaustively without one.
//
// "A score is a SUM. A tiebreak is ORDER BY value DESC, is_x DESC."
// (DOMAIN.md §1) — this module IS that SUM and that ORDER BY, made precise
// enough to actually resolve the cases that matter.
'use strict';

// ── ARROW-LEVEL AGGREGATES ──────────────────────────────────────────────
// Art. 12.1.1: two scorecards exist (electronic + paper); ours is a
// scorecard, not the authority. These functions compute FROM whatever
// arrows are actually recorded — they never invent a value.
function endTotal(arrows) {
  return arrows.reduce((sum, a) => sum + Number(a.value), 0);
}
function countXs(arrows) { return arrows.filter(a => a.is_x).length; }
function countValue(arrows, v) { return arrows.filter(a => Number(a.value) === v).length; }

// ── SET-PLAY SCORING (recurve / barebow) — Art. 12.1.4.1 / 12.1.4.2 ────
// "Highest score in the set -> 2 set points. Tied set -> 1 set point each."
// endsByArcher: [{ endNumber, arrows: [...] }, ...] for ONE archer/team,
// already in end order. Two archers' end lists must have matched endNumbers
// (the caller lines them up — this function just scores one side's set
// points given both sides' end totals).
function setPointsForEnd(myTotal, opponentTotal) {
  if (myTotal > opponentTotal) return 2;
  if (myTotal === opponentTotal) return 1;
  return 0;
}

// Given both sides' completed ends (aligned by endNumber), compute running
// set points and detect a winner. teamType is 'individual' (first to 6) or
// 'team'/'mixed_team' (first to 5) — Art. 12.1.4.1 / .2.
function setPlayState(sideAEnds, sideBEnds, teamType) {
  const target = teamType === 'individual' ? 6 : 5;
  const n = Math.min(sideAEnds.length, sideBEnds.length);
  let a = 0, b = 0;
  const endResults = [];
  for (let i = 0; i < n; i++) {
    const totalA = endTotal(sideAEnds[i].arrows);
    const totalB = endTotal(sideBEnds[i].arrows);
    const ptsA = setPointsForEnd(totalA, totalB);
    const ptsB = setPointsForEnd(totalB, totalA);
    a += ptsA; b += ptsB;
    endResults.push({ endNumber: sideAEnds[i].endNumber, totalA, totalB, ptsA, ptsB });
    if (a >= target || b >= target) {
      return { done: true, setPointsA: a, setPointsB: b, winnerSide: a > b ? 1 : 2, endResults, tiedAtCap: false };
    }
  }
  // All scheduled ends played (5 individual / 4 team) with no side reaching
  // the target -> a genuine tie in set points requiring a shoot-off
  // (Art. 12.5.2). For individual play the classic case is 5-5; DOMAIN.md
  // §3.4 is explicit that 8-8 in SET POINTS cannot occur under the
  // first-to-6 rule, so this function never reports one.
  const maxEnds = teamType === 'individual' ? 5 : 4;
  if (n >= maxEnds) {
    return { done: a !== b, setPointsA: a, setPointsB: b, winnerSide: a > b ? 1 : (b > a ? 2 : null), endResults, tiedAtCap: a === b };
  }
  return { done: false, setPointsA: a, setPointsB: b, winnerSide: null, endResults, tiedAtCap: false };
}

// ── CUMULATIVE SCORING (compound) — Art. 12.1.4.3 / 12.1.4.4 ───────────
// "Totals recorded each end. After 5 ends [individual] / 4 ends [team],
// highest total wins."
function cumulativeState(sideAEnds, sideBEnds, teamType) {
  const maxEnds = teamType === 'individual' ? 5 : 4;
  const totalA = sideAEnds.reduce((s, e) => s + endTotal(e.arrows), 0);
  const totalB = sideBEnds.reduce((s, e) => s + endTotal(e.arrows), 0);
  const endsPlayed = Math.min(sideAEnds.length, sideBEnds.length);
  if (endsPlayed < maxEnds) return { done: false, totalA, totalB, winnerSide: null, tiedAtCap: false };
  if (totalA === totalB) return { done: false, totalA, totalB, winnerSide: null, tiedAtCap: true }; // needs shoot-off, Art 12.5.2
  return { done: true, totalA, totalB, winnerSide: totalA > totalB ? 1 : 2, tiedAtCap: false };
}

// ── MATCH-TIE SHOOT-OFF — Art. 12.5.2.2 (individual), 12.5.2.3 (team) ──
// "A single arrow shoot-off for score. If the score is the same, the arrow
// closest to the centre... resolves the tie. If [that] is the same,
// successive single arrow shoot-offs will be conducted until the tie is
// resolved."
// shootoffEnds: [{ sequence, arrowsA:[...], arrowsB:[...], judgedClosestSide }]
// in order. judgedClosestSide (1|2|null) is the recorded judge decision
// used ONLY when the arrow scores tie AND a measurement was actually made
// (this module never invents a distance — DOMAIN.md §3.4.3: "do not fake a
// distance").
function resolveShootoff(shootoffEnds) {
  for (const round of shootoffEnds) {
    const scoreA = endTotal(round.arrowsA);
    const scoreB = endTotal(round.arrowsB);
    if (scoreA !== scoreB) return { resolved: true, winnerSide: scoreA > scoreB ? 1 : 2, round: round.sequence, method: 'score' };
    // Both athletes missed the scoring area entirely -> Art. 12.5.2.2 says
    // both shoot an additional arrow, i.e. proceed to the next round, not a
    // measurement.
    const bothMissed = round.arrowsA.every(a => a.is_miss) && round.arrowsB.every(a => a.is_miss);
    if (bothMissed) continue;
    if (round.judgedClosestSide === 1 || round.judgedClosestSide === 2) {
      return { resolved: true, winnerSide: round.judgedClosestSide, round: round.sequence, method: 'closest-to-centre' };
    }
    // Score tied and no closest-to-centre judgement recorded yet -> not
    // resolved; the caller must record one more shoot-off end (or the
    // judged measurement) before a winner can be declared. This is
    // intentional: the engine will not guess a winner.
    return { resolved: false, round: round.sequence, reason: 'tied_awaiting_measurement_or_next_round' };
  }
  return { resolved: false, reason: 'no_shootoff_rounds' };
}

// ── RANKING / QUALIFICATION TIES — Art. 12.5.1 ──────────────────────────
// "Except for those ties as set out in Article 12.5.2" (i.e. NOT match or
// elimination-entry ties — those use the shoot-off path above, "the system
// of Xs/10s and 10s/9s will not be used" per Art. 12.5.2).
// candidates: [{ id, arrows: [...] }] — all arrows shot in the round.
// distanceBand: 'long' | 'short' (event_categories.distance_band).
// Returns candidates re-ordered with ties broken as far as the rule allows;
// any group still tied after both tiebreak levels is marked `tiedGroup`
// (Art. 12.5.1: "declared equal... a disk toss decides" — a physical
// procedure this engine does not simulate).
function resolveRankingTies(candidates, distanceBand) {
  const withTotals = candidates.map(c => ({
    ...c,
    total: endTotal(c.arrows),
    xs: countXs(c.arrows),
    tens: countValue(c.arrows, 10),
    nines: countValue(c.arrows, 9),
  }));
  const cmp = distanceBand === 'long'
    ? (x, y) => (y.total - x.total) || (y.xs - x.xs) || (y.tens - x.tens)
    : (x, y) => (y.total - x.total) || (y.tens - x.tens) || (y.nines - x.nines);
  const sorted = [...withTotals].sort(cmp);
  // Mark groups that remain fully tied after the applicable tiebreak.
  for (let i = 0; i < sorted.length; i++) {
    const tieKey = distanceBand === 'long'
      ? `${sorted[i].total}|${sorted[i].xs}|${sorted[i].tens}`
      : `${sorted[i].total}|${sorted[i].tens}|${sorted[i].nines}`;
    const dupCount = sorted.filter(s => (distanceBand === 'long'
      ? `${s.total}|${s.xs}|${s.tens}` : `${s.total}|${s.tens}|${s.nines}`) === tieKey).length;
    sorted[i].tiedGroup = dupCount > 1;
  }
  return sorted;
}

module.exports = {
  endTotal, countXs, countValue,
  setPointsForEnd, setPlayState,
  cumulativeState,
  resolveShootoff,
  resolveRankingTies,
};
