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
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification — distinct from the key secret (§1.2) |
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

## Admin access

`/admin.html` is deliberately **not linked from any public page**. Navigate to it directly.
The owner should enrol 2FA (Team & Roles → Two-factor authentication) — with 2FA off, the
master password is the only thing standing between an attacker and full control.
