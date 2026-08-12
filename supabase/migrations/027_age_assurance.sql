-- Archery.Services — migration 027
-- Age assurance + verifiable parental consent (CLAUDE.md §1.8, a
-- constitutional NON-NEGOTIABLE — not a "when we get to it" item).
-- India's DPDP Act 2023 s.9(3): processing a child's personal data in a
-- manner likely to cause detrimental effect, or for behavioural
-- monitoring/tracking or targeted advertising directed at children, is an
-- ABSOLUTE PROHIBITION — parental consent does not unlock it. Consent only
-- unlocks the BASIC ability to use the platform (entries, coach links,
-- a public profile); it never unlocks profiling or marketing, for any age.
--
-- docs/THREAT_MODEL.md T9 ("Minors unprotected", CRITICAL) documented this
-- exact gap: no DOB collected anywhere account-linked, reco.js profiles
-- every visitor unconditionally, no parental-consent mechanism exists.
-- This migration is that gap closing, not a redesign of anything working.

alter table users add column if not exists date_of_birth date;
-- The parent/guardian's email — required only when date_of_birth indicates
-- the account holder is under 18 at registration time. Never required for
-- an adult account.
alter table users add column if not exists parent_email text;
alter table users add column if not exists parent_consent_status text not null default 'not_required'
  check (parent_consent_status in ('not_required','pending','granted','denied'));
-- Single-use, unguessable token mailed to the PARENT, never the child.
alter table users add column if not exists parent_consent_token text;
alter table users add column if not exists parent_consent_sent_at timestamptz;
alter table users add column if not exists parent_consent_responded_at timestamptz;
create unique index if not exists users_parent_consent_token_idx on users(parent_consent_token) where parent_consent_token is not null;

-- Existing accounts (registered before this migration) have date_of_birth
-- IS NULL — we do not know their age and do not fabricate one. They are
-- treated as NEITHER a confirmed adult NOR a confirmed minor by any code
-- that reads date_of_birth; retroactively verifying every existing
-- account's age is real follow-on work, not something this migration can
-- honestly claim to solve. Every NEW registration requires a real date of
-- birth going forward (enforced in api/_handlers/users-action.js).

-- A minor's coach-athlete link may additionally need guardian awareness —
-- not gating the link itself (the athlete's own consent to be coached is
-- still required and sufficient for the relationship to exist), but
-- recording that a guardian was informed, for the same auditable-decision
-- reasons every other consent flow in this codebase is recorded.
alter table coach_athletes add column if not exists guardian_notified_at timestamptz;
