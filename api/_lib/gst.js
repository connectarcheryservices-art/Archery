// api/_lib/gst.js — Indian GST domain primitives shared by pricing.js (rate/
// state math, pure) and order fulfilment (invoice numbering, DB-backed).
//
// Scope note (see migration 036 header for the full citation trail): this
// module gives the platform real HSN/CGST/SGST/IGST/invoice-numbering
// mechanics. It does NOT implement TCS collection under CGST Act s.52 (needs
// a seller payout/settlement ledger this codebase doesn't have) or
// e-invoicing/IRN generation (needs a government IRP integration). Both are
// tracked in docs/PLAN.md as real, deliberate gaps — not silently skipped.
'use strict';
const { q } = require('./db');

// GST state codes = the first two digits of any GSTIN. Source: CBIC-issued
// codes, cross-referenced via indiafilings.com/learn/gst-state-codes
// (fetched 2026-08-13). Code 25 (formerly Daman & Diu) was retired when
// Dadra & Nagar Haveli merged with Daman & Diu into the single UT "26" in
// 2020, and is intentionally absent here.
const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Before Division)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

// State/UT names for a checkout <select> — one canonical spelling per real,
// currently-live GST jurisdiction. "28 Andhra Pradesh (Before Division)" is
// the pre-2014 code, retired in favour of "37 Andhra Pradesh"; excluded so
// there's exactly one selectable "Andhra Pradesh".
const GST_STATES = Object.entries(GST_STATE_CODES)
  .filter(([code]) => code !== '28')
  .map(([, name]) => name)
  .sort((a, b) => a.localeCompare(b));

// Adversarial-review fix (2026-08-13): a bare trim/lowercase let two real
// spellings of the same state compare unequal — e.g. an admin typing
// "Jammu & Kashmir" into a free-text config field vs. checkout's canonical
// "Jammu and Kashmir" — which silently miscomputes a genuinely intra-state
// sale as inter-state IGST (wrong government account, a real compliance
// bug, not cosmetic). Normalising '&' -> 'and' closes that specific gap;
// canonicalState()/isKnownState() below are the stronger fix (snap to one
// canonical spelling at the point of input) and are now enforced wherever
// a state is captured — this is defence in depth for anywhere that isn't.
function normState(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownState(s) { return GST_STATES.some(n => normState(n) === normState(s)); }

function canonicalState(s) {
  const n = normState(s);
  return GST_STATES.find(name => normState(name) === n) || null;
}

// Standard published GSTIN shape: 2-digit state code + 10-char PAN (5
// letters, 4 digits, 1 letter) + 1 alphanumeric entity code (1-9 then A-Z)
// + literal 'Z' + 1 alphanumeric checksum. 15 characters total.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function isValidGstin(gstin) {
  return typeof gstin === 'string' && GSTIN_RE.test(gstin.toUpperCase().trim());
}

function stateFromGstin(gstin) {
  if (!isValidGstin(gstin)) return null;
  return GST_STATE_CODES[String(gstin).trim().toUpperCase().slice(0, 2)] || null;
}

// Indian financial year: 1 April – 31 March IST, conventionally written
// "2026-27". Anchored explicitly to IST (UTC+5:30) rather than the server
// process's local clock — adversarial review, 2026-08-13: Vercel Node
// functions default to UTC with no TZ override anywhere in this repo, so a
// naive `d.getFullYear()/getMonth()` read the WRONG financial year for the
// ~5.5-hour window after midnight IST on 1 April (still "31 March" by the
// UTC clock), minting invoices under the previous year's counter instead of
// resetting to a fresh sequence as Rule 46(b) requires. Fixed by shifting
// into IST before reading the calendar fields, regardless of server TZ.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function financialYear(d = new Date()) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth() + 1; // getUTCMonth() is 0-based
  const startY = m >= 4 ? y : y - 1;
  return `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`;
}

// Atomically mints the next sequential tax-invoice number for the current
// financial year. CGST Rule 46(b): consecutive serial number, unique per
// financial year, max 16 characters, alphanumerics plus '-'/'/' allowed.
// Format "AS/26-27/000123" is 15 characters at a 6-digit sequence.
//
// `exec` defaults to the module-level autocommit `q`, but MUST be passed as
// a transaction-bound `client.query.bind(client)` by any caller that also
// writes the resulting number onto a row in the same operation (e.g.
// api/_lib/payments.js minting onto `orders.invoice_no`) — adversarial
// review, 2026-08-13: minting-then-a-separate-autocommit-UPDATE is two
// independent round trips, so a failure between them permanently burns a
// sequence number with no order ever carrying it, breaking Rule 46(b)'s
// consecutive-numbering guarantee. Run both statements inside the SAME
// db.js withTransaction() so they commit or roll back together, the same
// fix already applied to api/_handlers/selection.js for this exact bug
// shape (see db.js's own comment on withTransaction).
async function mintInvoiceNo(when = new Date(), exec = q) {
  const fy = financialYear(when);
  await exec(
    `insert into invoice_counters (financial_year, next_seq) values ($1, 1)
     on conflict (financial_year) do nothing`,
    [fy]
  );
  const r = await exec(
    `update invoice_counters set next_seq = next_seq + 1
     where financial_year = $1 returning next_seq - 1 as seq`,
    [fy]
  );
  const seq = r.rows[0].seq;
  const shortFy = fy.split('-').map((p, i) => (i === 0 ? p.slice(2) : p)).join('-');
  return `AS/${shortFy}/${String(seq).padStart(6, '0')}`;
}

module.exports = {
  GST_STATE_CODES, GST_STATES, normState, isKnownState, canonicalState,
  GSTIN_RE, isValidGstin, stateFromGstin, financialYear, mintInvoiceNo,
};
