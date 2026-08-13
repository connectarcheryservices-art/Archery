-- Archery.Services — migration 035
-- Currency conversion CHF -> INR for the SHOP (products, settings, orders
-- default). Reverses migration 011/017/018's INR -> CHF conversion, at the
-- owner's explicit instruction (2026-08-12): real GST compliance is
-- inherently INR-denominated regardless of storefront currency, and this
-- business ships within India with rupee delivery per api/_lib/fees.js's
-- own long-standing comment — the CHF detour was internally inconsistent
-- with that. Federation/membership pricing (api/_lib/fees.js,
-- api/_lib/memberships.js, pricing.html, federation.html) is NOT touched
-- here — that is a separate pricing surface the owner was not asked about
-- and was not part of this decision.
--
-- Unlike migration 011's per-row price-magnitude heuristic (unreliable in
-- reverse: an expensive CHF item and a cheap INR item can land in the same
-- numeric range), this uses the settings row's own currency flag as the
-- single source of truth for whether a conversion is needed — the whole
-- shop moved to CHF together (commit 5c79d96, "the whole site is CHF"), so
-- it moves back together, gated on one flag rather than guessed per row.
-- Idempotent: once settings.currency is 'INR', this is a no-op on rerun.
--
-- Historical orders are again deliberately NOT touched — an order records
-- what was actually charged, in the currency it was charged in. Rewriting
-- past orders would falsify the financial record (same principle as 011).
--
-- Rate: 1 CHF = 95 INR (the same rate 011 used to go the other way), so
-- round-tripping a price that was never edited in between returns to
-- within rounding of its original INR value.

do $$
begin
  if exists (select 1 from settings where id = 1 and data->>'currency' = 'CHF') then
    update products
       set price = greatest(1, round(price * 95.0)),
           was   = case when was is not null then greatest(1, round(was * 95.0)) else null end;

    update settings
       set data = data || jsonb_build_object(
         'currency', 'INR',
         'deliveryStandard', 49,
         'deliverySameDay', 149,
         'freeDeliveryThreshold', 999
       )
     where id = 1;
  end if;
end $$;

alter table orders alter column currency set default 'INR';
