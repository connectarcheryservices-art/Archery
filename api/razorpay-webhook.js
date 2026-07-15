// POST /api/razorpay-webhook — the SOURCE OF TRUTH for payment state (§1.6).
//
// Why this file uses a different handler style to every other endpoint:
// Razorpay signs the RAW request body ("Do not parse or cast the webhook
// request body" — razorpay.com/docs/webhooks/validate-test/). Vercel's
// (req, res) helpers hand you `req.body` already parsed, and re-serialising it
// with JSON.stringify would change key order and whitespace, so the HMAC would
// not match. Vercel's Node runtime also supports the Web Standard signature,
// where `request.text()` returns the exact bytes received. That is the only way
// to verify this signature correctly, so this one endpoint uses it.
// (Docs: vercel.com/docs/functions/runtimes/node-js — "fetch Web Standard export".)
//
// Contract with Razorpay:
//   • Return 2xx or it retries. So: record, then process, then 200.
//   • The SAME event will arrive more than once. Idempotency is mandatory —
//     without it, a retry decrements stock twice. Enforced by the unique index
//     on webhook_events(provider, event_id) plus a conditional UPDATE.
//   • An unverified body is not evidence of anything: signature first, always.
'use strict';
const { q } = require('./_lib/db');
const { verifyWebhookSignature, markPaid, fulfil } = require('./_lib/payments');

// Events we act on. Anything else is recorded and acknowledged, not processed —
// acknowledging stops Razorpay retrying an event we will never care about.
const HANDLED = new Set(['payment.captured', 'order.paid', 'payment.failed']);

async function handle(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // 1. RAW bytes. Never JSON.parse before the HMAC is checked.
  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  // 2. Signature. Nothing is written and nothing is parsed until this passes.
  const sig = verifyWebhookSignature(raw, signature);
  if (!sig.ok) {
    console.error('razorpay webhook rejected:', sig.reason);
    // 400, not 500: a bad signature is a bad request, and we do NOT want
    // Razorpay retrying a forgery. Real deliveries are always signed.
    return Response.json({ ok: false, error: 'invalid signature' }, { status: 400 });
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return Response.json({ ok: false, error: 'malformed json' }, { status: 400 }); }

  const event = body.event;
  const id = eventId || `${event}:${body?.payload?.payment?.entity?.id || ''}`;
  if (!id) return Response.json({ ok: false, error: 'no event id' }, { status: 400 });

  // 3. Idempotency. The unique index makes this a hard guarantee rather than a
  //    hopeful check: a concurrent duplicate delivery loses the insert race.
  try {
    await q(
      `insert into webhook_events (provider, event_id, event, payload, signature_ok)
       values ('razorpay', $1, $2, $3, true)`,
      [id, event, JSON.stringify(body)]);
  } catch (e) {
    if (String(e?.code) === '23505') {
      // Already seen. Ack so Razorpay stops retrying.
      return Response.json({ ok: true, duplicate: true });
    }
    console.error('webhook record failed:', e?.message);
    // Could not record => cannot guarantee idempotency => do NOT process.
    // Non-2xx makes Razorpay retry, which is what we want here.
    return Response.json({ ok: false, error: 'record failed' }, { status: 500 });
  }

  if (!HANDLED.has(event)) {
    await q(`update webhook_events set processed=true, processed_at=now() where provider='razorpay' and event_id=$1`, [id]).catch(() => {});
    return Response.json({ ok: true, ignored: event });
  }

  try {
    const payment = body?.payload?.payment?.entity;
    const orderEntity = body?.payload?.order?.entity;
    const razorpayOrderId = payment?.order_id || orderEntity?.id;

    if (!razorpayOrderId) throw new Error('no razorpay order id in payload');

    if (event === 'payment.failed') {
      // Only ever moves pending -> failed. A paid order is never un-paid by a
      // late failure event for an earlier attempt.
      await q(
        `update orders set payment_status='failed', payment_source='webhook',
           payment_notes=$1, updated_at=now()
         where razorpay_order_id=$2 and payment_status='pending'`,
        [String(payment?.error_description || 'payment failed').slice(0, 300), razorpayOrderId]);
    } else {
      // payment.captured / order.paid. Razorpay states the captured amount; the
      // amount is checked against OUR price inside markPaid (§1.6).
      const amountPaise = Number(payment?.amount ?? orderEntity?.amount_paid);
      const r = await markPaid({
        razorpayOrderId,
        paymentId: payment?.id || null,
        amountPaise,
        source: 'webhook',
      });
      if (r.status === 'paid') await fulfil(r.order);
      if (r.status === 'amount_mismatch' || r.status === 'unknown_order') {
        console.error('razorpay webhook:', r.status, r.reason);
        await q(`update webhook_events set error=$1 where provider='razorpay' and event_id=$2`,
          [`${r.status}: ${r.reason}`, id]).catch(() => {});
      }
    }

    await q(`update webhook_events set processed=true, processed_at=now() where provider='razorpay' and event_id=$1`, [id]).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    console.error('razorpay webhook processing:', e?.message);
    await q(`update webhook_events set error=$1 where provider='razorpay' and event_id=$2`,
      [String(e?.message).slice(0, 300), id]).catch(() => {});
    // 500 => Razorpay retries. The insert above already claimed the event id, so
    // the retry would be swallowed as a duplicate; release it so the retry can
    // actually run.
    await q(`delete from webhook_events where provider='razorpay' and event_id=$1 and processed=false`, [id]).catch(() => {});
    return Response.json({ ok: false }, { status: 500 });
  }
}

module.exports = { fetch: handle };
module.exports.default = { fetch: handle };
