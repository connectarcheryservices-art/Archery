// Elimination bracket seeding — pure computation, no DB.
// DOMAIN.md (cited to World Archery Rulebook Book 3): "Elimination |
// Bracket matches (1v64, 2v63 …), seeded from qualification." §7 flags
// draw.html's existing "Draw Generator" as seeding from nothing — this is
// the real replacement.
//
// Round 1 pairs seed i against seed (bracketSize + 1 - i) — the exact
// pattern DOMAIN.md names (1v64, 2v63, 3v62, ... 32v33 for a 64-bracket).
// Archery elimination brackets do not use recursive/snake reseeding for
// later rounds: round 2 onward simply follows fixed bracket position
// (winner of match 1 meets winner of match 32, etc.), not a fresh pairing
// by seed — only round 1 is seed-derived.
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

// Round-1 pairs by SEED NUMBER (1..bracketSize), independent of which real
// athletes hold those seeds. A seed number greater than entryCount does not
// exist — its pairing partner then has no opponent and receives a bye
// (automatic advancement), which falls directly out of the 1v-last pairing
// formula rather than needing a separate bye policy to invent.
function seedPairs(entryCount) {
  const size = bracketSize(entryCount);
  const pairs = [];
  for (let i = 1; i <= size / 2; i++) {
    const opponent = size + 1 - i;
    pairs.push({
      seedA: i,
      seedB: opponent <= entryCount ? opponent : null, // null = no such seed exists -> bye
      bye: opponent > entryCount,
    });
  }
  return { bracketSize: size, pairs };
}

// Maps seed numbers onto real entry ids, given entries already sorted by
// qualification rank ascending (1st = best = qual_rank 1). Never invents an
// athlete for an empty seed slot — a bracket with fewer entries than the
// bracket size just has fewer round-1 matches and more byes, exactly as
// real elimination draws do.
function generateBracket(entriesSortedByQualRank) {
  const entryCount = entriesSortedByQualRank.length;
  const { bracketSize: size, pairs } = seedPairs(entryCount);
  const bySeed = new Map(entriesSortedByQualRank.map((e, i) => [i + 1, e]));
  const matches = pairs.map((p, i) => ({
    bracketPosition: `${p.seedA}v${p.seedB || '(bye)'}`,
    matchIndex: i + 1,
    entryA: bySeed.get(p.seedA) || null,
    entryB: p.seedB ? (bySeed.get(p.seedB) || null) : null,
    bye: p.bye,
  }));
  return { bracketSize: size, entryCount, matches };
}

module.exports = { nextPowerOf2, bracketSize, seedPairs, generateBracket };
