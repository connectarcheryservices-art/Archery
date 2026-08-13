-- Archery.Services — migration 037
-- Age assurance + verifiable parental consent for TOURNAMENT REGISTRATIONS
-- (CLAUDE.md §1.8), closing the same gap migration 027 closed for account
-- signup — except this one is bigger in practice: a registration form is
-- public, unauthenticated, and is very often filled in by a parent or coach
-- on behalf of a minor archer (U15/U18/U21 categories are the majority of
-- competitive entries — docs/DOMAIN.md's "Age class"). Before this
-- migration the `registrations` table collected a real child's name and
-- date of birth with NONE of the protections migration 027 gave accounts:
-- no DOB validation at all (a raw, unchecked free-text string), no minor
-- detection, no parental consent, no restriction on how staff could view
-- or act on the data.
--
-- India's DPDP Act 2023 s.9(3): processing a child's personal data in a
-- manner likely to cause detrimental effect, or for behavioural
-- monitoring/tracking or targeted advertising directed at children, is an
-- ABSOLUTE PROHIBITION — parental consent does not unlock it. Consent here
-- only unlocks the registration moving into the normal staff review queue;
-- it never unlocks profiling or marketing, for any age (reco.js already
-- enforces that separately and unconditionally).

alter table registrations add column if not exists is_minor boolean;
-- The parent/guardian's email — required only when the archer's date of
-- birth indicates they're under 18 as of submission. Never required for an
-- adult registrant.
alter table registrations add column if not exists parent_email text;
alter table registrations add column if not exists parent_consent_status text not null default 'not_required'
  check (parent_consent_status in ('not_required','pending','granted','denied'));
-- Single-use, unguessable token mailed to the PARENT, never the child/
-- submitter — same shape as users.parent_consent_token (migration 027).
alter table registrations add column if not exists parent_consent_token text;
alter table registrations add column if not exists parent_consent_sent_at timestamptz;
alter table registrations add column if not exists parent_consent_responded_at timestamptz;
create unique index if not exists registrations_parent_consent_token_idx
  on registrations(parent_consent_token) where parent_consent_token is not null;

-- Existing registrations (submitted before this migration) have is_minor
-- IS NULL — their `dob` was never validated, so computing an age from it
-- would be computing an age from data we don't actually trust. They are
-- not retroactively re-classified or backfilled (same honesty rule
-- migration 027 applied to pre-existing accounts). Every NEW registration
-- requires a real, validated date of birth going forward (enforced in
-- api/_lib/inbox.js), and a minor one cannot leave 'pending_consent' status
-- until a parent/guardian responds.
