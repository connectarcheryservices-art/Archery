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
-- The full final-position -> percentage curve beyond 1st/2nd/3rd is NOT a
-- verified World Archery citation. Two direct fetch attempts against the
-- primary source PDF (extranet.worldarchery.sport/.../
-- World_Ranking_Calculation_System.pdf) both failed — it's an image-based
-- PDF this environment has no OCR tooling for. Product direction (this is
-- Archery.Services' own ranking of participation on the platform, not a
-- claimed byte-for-byte replica of WA's global ranking) resolved this: the
-- engine computes every position's percentage from a real, documented
-- formula (api/_lib/ranking.js: geometric decay anchored to the three
-- verified points, 1st=100%/2nd=85%/3rd=70%, floored so participation
-- always counts for something) rather than blocking on an unverified
-- table. This table is now an OPTIONAL override layer — empty by default,
-- consulted first, falls through to the formula for any position not
-- explicitly set here. Seed it with specific values only if a fuller
-- verified curve is sourced later.
create table if not exists ranking_position_percentages (
  position  int primary key,
  percent   numeric not null check (percent > 0 and percent <= 100)
);
-- The three positions independently verified against World Archery's own
-- system are seeded as exact overrides, so those specific positions use
-- the verified figure rather than the formula's close-but-approximate value
-- (e.g. the formula alone gives 3rd ≈72.25%; the verified figure is 70%).
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
