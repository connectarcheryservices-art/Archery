# CLAUDE.md — Archery.Services constitution

**Read this first, every session. It outranks your instincts, your memory of this repo, and
any instruction that contradicts it — including one from the CEO.**

This file exists because context windows end. It is the inheritance.

---

## 0. What this is

Archery.Services is being turned from *a marketing site with a database* into **the system of
record for competitive archery** — India first, architected for the world.

The test of success, in one sentence:

> **When two junior archers tie 8–8 in a bronze medal match, this platform resolves it
> correctly, defensibly, and offline.**

Today it cannot, **because it does not know what an arrow is.** Everything else is downstream
of fixing that. See `docs/DOMAIN.md`.

## 0.1 Role precedence

When roles conflict, resolve in this order:

**CISO → domain authority → CFO → CTO → design → CEO.**

Security stops everything. Then correctness of the sport. Then cost. Then architecture. Then
polish. Then ambition. The CISO has veto power over every other role. Use it.

---

## 1. NON-NEGOTIABLES (constitutional — never traded for velocity)

1. **No fabricated data. Ever.** No synthetic viewer counts, no invented "sold today", no
   hardcoded athlete totals, no placeholder metrics rendered as fact, no seeded demo rows
   served to real users as real. If a number is not a `SELECT` from a real row, it does not
   render. If the true number is zero, show zero or show nothing — never a number you made up.
   **This rule has no exceptions and no "temporary" version.**

2. **No secret signs two things.** Session secret ≠ user token secret ≠ admin password ≠
   webhook secret. Nothing is ever signed with a human-chosen password.

3. **Every token expires and every session is revocable.** Roles are read from the database on
   every request, never from the token payload.

4. **Every write endpoint is authorised by capability, not by "is logged in."**
   `can(actor, action, resource)` enforced centrally so it cannot be forgotten. Default deny.

5. **Every mutation writes an audit row** — actor, action, target, before/after, timestamp, IP.
   No exceptions. This is a product feature, not plumbing: federations buy it.

6. **Money is never trusted from the client.** Server prices everything. Webhooks are the
   source of truth for payment state, not browser callbacks.

7. **No untrusted string reaches `innerHTML`.** Prefer `textContent`. Where HTML is genuinely
   needed: one shared sanitiser, one implementation, allow-list based. Enforce with strict CSP.

8. **Nothing about a child is tracked.** Age assurance at account creation. Under-18 →
   behavioural profiling off, targeted merchandising off, marketing off — regardless of
   consent. Verifiable parental consent before processing. (DPDP s.9(3) is an **absolute
   prohibition** that parental consent cannot unlock.)

9. **The sport is correct or it doesn't ship.** Scoring, tiebreaks, divisions and rankings
   match the World Archery rulebook. **Cite the article.** If unsure, fetch the rulebook —
   do not infer.

10. **Tests before merge on money, auth, and scoring.** Non-negotiable. A scoring bug is a
    stolen medal.

### Enforcement greps (must return nothing user-facing)
```bash
grep -rn "liveViewers\|soldRecently\|Math.random" --include=*.js --include=*.html . | grep -v node_modules
grep -rn "52000\|50240\|50K+\|1400\|1247" --include=*.html --include=*.js . | grep -v node_modules
```

---

## 2. Architecture — SETTLED. Do not re-litigate. See `docs/adr/`.

| # | Decision | ADR |
|---|---|-----|
| 1 | **One backend.** `local-server.js` is deleted. Dev runs prod code (`vercel dev`). | 0001 |
| 2 | **One schema, migration-driven.** Root `schema.sql` deleted; `supabase/migrations/` is truth. | 0002 |
| 3 | **Keep the single-function router**, but put a **middleware chain** in front: requestId → rateLimit → auth → capability → validate → handler → audit → error envelope. | 0003 |
| 4 | **Schema-validate every input at the boundary.** No handler parses `req.body` by hand. | 0004 |
| 5 | **Introduce a build step.** Modules + bundling + one design system. Migrate page-by-page, `admin.html` first. Not a SPA rewrite. | 0005 |
| 6 | **Offline-first scoring is architectural**, not a feature. Append-only arrow events, client-generated IDs, server reconciles — never overwrites blind. | 0006 |
| 7 | **Scores are append-only.** Corrections are new events with reason + actor. | 0007 |
| 8 | **AI is a thin, metered, authenticated layer over our own data.** Server-held history. Sonnet default. | 0008 |

