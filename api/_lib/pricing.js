// api/_lib/pricing.js
// Comprehensive checkout pricing for Archery.Services (INR) — real GST
// (CGST/SGST/IGST), not a flat generic tax. Single source of truth for the
// order total so the client display and the Razorpay charge can never
// disagree. All rates are admin-configurable (loaded from the `settings`
// row) and fall back to these defaults.
'use strict';
const { normState, isValidGstin, stateFromGstin } = require('./gst');

// Currency changed INR -> CHF on 2026-07-16, then back to INR on 2026-08-12
// at the owner's explicit instruction (real GST compliance is inherently
// INR-denominated — CGST/SGST/IGST returns are always filed in rupees
// regardless of storefront currency). See migration 035/036 and pricing.test.js.
//
// GST 2.0 rate rationalisation (Notification 9/2025-Integrated Tax (Rate),
// 17-Sep-2025, effective 22-Sep-2025, 56th GST Council meeting): sporting
// goods under HSN 9506 (bows, arrows, targets — this business's inventory)
// moved from 12% to 5%. `taxRate` below is that rate, used as the fallback
// GST rate for any product that doesn't carry its own `gst_rate` (migration
// 036 gives every product row a real per-item rate; this is only a safety
// net for rows created before that migration or a config override).
const DEFAULTS = {
  currency: 'INR',
  taxRate: 0.05,               // default/fallback GST rate (HSN 9506, GST 2.0)
  platformFeeRate: 0.05,       // 5% platform commission, applied to the goods subtotal
  deliveryStandard: 49,        // standard PAN-India delivery (INR)
  deliverySameDay: 149,        // super-fast same-day PAN-India delivery (INR)
  freeDeliveryThreshold: 999,  // standard delivery is free at/above this goods value
};

// The platform's own commission/convenience fee is a separate SUPPLY OF
// SERVICE by the platform to the buyer — not a discount on, or a pass-
// through of, the goods sale — so Section 8's composite-supply principle
// (same rate as the principal supply) does not apply to it the way it does
// to bundled delivery. Modelled under SAC 9985 ("support services") at the
// standard/default GST rate for services, 18%.
//
// FLAGGED, NOT CITED AS SETTLED: unlike the HSN 9506 rate above, whether
// this platform fee is legally a distinct taxable supply to the buyer (vs.
// e.g. a commission netted against seller payouts, which would have
// different — and possibly no — GST-to-the-buyer treatment) depends on
// facts about how the fee is actually contracted that aren't decidable from
// code. This is the conservative, defensible default; it needs a real CA's
// sign-off before this handles GST returns at scale (see migration 036).
const PLATFORM_FEE_SAC = '9985';
const PLATFORM_FEE_GST_RATE = 0.18;

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function normaliseItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(it => ({
    id:          it.id != null ? Number(it.id) : null,
    name:        String(it.name || '').slice(0, 200),
    price:       Math.max(0, Number(it.price) || 0),
    qty:         Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1)),
    hsnCode:     it.hsnCode ? String(it.hsnCode).slice(0, 20) : '9506',
    gstRate:     (it.gstRate != null && Number.isFinite(Number(it.gstRate))) ? Number(it.gstRate) : null,
    sellerState: it.sellerState ? String(it.sellerState) : null,
  })).filter(it => it.name);
}

/**
 * Split a taxable value into CGST+SGST (intra-state) or IGST (inter-state),
 * per IGST Act s.7/s.8: intra-state supply attracts CGST+SGST in equal
 * halves of the rate; inter-state attracts IGST at the full rate. "Place of
 * supply" for a straight goods sale is the delivery-address state.
 *
 * When either state is unknown (e.g. a pre-address preview quote) this
 * assumes intra-state as the best available estimate. That assumption only
 * ever affects which LINES are shown (CGST+SGST vs IGST) — `tax` itself is
 * `taxableValue * rate` regardless of the split, so the total a customer
 * previews is never wrong, only its intra/inter labelling before we know
 * their address. The authoritative split is always recomputed at
 * checkout/create with the real delivery-address state (CLAUDE.md §1.6).
 */
function splitGst(taxableValue, rate, supplierState, buyerState) {
  const tax = round2(taxableValue * rate);
  const stateKnown = !!(supplierState && buyerState);
  const intra = stateKnown ? normState(supplierState) === normState(buyerState) : true;
  if (intra) {
    const cgst = round2(tax / 2);
    return { tax, cgst, sgst: round2(tax - cgst), igst: 0, intra: true, stateKnown };
  }
  return { tax, cgst: 0, sgst: 0, igst: tax, intra: false, stateKnown };
}

/**
 * Compute a full, itemised price breakdown.
 * @param items  [{id,name,price,qty,hsnCode,gstRate,sellerState}]
 * @param opts   { delivery:'standard'|'sameday', config:{...overrides},
 *                 buyerState, platformState }
 */
