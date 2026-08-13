// api/_handlers/order-invoice.js — GET /api/orders/<id>/invoice[?on=<order_no>]
//
// A compliant, printable GST tax invoice for one order.
//
// CGST Rule 46 (particulars of a tax invoice) is what shapes this page:
// (a) supplier name/address/GSTIN, (b) a consecutive serial number unique
// per financial year [Rule 46(b) — minted once by api/_lib/gst.js's
// mintInvoiceNo(), called idempotently from api/_lib/payments.js fulfil()],
// (c) date of issue, (e) recipient name/address (+ GSTIN when registered),
// (f)/(g) HSN code and description of goods, (h)-(m) quantity, taxable
// value, rate and amount of CGST/SGST/IGST, (p) place of supply for an
// inter-state supply. Migration 036's header has the full citation trail
// for the rate/split math feeding these numbers; this file only renders
// what's already been computed and stored on the order row.
//
// Access — there's no separate "invoice viewer" login, so either of:
//   (a) an authenticated admin session with the 'orders' capability, or
//   (b) an unauthenticated request whose ?on= exactly matches the order's
//       real order_no — this is what lets the link emailed to a guest buyer
//       (api/_lib/payments.js fulfil()) work with no account at all.
//       order_no is high-entropy (`ARC-<base36 ms>-<6 hex chars>`, minted in
//       api/_handlers/checkout-create.js) and is already trusted as a
//       bearer-style credential for exactly this purpose elsewhere in this
//       codebase — this handler doesn't invent a new trust model.
// Neither -> 403, and — for a non-admin caller — that 403 is returned
// whether or not the order id even exists, so an unauthenticated probe can't
// enumerate live order ids by watching for 404 vs 403.
'use strict';
const { cors, json } = require('../_lib/respond');
const { checkAdmin, can } = require('../_lib/auth');
const { q } = require('../_lib/db');
const { loadPricingConfig } = require('../_lib/settings');

// esc.js in this repo is a browser-side helper (assumes a live DOM) and
// can't run in this Node handler — CLAUDE.md §1.7: no untrusted string may
// reach raw HTML unescaped, so this file carries its own tiny sanitiser.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = r => {
  const n = Number(r || 0) * 100;
  return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + '%';
};