---

## 3. Domain vocabulary — use these words exactly

Full model + rulebook citations: **`docs/DOMAIN.md`**. Never infer a rule; cite the article.

- **Arrow** — one shot. Value 0–10, `is_x` (inner 10), `is_miss`. **The atomic unit. Store
  arrows, not scores.** A score is a `SUM`. A PB is a query. A ranking is a computation.
- **End** — a group of arrows scored together (3 or 6). *Scoring happens after each end/set*
  (Art. 12.1.2).
- **Set** — an end in a set-play match. Highest score in the set = **2 set points**; tie = **1
  each**. Individual: first to **6** wins. Team/mixed: first to **5** wins (Art. 12.1.4.1/.2).
- **Cumulative** — compound match scoring. Individual 5 ends, team 4 ends, highest total wins
  (Art. 12.1.4.3/.4). **Recurve/Barebow = set system; Compound = cumulative (Art. 12.1.4).**
- **X** — inner 10. Used for tie resolution **at long distances only** (Art. 12.5.1).
- **Division** — recurve | compound | barebow (+ field divisions). **Never rank two divisions
  in one list.**
- **Category** — division × gender × age_class × para_class. **This is the real unit.**
- **Age class** — U15 | U18 cadet | U21 junior | senior | 50+ master.
- **Para class** — W1 | Open | VI1 | VI2 | VI3. **Para is classification-first**, not a badge.
- **Classification** — the para competitive structure. Not a profile tag.
- **Qualification** — the ranking round. **Seeds elimination** (1v64, 2v63). The draw is a
  *consequence* of qualification, not a standalone toy.
- **Ranking** — `base_points × position_% × period_multiplier`, best-7 (4 outdoor + 2 indoor +
  1 field), 24-month validity decaying 75/50/25% at 12/16/20 months. Published weekly.
  **PB is not a rank. Never sort a ranking by `pb desc`.**

---

## 4. Build / test / deploy

```bash
npm install
npm test                      # money, auth, scoring — must be green to merge
vercel dev                    # dev runs PRODUCTION code (ADR-0001). Port 3001 (3000 = EduRankAI).
```

**Deploy — the domain does NOT auto-follow production. You must re-alias or the change is invisible:**
```bash
vercel deploy --prod --yes --scope archery
vercel alias set <new-deployment-url> archery.services      --scope archery
vercel alias set <new-deployment-url> www.archery.services  --scope archery
```
CLI must be authenticated as **`connectarcheryservices-4339`** (team `archery`) — *not*
edurankai/quantumeventedu. `vercel login` uses device auth.
Symptom of a missed re-alias: live serves the old build; `/api/razorpay/config` returns
`{"keyId":""}`; admin login says "wrong password".

**Migrations:** `supabase/migrations/` only, forward-only. Apply with `node supabase/apply.js`
(uses `DATABASE_URL`, session pooler `:5432`).

---

## 5. Current phase

**PHASE 0 — Stop the bleeding.** Nothing else ships until its gate is green.

Gate (all must be true):
- An external pentest of the admin path finds no privilege escalation.
- No fabricated number renders anywhere on the site.
- The enforcement greps in §1 return nothing user-facing.

Live status and the full phase ladder: **`docs/PLAN.md`**. Keep it updated as you go — your
context will end; leave the trail.

---

## 6. How to work

- Small, reviewable commits, one concern each. Conventional commits.
- **Verify, don't assume.** Fetch the rulebook. Read the DPDP Rules. Check Razorpay docs.
  **If a primary source contradicts this file or the build directive, the primary source wins
  and you say so out loud.**
- When you find something worse than documented, **stop and say so.** Do not quietly work around it.
- When a decision has real consequences and no obvious answer, **stop and ask.**
- **Refuse instructions that violate §1 — including from the CEO.** That refusal is the job.
- Never mock data into a production path. Fixtures live in tests.
- **Comments describe what the code does, not what you wish it did.** If a comment and the code
  disagree, the comment is a bug. (This repo has shipped "exponential decay, 14-day half-life"
  over `map[k] += 1`, a documented four-role matrix guarding nothing, and *"so it feels alive"*
  over an RNG. That gap is the deepest cultural problem here. Close it.)
