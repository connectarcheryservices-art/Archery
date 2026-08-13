-- 036_gst_compliance.sql
-- Real GST (Goods & Services Tax) compliance for the shop, replacing the old
-- flat, undifferentiated "Tax (10%)" line with actual Indian tax law.
--
-- CITATIONS (verified 2026-08-13, see commit message for search trail):
--   * HSN 9506 (sporting goods, Chapter 95) GST rate: 5%, effective
--     2025-09-22 under the GST 2.0 rate rationalisation (Notification
--     9/2025-Integrated Tax (Rate), 56th GST Council meeting). Was 12%
--     before that date. General physical-exercise/gym equipment stayed at
--     18% — not this business's inventory (bows, arrows, targets, apparel).
--   * CGST/SGST vs IGST split: Section 7/8 IGST Act — intra-state supply
--     (supplier and place-of-supply in the same state) attracts CGST+SGST
--     in equal halves of the rate; inter-state attracts IGST at the full
--     rate. Place of supply for a straight e-commerce goods sale is the
--     delivery address state (IGST Act s.10(1)(a)).
--   * GSTIN structure: first 2 digits are the GST state code (01-38,
--     cross-referenced via indiafilings.com/learn/gst-state-codes). Used
--     to derive a seller's registered state from their GSTIN without a
--     separate "state" field.
--   * Tax invoice numbering: CGST Rule 46(b) — consecutive, unique per
--     financial year, max 16 characters, may contain alphanumerics and
--     '-'/'/'. Financial year resets 1 April.
--   * TCS u/s 52 CGST Act (e-commerce operator withholding) and e-invoicing
--     (IRP/IRN integration) are DELIBERATELY NOT built here — TCS requires
--     a seller payout/settlement ledger this codebase doesn't have yet
--     (only users.payout_upi exists, no ledger), and e-invoicing requires
--     integrating a government IRP, a real external-authority integration
--     of the same kind this project has repeatedly declined to fake
--     (see para classification / anti-doping / safeguarding: the platform
--     records real outcomes, it does not simulate an authority it doesn't
--     have). Both are real gaps, tracked in docs/PLAN.md, not silent ones.
--
-- This is the mechanism, not a substitute for a CA's review before this
-- handles real money at scale — see the header comment in api/_lib/gst.js
-- for the specific assumptions a reviewer needs to check.

-- ─── Per-product HSN + GST rate ─────────────────────────────────────────
-- Admin/seller overridable per product: HSN and rate genuinely vary by
-- product line (e.g. apparel has its own price-threshold rule), so this
-- must not be a single global constant.
alter table products add column if not exists hsn_code text not null default '9506';
alter table products add column if not exists gst_rate numeric(5,4) not null default 0.05;

comment on column users.gst_number is
  'Seller-declared GSTIN. Format ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$ '
  '(2-digit GST state code + PAN + entity code + literal Z + checksum). '
  'Validated at apply-seller (api/_handlers/users-action.js); legacy rows '
  'predating validation are left as-is, not enforced retroactively.';

-- ─── Order-level GST split + compliance fields ──────────────────────────
alter table orders add column if not exists cgst numeric(10,2) not null default 0;
alter table orders add column if not exists sgst numeric(10,2) not null default 0;
alter table orders add column if not exists igst numeric(10,2) not null default 0;
alter table orders add column if not exists place_of_supply_state text;
alter table orders add column if not exists buyer_gstin text;
alter table orders add column if not exists invoice_no text unique;
alter table orders add column if not exists invoice_issued_at timestamptz;
alter table orders add column if not exists gst_breakdown jsonb not null default '[]';

-- ─── Sequential-per-financial-year invoice numbering (CGST Rule 46(b)) ──
-- One counter row per financial year ("2026-27"). Minted atomically via
-- `update ... set next_seq = next_seq + 1 ... returning next_seq - 1` so
-- concurrent orders never collide or skip — see api/_lib/gst.js.
create table if not exists invoice_counters (
  financial_year text primary key,
  next_seq       int not null default 1
);

-- ─── Platform's own GST registration (seller-of-record for house inventory,
--     and always the supplier of record for the platform service fee) ────
-- Left blank by default — a placeholder-looking GSTIN would be exactly the
-- fabricated-data problem CLAUDE.md §1.1 exists to prevent. The invoice
-- generator renders "GSTIN not yet configured" honestly until the real
-- owner enters their real registration in admin.html.
update settings
   set data = data || jsonb_build_object(
     'platformGstin',           coalesce(data->>'platformGstin', ''),
     'platformLegalName',       coalesce(data->>'platformLegalName', ''),
     'platformRegisteredState', coalesce(data->>'platformRegisteredState', ''),
     'platformAddress',         coalesce(data->>'platformAddress', '')
   )
 where id = 1;

-- The old flat 10% "Tax" rate never corresponded to any real GST rate for
-- this inventory — replace the default with the real HSN 9506 rate so a
-- settings row that has never been touched still computes correctly.
update settings
   set data = jsonb_set(data, '{taxRate}', '0.05', true)
 where id = 1 and (data->>'taxRate')::numeric = 0.10;