function renderInvoiceHtml(order, cfg) {
  const items = Array.isArray(order.items) ? order.items : [];
  const breakdown = Array.isArray(order.gst_breakdown) ? order.gst_breakdown : [];

  const issuedAt = order.invoice_issued_at
    ? new Date(order.invoice_issued_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })
    : '';

  // Supplier of record: for v1 this is ALWAYS the platform itself, even for
  // products whose seller_id is a third-party seller. Real per-seller
  // multi-invoice splitting for a mixed-seller cart (a separate invoice per
  // seller, each from that seller's own GSTIN) is a deliberate v1
  // simplification — not built here; see migration 036's header for the
  // same gap noted at the schema level.
  const supplierGstinLine = cfg.platformGstin
    ? `GSTIN: ${esc(cfg.platformGstin)}`
    // Never fabricate a GSTIN (CLAUDE.md §1.1) — an unconfigured platform
    // registration is shown honestly rather than invented.
    : 'GSTIN: Not yet registered';

  const buyerGstinLine = order.buyer_gstin ? `<div>GSTIN: ${esc(order.buyer_gstin)}</div>` : '';

  const addrLines = [order.address_line1, order.address_line2, [order.city, order.state, order.pincode].filter(Boolean).join(', ')]
    .filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('');

  const platformAddrLines = String(cfg.platformAddress || '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => `<div>${esc(l)}</div>`).join('');

  const hsnRows = breakdown.map(b => `
    <tr>
      <td>${esc(b.hsnCode)}${b.label ? `<div class="muted">${esc(b.label)}</div>` : ''}</td>
      <td>${esc(pct(b.rate))}</td>
      <td class="num">₹${money(b.taxableValue)}</td>
      <td class="num">₹${money(b.cgst)}</td>
      <td class="num">₹${money(b.sgst)}</td>
      <td class="num">₹${money(b.igst)}</td>
    </tr>`).join('');
  // The totals ROW below prints order.cgst/sgst/igst directly (the
  // authoritative aggregate already stored on the order) rather than
  // re-summing the HSN lines — only the taxable-value column is a genuine
  // re-sum, since there's no separate authoritative "total taxable value"
  // column to defer to.
  const taxableTotal = breakdown.reduce((s, b) => s + (Number(b.taxableValue) || 0), 0);

  const itemRows = items.map(it => `
    <tr>
      <td>${esc(it.name)}</td>
      <td>${esc(it.hsnCode || '')}</td>
      <td class="num">${esc(String(it.qty || 1))}</td>
      <td class="num">₹${money(it.price)}</td>
      <td class="num">₹${money((Number(it.price) || 0) * (Number(it.qty) || 1))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Tax Invoice ${esc(order.invoice_no)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 24px; font-size: 13px; }
  .sheet { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; letter-spacing: 1px; margin: 0 0 4px; }
  .sub { color: #555; margin-bottom: 20px; }
  .grid { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 20px; }
  .box { flex: 1 1 220px; border: 1px solid #ccc; border-radius: 6px; padding: 12px 14px; }
  .box h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #777; margin: 0 0 8px; }
  .box div { line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 12px; }
  th { background: #f2f2f2; }
  td.num, th.num { text-align: right; }
  tfoot td { font-weight: bold; background: #fafafa; }
  .muted { color: #888; font-size: 11px; }
  .totals { width: 320px; margin-left: auto; }
  .totals td { border: none; padding: 3px 0; }
  .totals tr.grand td { border-top: 2px solid #1a1a1a; font-weight: bold; font-size: 14px; padding-top: 8px; }
  .print-note { margin-top: 24px; font-size: 11px; color: #888; }
  @media print { body { padding: 0; } .print-note { display: none; } }
</style>
</head>
<body>
<div class="sheet">
  <h1>TAX INVOICE</h1>
  <div class="sub">Invoice No: <b>${esc(order.invoice_no)}</b> &nbsp;·&nbsp; Date of issue: <b>${esc(issuedAt)}</b> &nbsp;·&nbsp; Order: ${esc(order.order_no)}</div>

  <div class="grid">
    <div class="box">
      <h2>Sold By</h2>
      <div><b>${esc(cfg.platformLegalName || 'Archery.Services')}</b></div>
      ${platformAddrLines}
      <div>${supplierGstinLine}</div>
    </div>
    <div class="box">
      <h2>Billed To</h2>
      <div><b>${esc(order.customer_name)}</b></div>
      ${addrLines}
      ${buyerGstinLine}
    </div>
    <div class="box">
      <h2>Place of Supply</h2>
      <div>${esc(order.place_of_supply_state || '—')}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>HSN/SAC</th><th>Rate</th><th class="num">Taxable value</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th></tr></thead>
    <tbody>${hsnRows || '<tr><td colspan="6">No tax lines recorded.</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Total</td>
        <td class="num">₹${money(taxableTotal)}</td>
        <td class="num">₹${money(order.cgst)}</td>
        <td class="num">₹${money(order.sgst)}</td>
        <td class="num">₹${money(order.igst)}</td>
      </tr>
    </tfoot>
  </table>

  <table>
    <thead><tr><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${itemRows || '<tr><td colspan="5">No items recorded.</td></tr>'}</tbody>
  </table>

  <table class="totals">
    <tr><td>Items subtotal</td><td class="num">₹${money(order.goods)}</td></tr>
    <tr><td>Delivery fee</td><td class="num">₹${money(order.delivery_fee)}</td></tr>
    <tr><td>Platform fee</td><td class="num">₹${money(order.platform_fee)}</td></tr>
    <tr><td>CGST</td><td class="num">₹${money(order.cgst)}</td></tr>
    <tr><td>SGST</td><td class="num">₹${money(order.sgst)}</td></tr>
    <tr><td>IGST</td><td class="num">₹${money(order.igst)}</td></tr>
    <tr class="grand"><td>Grand total</td><td class="num">${esc(order.currency || 'INR')} ${money(order.total)}</td></tr>
  </table>

  <div class="print-note">This is a computer-generated tax invoice and does not require a signature. Use your browser's Print → Save as PDF to keep a copy.</div>
</div>
</body></html>`;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);

  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return json(res, { error: 'Bad id' }, 400);

  try {
    const actor = await checkAdmin(req);
    const isAdmin = !!(actor && can(actor, 'orders'));

    const r = await q('select * from orders where id=$1', [id]);
    const order = r.rows[0];

    if (!isAdmin) {
      // Do not distinguish "no such order" from "wrong on=" for an
      // unauthenticated caller — leaking that distinction would let anyone
      // enumerate which order ids are real just by trying ids and watching
      // for 404 vs 403, with no need to ever guess a correct on=. An admin
      // (who already has full order-list visibility via /api/orders) gets
      // the more precise 404 below instead once they're past this gate.
      const on = req.query.on;
      const onMatches = !!order && typeof on === 'string' && on.length > 0 && on === order.order_no;
      if (!onMatches) return json(res, { error: 'Unauthorised' }, 403);
    }
    if (!order) return json(res, { error: 'Not found' }, 404);

    // CLAUDE.md §1.1 — never render a document implying a real tax invoice
    // exists when it doesn't. An unpaid order, or one that hasn't had a
    // number minted yet (fulfil() mints it exactly once, on payment), gets
    // an honest 404 instead of a blank/fake invoice shell.
    if (order.payment_status !== 'paid' || !order.invoice_no) {
      return json(res, { error: 'Invoice not yet available — this order has not been paid.' }, 404);
    }

    const cfg = await loadPricingConfig();
    const html = renderInvoiceHtml(order, cfg);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  } catch (e) {
    console.error('order-invoice:', e?.message);
    return json(res, { error: 'Server error' }, 500);
  }
};
