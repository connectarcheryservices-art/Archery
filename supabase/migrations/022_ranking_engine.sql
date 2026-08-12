-- Archery.Services — migration 022
-- Ranking engine config. DOMAIN.md §4: "ranking_score = base_points ×
-- position_% × period_multiplier", cited to the World Ranking Calculation
-- System document (01 Oct 2022, v1.0) and the Oct-2022 ranking-overhaul
-- announcement.
--
-- Verified facts, hardcoded below because they're corroborated by both
-- docs/DOMAIN.md and an independent fetch of the primary source's summary:
--   - Five event groups: 1=100, 2=80, 3=60, 4=40, 5=20 base points.
--   - 24-month validity; decays to 75% at 12mo, 50% at 16mo, 25% at 20mo.
--
-- NOT hardcoded, deliberately: the full final-position -> percentage curve.
-- Two direct fetch attempts against the primary source PDF
-- (extranet.worldarchery.sport/.../World_Ranking_Calculation_System.pdf)
-- both failed — it's an image-based PDF this environment has no OCR tooling
-- for. Independent corroboration gives only 1st=100%, 2nd=85%, 3rd=70%,
-- "decreasing progressively" beyond that with no exact figures. Inventing
-- the rest of that curve would be fabricated data driving a real athlete's
-- ranking (CLAUDE.md §1.1) — worse than leaving it visibly incomplete. This
-- table is seeded with ONLY the three verified points; ranking_score
-- computation for an unconfigured position is refused, not guessed, until
-- a federation technical delegate supplies the rest (same posture as
-- DOMAIN.md §8's other "ask, don't guess" items).
create table if not exists ranking_position_percentages (
  position  int primary key,
  percent   numeric not null check (percent > 0 and percent <= 100)
);
insert into ranking_position_percentages (position, percent) values
  (1, 100), (2, 85), (3, 70)
on conflict (position) do nothing;

-- Round type feeds the best-7 composition rule (DOMAIN.md §4: "Best 7
-- results: 4 outdoor + 2 indoor + 1 field"). Stored on event_categories
-- (migration 021) since a round's type is a property of that round, not a
-- separate lookup.
alter table event_categories add column if not exists round_type text
  check (round_type in ('outdoor','indoor','field'));

create index if not exists ranking_results_athlete_idx on ranking_results(athlete_id, event_category_id);
