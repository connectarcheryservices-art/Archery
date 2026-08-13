-- Archery.Services — migration 041
-- Corrects a currency LABEL/settings mismatch, confirmed against the live
-- production API on 2026-08-13: `products.price` is correctly CHF-scale
-- (e.g. "Pro Recurve Bow" = 305, a realistic CHF price — matches migration
-- 011's original INR->CHF conversion, which was never actually wrong), but
-- `settings.currency` reads 'INR' — so the storefront hardcodes a ₹ symbol
-- next to a real CHF number. Confirmed directly with the owner (2026-08-13
-- conversation) that CHF is the intended, correct shop currency right now;
-- an earlier migration (035, "at the owner's explicit instruction") reverted
-- the currency LABEL to 'INR' on the premise that GST compliance requires
-- INR-denominated storefront pricing — that premise has been overridden by
-- the owner directly. Do NOT re-run or trust migration 035's direction
-- without asking again; see docs/PLAN.md for the fuller currency history.
--
-- This migration does NOT touch `products.price`/`was` at all — those are
-- already correct and must not be multiplied or divided again.
--
-- Also restores the CHF-scale delivery thresholds migration 018 originally
-- set (5/15/99), which migration 035 had overwritten with INR-scale values
-- (49/149/999) — those need to move back in lockstep with the currency
-- label, or "free delivery over 999" on CHF-scale totals would almost never
-- trigger.
--
-- Idempotent: only touches rows still marked 'INR'.

update settings
   set data = data || jsonb_build_object(
     'currency', 'CHF',
     'deliveryStandard', 5,
     'deliverySameDay', 15,
     'freeDeliveryThreshold', 99
   )
 where id = 1 and data->>'currency' = 'INR';

alter table orders alter column currency set default 'CHF';
