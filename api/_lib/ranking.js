// Ranking engine — pure computation, no DB. Cited to docs/DOMAIN.md §4
// (World Ranking Calculation System, 01 Oct 2022 v1.0; ranking overhaul
// announcement Oct 2022). See migration 022 for what is and isn't verified.
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

// positionPercentages: Map/object of {position: percent}, e.g. from
// ranking_position_percentages (migration 022) — NEVER hardcoded here, since
// most of that table is unverified (see the migration's own comment). A
// position with no configured percentage returns null rather than a guess.
function rankingScoreForResult({ eventGroup, finalPosition, monthsOld }, positionPercentages) {
  const basePoints = EVENT_GROUP_BASE_POINTS[eventGroup];
  if (!basePoints) return { score: null, reason: 'unknown_event_group' };
  const pct = positionPercentages[finalPosition];
  if (pct == null) return { score: null, reason: 'position_percentage_not_configured' };
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

module.exports = { EVENT_GROUP_BASE_POINTS, periodMultiplier, rankingScoreForResult, selectBest7, round2 };
