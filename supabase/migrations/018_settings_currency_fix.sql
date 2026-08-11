-- Archery.Services — migration 018
-- Migration 011 converted stored PRODUCT prices from INR to CHF, but never
-- touched the `settings` row. That row still carries the pre-conversion
-- currency label and INR-scale delivery thresholds ('INR', deliveryStandard
-- 49, deliverySameDay 149, freeDeliveryThreshold 999).
--
-- api/_lib/settings.js -> loadPricingConfig() feeds this row straight into
-- api/_handlers/checkout-create.js, which sends `quote.currency` to Razorpay
-- as the literal charge currency. Since product prices are already
-- CHF-denominated (migration 011), an unpatched settings row means
-- checkout has been instructing Razorpay to charge CHF-sized amounts labelled
-- as INR — a currency mismatch between what is shown and what is charged
-- (§1.6) — and using INR-scale delivery thresholds against CHF-scale totals,
-- so standard delivery almost never qualifies as free and costs ~10x the
-- intended CHF 5.
--
-- Only rows still marked 'INR' are touched, so an admin who has already
-- reconfigured currency/delivery since the 2026-07-16 change is left alone.
update settings
   set data = data || jsonb_build_object(
     'currency', 'CHF',
     'deliveryStandard', 5,
     'deliverySameDay', 15,
     'freeDeliveryThreshold', 99
   )
 where id = 1 and data->>'currency' = 'INR';
