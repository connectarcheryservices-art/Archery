// Elimination bracket seeding — pure computation, no DB.
// DOMAIN.md (cited to World Archery Rulebook Book 3): "Elimination |
// Bracket matches (1v64, 2v63 …), seeded from qualification." §7 flags
// draw.html's existing "Draw Generator" as seeding from nothing — this is
// the real replacement.
//
// Two distinct things are true at once, and conflating them is a real bug:
//   1. WHO PLAYS WHOM in round 1 — the pairing SET DOMAIN.md names:
//      {1v64, 2v63, 3v62, ... 32v33}. Verified against the primary source.
//   2. WHICH BRACKET SLOT each pairing occupies — this determines who can
//      meet in round 2, the semifinal, etc. This is NOT sport-specific and
//      has no rulebook citation to fetch; it's the standard recursive
//      tournament-bracket-seeding algorithm used across essentially every
//      seeded single-elimination format (verified here by property, not by
//      citation: seed 1 and seed 2 must never be able to meet before the
//      final; seeds 1-4 never before the semifinal; and so on).
//   A naive "list the pairings in seed order, advance adjacent matches" ARRANGEMENT
//   gets (1) right but (2) wrong — for an 8-bracket it lets seed 1 and seed 2
//   meet in round 2, not the final. The recursive slot algorithm below gets
//   both right simultaneously: the SET of round-1 pairings is identical to
//   DOMAIN.md's citation, but their ARRANGEMENT into match slots is the one
//   that correctly keeps top seeds apart for the games that matter.
'use strict';

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// entryCount: how many athletes actually qualified. Returns the smallest
// standard bracket size (8/16/32/64/128...) that fits them.
function bracketSize(entryCount) {
  if (entryCount < 1) return 0;
  return nextPowerOf2(entryCount);
}

// The standard recursive seeding order: seed 1 always occupies slot 0; each
// doubling places the "mirror" seed (n+1-s) next to s, so that at every
// bracket depth the two halves are seeded oppositely. Property (proven by
// construction, and checked by test): for any two seeds i < j, they occupy
// positions that can only meet in round ceil(log2(j)) or later — seeds 1
// and 2 are always in different halves of every sub-bracket except the
// final.
function bracketSlotOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

// Round-1 pairs, arranged in correct bracket order (pairs[0] & pairs[1] feed
// round-2 match 0, pairs[2] & pairs[3] feed round-2 match 1, and so on).
// seedA is always the better (lower-numbered) seed of the pair, matching
// DOMAIN.md's "1v64, 2v63..." style. A seed number greater than entryCount
// does not exist — its pairing partner then has no opponent and receives a
// bye (falls directly out of the formula, not a separate policy).
function seedPairs(entryCount) {
  const size = bracketSize(entryCount);
  const slots = bracketSlotOrder(size);
  const pairs = [];
  for (let i = 0; i < slots.length; i += 2) {
    const lo = Math.min(slots[i], slots[i + 1]);
    const hi = Math.max(slots[i], slots[i + 1]);
    pairs.push({ seedA: lo, seedB: hi <= entryCount ? hi : null, bye: hi > entryCount });
  }
  return { bracketSize: size, pairs };
}

// Maps seed numbers onto real entry ids, given entries already sorted by
// qualification rank ascending (1st = best = qual_rank 1). Never invents an
// athlete for an empty seed slot. matchIndex (0-based) is bracket-ordered,
// so round-2 match k is always fed by matchIndex 2k and 2k+1 of round 1 —
// the wiring downstream (advance-winner) relies on this.
function generateBracket(entriesSortedByQualRank) {
  const entryCount = entriesSortedByQualRank.length;
  const { bracketSize: size, pairs } = seedPairs(entryCount);
  const bySeed = new Map(entriesSortedByQualRank.map((e, i) => [i + 1, e]));
  const matches = pairs.map((p, i) => ({
    bracketPosition: `${p.seedA}v${p.seedB || '(bye)'}`,
    matchIndex: i,
    entryA: bySeed.get(p.seedA) || null,
    entryB: p.seedB ? (bySeed.get(p.seedB) || null) : null,
    bye: p.bye,
  }));
  return { bracketSize: size, entryCount, matches };
}

// How many rounds a bracket of this size has (8 -> 3: R1, SF, F).
function roundCount(size) {
  return size > 1 ? Math.round(Math.log2(size)) : 0;
}

// Which round-2 match index a round-1 match feeds into, and which side.
// Generalizes to any round: matchIndex m in round r feeds match
// floor(m/2) in round r+1, side (m%2===0 ? 1 : 2).
function advancesTo(matchIndex) {
  return { nextMatchIndex: Math.floor(matchIndex / 2), nextSide: matchIndex % 2 === 0 ? 1 : 2 };
}

module.exports = { nextPowerOf2, bracketSize, bracketSlotOrder, seedPairs, generateBracket, roundCount, advancesTo };
