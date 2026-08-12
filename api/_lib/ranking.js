// Ranking engine — pure computation, no DB. Formula structure cited to
// docs/DOMAIN.md §4 (World Ranking Calculation System, 01 Oct 2022 v1.0;
// ranking overhaul announcement Oct 2022). See migration 022 for what is
// and isn't independently verified against that primary source.
//
// This is Archery.Services' OWN ranking, computed from participation
// recorded on the platform — not a byte-for-byte replica of World
// Archery's global ranking (explicit product direction: rank on the
// platform's own available data, for events run through the platform,
// not gated on data this environment could not fetch/verify). It reuses
// the SAME verified formula shape (base_points × position_% × period
// decay) and event-group base points, because that structure is real and
// confirmed — but the position->percentage curve below is Archery.Services
// policy, not a claimed WA citation.
'use strict';

const EVENT_GROUP_BASE_POINTS = { 1: 100, 2: 80, 3: 60, 4: 40, 5: 20 };

// DOMAIN.md §4: "24-month validity, decaying to 75% after 12 months, 50%
// after 16, 25% after 20." A result 24 months or older no longer counts.
function periodMultiplier(monthsOld) {
  if (monthsOld < 12) return 1;
  if (monthsOld < 16) return 0.75;
  if (monthsOld < 20) return 0.5;
  if (monthsOld < 24) return 0.25;
  return 0; // expired
}

// Archery.Services position-percentage curve. Anchored to the three points
// independently corroborated for World Archery's own system (1st=100%,
// 2nd=85%, 3rd=70%) with a geometric decay (rate 0.85, matching the
// verified 1st->2nd drop exactly) extended smoothly to every position
// beyond — never a lookup table that runs out and blocks scoring. Floored
// at MIN_PCT so real participation always counts for something rather than
// decaying to zero. `overrides` (from ranking_position_percentages) lets an
// admin hand-tune specific positions later — e.g. if a fuller verified WA
// curve is sourced — without changing this formula for everyone else.
const DECAY_RATE = 0.85;
const MIN_PCT = 5;
function positionPercent(position, overrides = {}) {
  if (overrides[position] != null) return Number(overrides[position]);
  if (position < 1) return 0;
  return Math.max(MIN_PCT, round2(100 * Math.pow(DECAY_RATE, position - 1)));
}

function rankingScoreForResult({ eventGroup, finalPosition, monthsOld }, overrides = {}) {
  const basePoints = EVENT_GROUP_BASE_POINTS[eventGroup];
  if (!basePoints) return { score: null, reason: 'unknown_event_group' };
  if (!(finalPosition >= 1)) return { score: null, reason: 'invalid_position' };
  const pct = positionPercent(finalPosition, overrides);
  const mult = periodMultiplier(monthsOld);
  if (mult === 0) return { score: null, reason: 'expired' };
  const score = round2(basePoints * (pct / 100) * mult);
  return { score, reason: null, basePoints, positionPct: pct, periodMultiplier: mult };
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// DOMAIN.md §4: "Best 7 results: 4 outdoor + 2 indoor + 1 field (individual,
// able-bodied)." results: [{ id, roundType, score }], score already computed
// (rankingScoreForResult, only entries with a real score — never null/guessed).
// Composition is enforced by TYPE, not just "top 7 overall" — a fifth great
// outdoor result does not bump the required indoor/field slots.
const COMPOSITION = { outdoor: 4, indoor: 2, field: 1 };
function selectBest7(results) {
  const byType = { outdoor: [], indoor: [], field: [] };
  for (const r of results) {
    if (r.score == null) continue; // never include an unscored/guessed result
    if (byType[r.roundType]) byType[r.roundType].push(r);
  }
  const chosen = [];
  for (const [type, slots] of Object.entries(COMPOSITION)) {
    const best = [...byType[type]].sort((a, b) => b.score - a.score).slice(0, slots);
    chosen.push(...best.map(r => ({ ...r, roundType: type })));
  }
  const total = round2(chosen.reduce((s, r) => s + r.score, 0));
  return { chosen, total, complete: chosen.length === 7 };
}

module.exports = { EVENT_GROUP_BASE_POINTS, periodMultiplier, positionPercent, rankingScoreForResult, selectBest7, round2 };
