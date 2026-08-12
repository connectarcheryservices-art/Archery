-- Archery.Services — migration 023
-- Round-to-round bracket advancement. Phase 3 (migration 021) only built
-- round 1 of an elimination draw; a real tournament needs winners to
-- actually advance into the next round. api/_lib/seeding.js's
-- bracketSlotOrder()/advancesTo() give the correct (bug-fixed — see that
-- file's header comment) bracket-adjacency structure; these columns store
-- the resulting wiring on each match.
alter table matches add column if not exists round int not null default 1;
alter table matches add column if not exists next_match_id bigint references matches(id) on delete set null;
alter table matches add column if not exists next_side smallint check (next_side in (1,2));

create index if not exists matches_next_match_idx on matches(next_match_id);
create index if not exists matches_event_cat_round_idx on matches(event_category_id, round);
