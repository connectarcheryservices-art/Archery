# How to Go Live — Archery.Services

Production is **Vercel** (serverless, `api/**`) + **Supabase Postgres**. There is one backend
and it is the one in `api/` (ADR-0001). Nothing else is supported.

> **This file used to describe deploying `local-server.js` to Railway/Render/a VPS, with a
> published default admin password of `archery2025`.** That file is deleted and those
> instructions were dangerous: it was a second admin login with no rate limiting, no 2FA, a
> non-constant-time password compare, and it minted the same `archery-admin-v1` token the real
> API accepts. If you ever followed the old instructions, **tear that instance down and rotate
> `ADMIN_PASSWORD`** — anyone who knew the default had full admin.

---

## Prerequisites

The Vercel CLI must be authenticated as **`connectarcheryservices-4339`** (team `archery`) —
*not* edurankai/quantumeventedu. `vercel login` uses device auth.

```bash
vercel whoami        # expect: connectarcheryservices-4339
```

## Deploy

> ### ⚠ Migrations run BEFORE the deploy, never after
> The code assumes its schema. Deploying `008_payment_truth.sql`'s code without applying the
> migration first means `markPaid()` writes columns that do not exist, and **every payment
> confirmation fails**. Order: apply migrations → deploy → re-alias → verify.

**The domain does NOT auto-follow production.** A deploy alone changes nothing that users see —
you must re-alias both hosts or the deploy is invisible:

```bash
vercel deploy --prod --yes --scope archery
vercel alias set <new-deployment-url> archery.services      --scope archery
vercel alias set <new-deployment-url> www.archery.services  --scope archery
```

Symptoms of a missed re-alias: the live site serves the old build; `/api/razorpay/config`
returns `{"keyId":""}`; admin login says "wrong password".

## Verify after deploying

```bash
curl -s https://archery.services/api/razorpay/config     # keyId must be non-empty
curl -s https://archery.services/api/stats               # real counts, or {} — never invented
curl -sI https://archery.services/ | grep -i content-security-policy
```

## Environment variables

Set in the Vercel dashboard (project `archery`), never in the repo:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres, session pooler `:5432` |
| `ADMIN_PASSWORD` | Owner master password. Signs the owner token. Long + random. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification — **a different secret from the key secret** (§1.2). Set when you create the webhook (below). Without it the webhook rejects every delivery. |
| `ANTHROPIC_API_KEY` | AI coach |
| `SMTP_*` | Mail |

No secret signs two things (CLAUDE.md §1.2). If a value has ever been pasted into a chat, a
ticket, or a log, it is burned — rotate it.

## Database

Migrations only, forward-only (ADR-0002). There is no `schema.sql` to run.

```bash
DATABASE_URL="postgresql://…:5432/postgres" node supabase/apply.js
```

The data store is Postgres. `data.json` is not used and has not been since the Supabase
migration.

## Razorpay webhook — required, this is how payments actually settle

Payment state is decided by the webhook, not the customer's browser (CLAUDE.md §1.6). Until
this is configured, an order is only marked paid if the customer's tab survives the redirect
back from checkout — anyone who pays and closes the tab leaves real money against a `pending`
order.

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**
2. URL: `https://archery.services/api/razorpay-webhook`
3. Secret: generate a strong random value — **not** your API key secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Active events: `payment.captured`, `payment.failed`, `order.paid`
5. Put that same secret in Vercel as `RAZORPAY_WEBHOOK_SECRET`, then redeploy + re-alias.

Verify it: Razorpay's webhook page has a delivery log; a healthy delivery returns `200
{"ok":true}`. A `400 invalid signature` means `RAZORPAY_WEBHOOK_SECRET` does not match the
dashboard.

### Recovering money that is already stuck

Admin → **Shop Orders → Payment reconciliation → Check (dry run)** lists orders we have as
`pending` that Razorpay says were captured. "Reconcile now" settles them. It asks Razorpay for
the truth server-side and never invents a payment; an order with no captured payment is left
alone. Run the dry run first — and run it once after this release, because the backlog of
stuck orders predates the webhook.

## Admin access

`/admin.html` is deliberately **not linked from any public page**. Navigate to it directly.
The owner should enrol 2FA (Team & Roles → Two-factor authentication) — with 2FA off, the
master password is the only thing standing between an attacker and full control.
