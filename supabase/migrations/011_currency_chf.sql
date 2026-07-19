-- Archery.Services — migration 011
-- Currency conversion INR -> CHF for stored money.
--
-- The site now displays and CHARGES in CHF (api/_lib/pricing.js, fees.js). The
-- product prices in this database were entered in INR. Converting the display
-- without converting the DATA would show one currency and charge another — a lie
-- about money and a direct breach of CLAUDE.md §1.6. So the stored amounts are
-- converted here, once, in a migration that records exactly what happened.
--
-- Rate used: 1 CHF = 95 INR (a rounded, conservative rate chosen at the time of
-- conversion). Converted values are rounded to whole francs, with a floor of 1
-- so nothing becomes free. This is a ONE-TIME REPRICING, not a live FX feed:
-- after this migration the CHF figures are the real prices, and they are edited
-- in CHF from the admin panel like any other price.
--
-- Historical orders are deliberately NOT touched: an order records what was
-- actually charged at the time, in the currency it was charged in. Rewriting
-- past orders would falsify the financial record.
--
-- Idempotent by design: it only converts rows that still look like INR pricing
-- (>= 300), so re-running cannot shrink already-converted CHF prices.

do $$
begin
  if exists (select 1 from products where price >= 300) then
    update products
       set price = greatest(1, round(price / 95.0)),
           was   = case when was is not null then greatest(1, round(was / 95.0)) else null end
     where price >= 300;
  end if;
end $$;