function computeQuote(items, opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts.config || {}) };
  const delivery = opts.delivery === 'sameday' ? 'sameday' : 'standard';
  const list = normaliseItems(items);

  const goods = round2(list.reduce((s, i) => s + i.price * i.qty, 0));

  let deliveryFee;
  if (goods === 0)                 deliveryFee = 0;                       // empty cart
  else if (delivery === 'sameday') deliveryFee = Number(cfg.deliverySameDay) || 0;
  else                              deliveryFee = goods >= cfg.freeDeliveryThreshold ? 0 : (Number(cfg.deliveryStandard) || 0);
  deliveryFee = round2(deliveryFee);

  const buyerState = opts.buyerState || null;
  const platformState = cfg.platformRegisteredState || opts.platformState || null;

  let cgst = 0, sgst = 0, igst = 0;
  const breakdownMap = new Map(); // "hsn|rate|intra" -> aggregated HSN summary line (for the invoice)

  function addBreakdown(hsnCode, rate, taxableValue, r, label) {
    const key = `${hsnCode}|${rate}|${r.intra}`;
    const cur = breakdownMap.get(key) || { hsnCode, rate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, intra: r.intra, label: label || null };
    cur.taxableValue = round2(cur.taxableValue + taxableValue);
    cur.cgst = round2(cur.cgst + r.cgst);
    cur.sgst = round2(cur.sgst + r.sgst);
    cur.igst = round2(cur.igst + r.igst);
    breakdownMap.set(key, cur);
  }

  // Cumulative-rounding allocation of the delivery fee across cart lines:
  // each line gets (running ideal cumulative share) minus (what's already
  // been allocated), rather than each line independently rounding its own
  // share. Adversarial review, 2026-08-13: independent per-line rounding
  // could leave the SUM of allocated delivery a paisa or more short of the
  // actual deliveryFee (e.g. three ₹333.33 lines splitting a ₹49 fee) — the
  // customer's charged total was never wrong (it uses deliveryFee directly),
  // but that stray paisa was invisible to, and untaxed in, the itemised
  // gst_breakdown that becomes the invoice's own line items, so the invoice
  // didn't reconcile to the composite supply actually sold. Cumulative
  // rounding telescopes to exactly deliveryFee by construction: the last
  // line's ideal cumulative share is round2(deliveryFee * goods/goods) ==
  // deliveryFee itself, and every line's alloc is (that line's ideal
  // cumulative) minus (previous ideal cumulative), which sums to the same
  // telescoping total regardless of how unevenly the cart prices divide.
  let goodsSoFar = 0, deliveryAllocatedSoFar = 0;
  for (const it of list) {
    const lineGoods = round2(it.price * it.qty);
    goodsSoFar = round2(goodsSoFar + lineGoods);
    // Delivery is a composite supply with the goods on the SAME invoice
    // (Section 8 CGST Act: an ancillary supply naturally bundled with the
    // principal supply takes the principal supply's rate). Allocate it
    // proportionally across lines rather than inventing a separate service
    // rate for it.
    const idealCumulativeAlloc = goods > 0 ? round2(deliveryFee * (goodsSoFar / goods)) : 0;
    const alloc = round2(idealCumulativeAlloc - deliveryAllocatedSoFar);
    deliveryAllocatedSoFar = idealCumulativeAlloc;
    const taxableValue = round2(lineGoods + alloc);
    const rate = it.gstRate != null ? it.gstRate : cfg.taxRate;
    const supplierState = it.sellerState || platformState;
    const r = splitGst(taxableValue, rate, supplierState, buyerState);
    cgst = round2(cgst + r.cgst); sgst = round2(sgst + r.sgst); igst = round2(igst + r.igst);
    addBreakdown(it.hsnCode, rate, taxableValue, r);
  }

  // Platform fee: always supplied BY the platform itself, so its own
  // registered state (never a third-party seller's) determines the split.
  const platformFee = round2(goods * cfg.platformFeeRate);
  if (platformFee > 0) {
    const r = splitGst(platformFee, PLATFORM_FEE_GST_RATE, platformState, buyerState);
    cgst = round2(cgst + r.cgst); sgst = round2(sgst + r.sgst); igst = round2(igst + r.igst);
    addBreakdown(PLATFORM_FEE_SAC, PLATFORM_FEE_GST_RATE, platformFee, r, 'Platform service fee');
  }

  const tax = round2(cgst + sgst + igst);
  const total = round2(goods + deliveryFee + tax + platformFee);

  const lines = [
    { key: 'goods',    label: 'Items subtotal', amount: goods },
    { key: 'delivery', label: delivery === 'sameday'
                                 ? 'Same-day delivery (PAN India)'
                                 : (deliveryFee === 0 ? 'Delivery (free)' : 'Standard delivery (PAN India)'),
                        amount: deliveryFee },
  ];
  // Real Indian tax-invoice convention: CGST and SGST always shown as two
  // separate lines (never combined) for an intra-state sale; IGST as one
  // line for inter-state. A mixed-seller cart can legitimately show both.
  if (cgst > 0) lines.push({ key: 'cgst', label: 'CGST', amount: cgst });
  if (sgst > 0) lines.push({ key: 'sgst', label: 'SGST', amount: sgst });
  if (igst > 0) lines.push({ key: 'igst', label: 'IGST', amount: igst });
  lines.push({ key: 'platformFee', label: `Platform fee (${Math.round(cfg.platformFeeRate * 100)}% + GST)`, amount: platformFee });

  return {
    currency: cfg.currency,
    delivery, items: list, lines,
    goods, deliveryFee, tax, cgst, sgst, igst, platformFee, total,
    totalPaise: Math.round(total * 100), // Razorpay charges in paise
    placeOfSupplyState: buyerState,
    gstBreakdown: [...breakdownMap.values()],
    config: {
      taxRate: cfg.taxRate, platformFeeRate: cfg.platformFeeRate,
      deliveryStandard: cfg.deliveryStandard, deliverySameDay: cfg.deliverySameDay,
      freeDeliveryThreshold: cfg.freeDeliveryThreshold,
    },
  };
}

module.exports = {
  computeQuote, DEFAULTS, round2, normaliseItems, splitGst,
  PLATFORM_FEE_SAC, PLATFORM_FEE_GST_RATE,
  isValidGstin, stateFromGstin,
};
