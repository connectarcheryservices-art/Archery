-- Archery.Services — migration 040
-- Closes a live IDOR found during a T12 (THREAT_MODEL.md) audit, 2026-08-13:
-- `chats.id` is a bare sequential integer, and GET /api/chat/<id> had ZERO
-- authorization — any caller could enumerate 1..N and read every visitor's
-- name, email, and full message history (support conversations plausibly
-- carry order numbers, complaints, and — this is a youth-sport platform,
-- CLAUDE.md §1.8 / THREAT_MODEL.md A3 — minors' contact details). Worse,
-- POST /api/chat {id, text} let anyone append a message to ANY existing
-- thread with no proof of ownership: a stranger could inject fake messages
-- into someone else's live conversation with support.
--
-- Fix: the same "high-entropy token doubles as a bearer credential" pattern
-- already used elsewhere in this codebase (orders.order_no for the
-- invoice-link email, users/registrations.parent_consent_token) — a real
-- widget must now hold this token (minted once, at thread creation) to read
-- or append to ITS OWN thread. Staff retain full access regardless (via
-- checkAdmin, unaffected by this column). Existing rows get no token
-- (nobody currently holds one to present), which fails CLOSED, not open —
-- a pre-migration thread becomes admin-only-readable rather than staying
-- publicly enumerable.

alter table chats add column if not exists access_token text;
create unique index if not exists chats_access_token_idx on chats(access_token) where access_token is not null;
