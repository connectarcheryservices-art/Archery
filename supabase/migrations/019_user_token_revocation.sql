-- Archery.Services — migration 019
-- Customer session tokens are stateless HMAC tokens with no server-side
-- revocation mechanism (CLAUDE.md §1.3: "every session is revocable"). This
-- column lets us actually revoke: any token whose `iat` (issued-at) predates
-- this timestamp is rejected, even though its signature still verifies.
-- Bumped on password reset and on an explicit "log out everywhere" so a
-- stolen or leaked token stops working the moment the real owner acts.
alter table users add column if not exists token_valid_after bigint default 0;
