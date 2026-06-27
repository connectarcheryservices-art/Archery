// api/_lib/pricing.js
// Comprehensive checkout pricing for Archery.Services (INR).
// Single source of truth for the order total so the client display and the
// Razorpay charge can never disagree. All rates are admin-configurable
// (loaded from the `settings` row) and fall back to these defaults.
'use strict';

const DEFAULTS = {
  currency: 'INR',
  taxRate: 0.10,             // 10% tax, applied to the goods subtotal
  platformFeeRate: 0.05,     // 5% platform fee, applied to the goods subtotal
  deliveryStandard: 49,      // standard PAN-India delivery (INR)
  deliverySameDay: 149,      // super-fast same-day PAN-India delivery (INR)
  freeDeliveryThreshold: 999,// standard delivery is free at/above this goods value
};

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function normaliseItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(it => ({
    id:    it.id != null ? Number(it.id) : null,
    name:  String(it.name || '').slice(0, 200),
    price: Math.max(0, Number(it.price) || 0),
    qty:   Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1)),
  })).filter(it => it.name);
}

/**
 * Compute a full, itemised price breakdown.
 * @param items  [{id,name,price,qty}]
 * @param opts   { delivery:'standard'|'sameday', config:{...overrides} }
 */
function computeQuote(items, opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts.config || {}) };
  const delivery = opts.delivery === 'sameday' ? 'sameday' : 'standard';
  const list = normaliseItems(items);

  const goods = round2(list.reduce((s, i) => s + i.price * i.qty, 0));

  let deliveryFee;
  if (goods === 0)                deliveryFee = 0;                       // empty cart
  else if (delivery === 'sameday') deliveryFee = Number(cfg.deliverySameDay) || 0;
  else                            deliveryFee = goods >= cfg.freeDeliveryThreshold ? 0 : (Number(cfg.deliveryStandard) || 0);
  deliveryFee = round2(deliveryFee);

  const tax         = round2(goods * cfg.taxRate);
  const platformFee = round2(goods * cfg.platformFeeRate);
  const total       = round2(goods + deliveryFee + tax + platformFee);

  return {
    currency: cfg.currency,
    delivery,
    items: list,
    lines: [
      { key: 'goods',       label: 'Items subtotal', amount: goods },
      { key: 'delivery',    label: delivery === 'sameday'
                                     ? 'Same-day delivery (PAN India)'
                                     : (deliveryFee === 0 ? 'Delivery (free)' : 'Standard delivery (PAN India)'),
                            amount: deliveryFee },
      { key: 'tax',         label: `Tax (${Math.round(cfg.taxRate * 100)}%)`,            amount: tax },
      { key: 'platformFee', label: `Platform fee (${Math.round(cfg.platformFeeRate * 100)}%)`, amount: platformFee },
    ],
    goods, deliveryFee, tax, platformFee, total,
    totalPaise: Math.round(total * 100), // Razorpay charges in paise
    config: {
      taxRate: cfg.taxRate, platformFeeRate: cfg.platformFeeRate,
      deliveryStandard: cfg.deliveryStandard, deliverySameDay: cfg.deliverySameDay,
      freeDeliveryThreshold: cfg.freeDeliveryThreshold,
    },
  };
}

module.exports = { computeQuote, DEFAULTS, round2, normaliseItems };
