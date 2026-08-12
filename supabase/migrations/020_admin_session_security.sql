-- Archery.Services — migration 020
-- Owner/staff session tokens had the exact same "no secret signs two things"
-- and "no expiry/revocation" issues already fixed for customer tokens in
-- migration 019 (see api/_lib/userauth.js). This is the matching fix for
-- api/_lib/auth.js: owner and staff tokens are now signed with a dedicated
-- SESSION_SECRET (never ADMIN_PASSWORD), carry a 12-hour expiry, and role is
-- re-read from the database on every request rather than trusted from the
-- token payload (CLAUDE.md §1.3, both sentences: "every session is
-- revocable" and "roles are read from the database on every request, never
-- from the token payload").
--
-- These columns are the revocation watermark: any token issued before this
-- timestamp is rejected even though its signature still verifies. Bumped on
-- a staff password change; available for the owner via owner_security for
-- the same purpose (e.g. after a TOTP change).
alter table staff add column if not exists token_valid_after bigint default 0;
alter table owner_security add column if not exists token_valid_after bigint default 0;
