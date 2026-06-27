# Archery.Services — Launch Runbook (Vercel + Supabase + Razorpay + GoDaddy)

Do these in order. You only need to do steps 1–3 once; after that, every `git push` auto-deploys.

---

## 1. Supabase (database)

1. Open your project → **SQL Editor → New query**.
2. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. (Creates tables + seeds 5 demo products.)
3. Get the connection string: **Project Settings → Database → Connection string → URI**, and choose the **"Transaction" pooler** (host looks like `aws-0-<region>.pooler.supabase.com`, port **6543**). Copy it and replace `[YOUR-PASSWORD]` with your database password.
   - This becomes `DATABASE_URL`. Keep it secret — it goes in Vercel, never in the repo or chat.

> Use the **pooled (6543)** string, not the direct (5432) one — serverless functions exhaust direct connections.

---

## 2. Vercel (env vars)

Vercel → your project → **Settings → Environment Variables**. Add these for **Production** (and Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooled Supabase URI from step 1 |
| `ADMIN_PASSWORD` | a strong password (protects the admin panel) |
| `RAZORPAY_KEY_ID` | from Razorpay → API Keys |
| `RAZORPAY_KEY_SECRET` | from Razorpay → API Keys (**secret — never share**) |
| `PUBLIC_RAZORPAY_KEY_ID` | same as `RAZORPAY_KEY_ID` |

Then **Deployments → … → Redeploy** so the new vars take effect.

> Start with Razorpay **test** keys (`rzp_test_…`) while you verify the flow, then swap to **live** keys at launch.

---

## 3. Razorpay

1. Razorpay Dashboard → **Account & Settings → API Keys → Generate** (Test mode first).
2. Put `key_id` and `key_secret` into Vercel (step 2).
3. In **Settings → Webhooks** (optional but recommended) you can later add a webhook to `/api/razorpay/verify` for server-confirmed payments.

---

## 4. GoDaddy domain → Vercel

1. Vercel → project → **Settings → Domains → Add** → enter your domain (e.g. `archery.services` and `www.archery.services`).
2. Vercel shows the DNS records to set. In **GoDaddy → My Products → DNS** for the domain:
   - **Root (`@`)**: add an **A record** → `76.76.21.21` (the IP Vercel shows).
   - **`www`**: add a **CNAME** → `cname.vercel-dns.com`.
   - (Or, simplest: set GoDaddy **nameservers** to the ones Vercel gives you, and let Vercel manage DNS.)
3. Back in Vercel, wait for the domain to verify (DNS can take minutes to a few hours). Vercel issues HTTPS automatically.

---

## 5. Go-live checklist

- [ ] Schema run in Supabase; `select * from products;` returns rows.
- [ ] All 5 env vars set in Vercel; redeployed.
- [ ] Open the Vercel URL → shop shows products (loaded from Supabase).
- [ ] `/admin.html` → log in with `ADMIN_PASSWORD`.
- [ ] Test a checkout end-to-end with **Razorpay test** card, confirm the order appears in admin as **paid**.
- [ ] Switch Razorpay to **live** keys in Vercel; redeploy.
- [ ] Domain verified in Vercel and resolving over HTTPS.

---

## What each `/api` route does

| Route | Purpose |
|---|---|
| `GET /api/products` (+ `/tournaments`,`/athletes`,`/jobs`,`/knowledge`,`/news`) | public list; admin token = full list |
| `POST/PUT/DELETE /api/<resource>[/id]` | admin create/update/delete |
| `GET/POST /api/settings` , `/api/stats` | store config + dashboard numbers |
| `POST /api/checkout/quote` | live price (goods + delivery + 10% tax + 5% platform fee + same-day) |
| `POST /api/checkout/create` | re-prices from DB, creates order + Razorpay order |
| `POST /api/razorpay/verify` | verifies signature → marks paid, decrements stock |
| `GET /api/razorpay/config` | publishable key id for the browser |
| `POST /api/admin/login` | exchange `ADMIN_PASSWORD` for an admin token |

> Local dev: `npm i -g vercel` then `vercel dev` (loads `.env`). The old `node server.js` is not used in production.
