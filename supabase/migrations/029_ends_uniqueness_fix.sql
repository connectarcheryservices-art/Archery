-- Archery.Services — migration 029
-- Fixes a real, pre-existing correctness bug in migration 021's `ends` table,
-- found while building the scoring-conflict detection this migration exists
-- to support (docs/THREAT_MODEL.md T13). Not a new problem this introduces —
-- a bug this closes that predates it.
--
-- `ends_match_entry_id_end_number_shootoff_sequence_key` —
-- `unique (match_entry_id, end_number, shootoff_sequence)` — looks like it
-- stops two ends rows existing for the same (match_entry, end_number). It
-- does not. Standard SQL treats every NULL as distinct from every other
-- NULL for uniqueness purposes, and `shootoff_sequence` is NULL on every
-- regular (non-shoot-off) end — which is the common case, not the
-- exception. Verified empirically against this exact constraint: two
-- `insert into ends` calls for the same match_entry_id + end_number, both
-- with shootoff_sequence NULL, both succeed. The constraint was only ever
-- doing real work for shoot-off ends (which always carry a real sequence
-- number).
--
-- Consequence: a genuine double-submission for the same end — an
-- operator's double-tap on "Record End" before the button disabled, or (had
-- the offline queue shipped on top of the unfixed constraint) two devices
-- racing on a spotty connection — inserted a SECOND `ends` row instead of
-- colliding. `loadMatchEntryEnds` (api/_lib/scoring-db.js) has no
-- dedup-by-end_number step; it lists every non-superseded end for a
-- match_entry and sums all of them. A silently duplicated end is a
-- silently doubled score in a live match — exactly the "stolen medal"
-- CLAUDE.md §1.10 names as the one class of bug tests exist to catch.
--
-- Fix: two PARTIAL unique indexes, one per case, so NULL is never asked to
-- do uniqueness work:
--   • no shoot-off (shootoff_sequence IS NULL): one end per
--     (match_entry_id, end_number), full stop.
--   • shoot-off (shootoff_sequence IS NOT NULL): one end per
--     (match_entry_id, end_number, shootoff_sequence) — every shoot-off
--     round reuses the same end_number (score.html sets it to
--     maxEnds+1 for every round) and is distinguished only by sequence.
-- Once this is in place, api/_handlers/scoring.js's 'end' action actually
-- gets the unique-violation (23505) its conflict-detection code has been
-- written to expect, instead of a silent second row.

alter table ends drop constraint if exists ends_match_entry_id_end_number_shootoff_sequence_key;

create unique index if not exists ends_unique_regular_idx
  on ends (match_entry_id, end_number) where shootoff_sequence is null;
create unique index if not exists ends_unique_shootoff_idx
  on ends (match_entry_id, end_number, shootoff_sequence) where shootoff_sequence is not null;
