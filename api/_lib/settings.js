// Reads the single settings row and maps it to the pricing config the engine wants.
// settings.data uses camelCase keys (matches the front-end + admin panel).
'use strict';
const { q } = require('./db');
const { DEFAULTS } = require('./pricing');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function getSettings() {
  try {
    const r = await q('select data from settings where id=1');
    return (r.rows[0] && r.rows[0].data) || {};
  } catch (e) { return {}; }
}

async function loadPricingConfig() {
  const d = await getSettings();
  return {
    currency:              d.currency || DEFAULTS.currency,
    taxRate:               num(d.taxRate ?? d.tax_rate, DEFAULTS.taxRate),
    platformFeeRate:       num(d.platformFeeRate ?? d.platform_fee_rate, DEFAULTS.platformFeeRate),
    deliveryStandard:      num(d.deliveryStandard ?? d.delivery_standard, DEFAULTS.deliveryStandard),
    deliverySameDay:       num(d.deliverySameDay ?? d.delivery_same_day, DEFAULTS.deliverySameDay),
    freeDeliveryThreshold: num(d.freeDeliveryThreshold ?? d.free_delivery_threshold, DEFAULTS.freeDeliveryThreshold),
    sameDayEnabled:        (d.sameDayEnabled ?? d.same_day_enabled) !== false,
    // The platform's own GST registration — supplier of record for house
    // inventory (products with no seller_id) and always the supplier for
    // the platform service fee (api/_lib/pricing.js). Left blank until the
    // real owner enters their real registration in admin.html; a
    // placeholder-looking value here would be exactly the fabricated-data
    // problem CLAUDE.md §1.1 exists to prevent.
    platformGstin:           d.platformGstin || '',
    platformLegalName:       d.platformLegalName || '',
    platformRegisteredState: d.platformRegisteredState || '',
    platformAddress:         d.platformAddress || '',
  };
}

module.exports = { getSettings, loadPricingConfig };
