-- Archery.Services — migration 038
-- Bridges the public tournament-registration inbox to the real scoring
-- domain (categories/events/event_categories/entries — migration 021).
--
-- The gap this closes: approving a registration in api/_lib/inbox.js has
-- only ever incremented `tournaments.registered`. It never created an
-- `athletes` row or an `entries` row, so an approved registrant was never
-- actually enterable into that tournament's real, offline-capable scoring
-- system (ADR-0006/0007, commit ff96084). The public sign-up path and the
-- scoring engine built earlier this session have never been connected.
--
-- Age class is computed from the registrant's own (now-validated, migration
-- 037) date of birth, per World Archery Rule Book Book 2 Art. 4.2.1/4.2.3-
-- 4.2.5 (see api/_lib/age.js's computeAgeClass — full citation there), NOT
-- trusted from the registration form's free-text `discipline` field
-- (docs/DOMAIN.md §5: "Free-text discipline cannot express it").

-- `athletes` gains what's needed to (a) be found again on a second
-- registration by the same person, and (b) carry real, cited category
-- inputs going forward instead of nothing at all.
alter table athletes add column if not exists dob date;
alter table athletes add column if not exists email text;
alter table athletes add column if not exists club_id bigint references clubs(id) on delete set null;
create index if not exists athletes_email_idx on athletes(lower(email)) where email is not null;
create index if not exists athletes_club_idx on athletes(club_id);

-- `registrations` gains a real contact email (previously ONLY captured for
-- a minor's PARENT — an adult registrant, or a minor's own contact, had no
-- email field at all) and this is also the identity key used to find-or-
-- create the matching `athletes` row on approval, so the same person
-- registering for a second tournament links to their existing athlete
-- record rather than spawning a duplicate.
alter table registrations add column if not exists email text;
-- Traceability: what this registration actually became once approved, and
-- an idempotency guard — approving the same registration twice must not
-- create two athletes/entries rows.
alter table registrations add column if not exists athlete_id bigint references athletes(id) on delete set null;
alter table registrations add column if not exists entry_id bigint references entries(id) on delete set null;
-- Set when the registration's discipline/gender/dob could not be mapped
-- to a real category automatically (non-binary gender has no categories.
-- gender mapping today; an unclassified Para entry has no sport_class to
-- pick a category from) — surfaced to staff as "needs manual review"
-- rather than silently dropped or guessed at.
alter table registrations add column if not exists needs_manual_category text;
