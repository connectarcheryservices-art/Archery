-- Archery.Services — migration 017
-- orders.currency's column default was still 'INR' (schema.sql), a full
-- currency conversion after the 2026-07-16 INR->CHF change. In practice this
-- was never actually served to a customer — api/_handlers/checkout-create.js
-- always passes quote.currency explicitly on insert, so every real order's
-- currency column is correct — but a schema default that contradicts the
-- platform's real, current pricing is exactly the kind of stale artifact
-- that turned into a live bug twice already today (checkout.html's client
-- fallback, api/_lib/seed.js's SETTINGS). Fixing the default so it can never
-- become a fourth instance if some future insert path omits the column.
--
-- Idempotent, forward-only (ADR-0002).

alter table orders alter column currency set default 'CHF';
