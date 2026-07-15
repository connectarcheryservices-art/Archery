# PLAN.md — phases, gates, and where we stopped

**Keep this updated as you go.** Your context will end. This is the trail.

**Rule:** do not start a phase until the previous gate is **green and shown**.

---

## Status

| | |
|---|---|
| **Current phase** | **Phase 0 — Stop the bleeding** |
| **Phase 0 progress** | **0 / 9** — not started (§2 documentation complete) |
| **Last updated** | 2026-07-13 |
| **Live** | https://archery.services (feature-rich, **and shipping T1/T5/T10 right now**) |

### Where we stopped
§2 of the build directive is **complete**: repo explored, all §3 findings **verified against
code** (with corrections below), and the seven documents written:
`CLAUDE.md` · `docs/adr/0001–0008` · `docs/DOMAIN.md` · `docs/THREAT_MODEL.md` · `docs/PLAN.md`.

**Awaiting review before any feature code is written** (directive §2: *"stop and show me all
seven"*).

### Corrections to the directive (§2.2 — findings are a hypothesis, not scripture)

| Directive said | Verified reality |
|---|---|
| Tiebreak = "score → X → 10 → shoot-off" | **More specific.** Art. 12.5.1: **long** distance → Xs then 10s; **short** distance → **10s then 9s (X not used)**. Art. 12.5.2: for elimination-entry/matches → **shoot-off**, and *"the system of Xs/10s and 10s/9s will not be used"*. Tiebreak branches on **distance × context**. See DOMAIN §3.4. |
| User token secret at `my-profile.js:9` | Actually **`users-action.js:12`**. Same defect. |
| "`/admin.html` is linked in the public footer" | **Worse — 11 public pages** (about, athletes, contact, draw, index, knowledge, pricing, privacy, profile, terms, tournaments). |
| "Nine copy-pasted `esc()` implementations" | **4 files** define one. Substance holds (they're inequivalent; the critical sink escapes nothing). |
| Hardcoded stats "in `schema.sql` (50240/1247)" | Not found in `supabase/schema.sql`. **Confirmed in `seed.js`** (52000/1400/142) and `index.html`; `resource.js:32` `{...SEED, ...(data||{})}` makes seed the answer. Substance holds. |
| "WA-compliant equipment claimed on the shop" | **Not currently present** (grep = 0 in `shop.html`/`product.html`). May be stale or removed. Flagged in DOMAIN §7 if re-added. |
| "8–8 tie in a bronze match" | Under Art. 12.1.4.1 a set-play match ends at **6** set points → **8–8 set points cannot occur**. Tie state is **5–5** → shoot-off. 8–8 is an **arrow-score** tie within a set (→ 1 set point each), or a compound cumulative tie. **Open question — ask which.** DOMAIN §3.4. |
| §3 findings otherwise | **All confirmed.** T1–T14 in THREAT_MODEL. |

**Everything else in §3 verified true**, including the central one: **there is no scores table.
The only occurrence of "arrow" in the schema is a product name.**

---

## Phase 0 — Stop the bleeding
> Nothing else until this is done. Days, not weeks.

- [ ] **0.1** Delete `liveViewers()` / `soldRecently()` / every synthetic urgency badge; remove
      `liveViewers*2` from `trending()`. Use the real 14-day view counts already computed
      server-side. *(T10 — do this first; it is constitutional and legal.)*
- [ ] **0.2** Replace every hardcoded stat with `SELECT count(*)`. Kill `{...SEED, ...data}` in
      `resource.js:32`. Show the true number, even if zero. *(T10)*
- [ ] **0.3** Escape the XSS sink (`admin.html:982-984`); audit all `innerHTML` sites; **one**
      shared sanitiser, delete the rest. *(T1)*
- [ ] **0.4** Strict **CSP** in `vercel.json`. *(T1)*
- [ ] **0.5** **Razorpay webhook** as source of truth; authenticate `/api/razorpay/verify`;
      reconcile stuck `pending` orders — **there is real money in them**. *(T6)*
- [ ] **0.6** `/api/coach`: authenticate + rate limit + spend cap; **Sonnet**; server-held
      history; stream. *(T7, ADR-0008)*
- [ ] **0.7** Rate limit `/api/admin/login`; **TOTP for owner**; constant-time compare; remove
      `/admin.html` from 11 public footers. *(T5)*
- [ ] **0.8** Fix `db.js:13` `rejectUnauthorized:false` → pin the Supabase CA. *(T8)*
- [ ] **0.9** Username-enumeration: run scrypt even when the row is absent. *(T5)*

**Gate:**
- External pentest of the admin path finds **no privilege escalation**.
- **No fabricated number renders anywhere.**
- `grep -rn "Math.random\|liveViewers\|soldRecently\|52000\|50240\|50K"` → nothing user-facing.

---

## Phase 1 — Make it revocable and knowable

- [ ] **1.1** Split secrets (session ≠ user ≠ admin ≠ webhook). Rotate. **Never sign with a
      password.** *(T4)*
- [ ] **1.2** `exp` + `jti` on every token; session/revocation table; **role read from DB**. *(T3, T5)*
- [ ] **1.3** Capability layer into **every** write endpoint — `can(actor, action, resource)`,
      **default deny**, with **scope**. Soft-delete replaces hard delete. *(T2, T12, ADR-0003)*
- [ ] **1.4** **Audit log** on every mutation; first-class admin view. *(T11)*
- [ ] **1.5** Delete `local-server.js` *(ADR-0001)*; delete root `schema.sql`, baseline
      migrations, add indexes + FKs *(ADR-0002)*.
- [ ] **1.6** Fix `analytics_events.value` polymorphism. *(T14, ADR-0004)*
- [ ] **1.7** Schema validation at the boundary *(ADR-0004)*; middleware chain *(ADR-0003)*.
- [ ] **1.8** Tests + CI on **money, auth, RBAC**. Coverage gate. No merge without green.
- [ ] **1.9** Age assurance + parental consent; **profiling off for under-18s**. *(T9)* ⚠️ legal

**Gate:** you can **fire a staff member and prove their access died within 60 seconds**. You can
answer *"who changed this price, when, from what"* for any row. `npm test` is meaningful and CI
blocks merges.

---

## Phase 2 — The sport  ← *the moat*

- [ ] **2.1** Full domain model (DOMAIN §6), migrated + indexed. **The arrow table.**
- [ ] **2.2** Offline-first scoring client *(ADR-0006)*: ends, arrows, X-count. Gloves, sun,
      cheap Android, no network.
- [ ] **2.3** Correct match formats **per division** (Art. 12.1.4 — recurve/barebow set,
      compound cumulative).
- [ ] **2.4** Tiebreaks per Art. 12.5.1/12.5.2 — **branching on distance × context** — incl.
      shoot-off + closest-to-centre. *(Resolve DOMAIN §8.1 first: coordinates or judged
      measurement.)*
- [ ] **2.5** Qualification → **real seeded elimination**; `draw.html` becomes real.
- [ ] **2.6** WA-conformant ranking: per category, weekly, decay, best-7. **Delete
      `query.js:14` `rank:'pb desc'`** and never speak of it again.
- [ ] **2.7** Para classifications as first-class structure *(source the Para rulebook)*.
- [ ] **2.8** Live results from real arrows.

**Gate:** run a **real club tournament end-to-end, offline, on phones**, and produce a result
that survives a protest. A tie resolves correctly per rulebook and the audit trail shows why. A
**federation technical delegate reviews `docs/DOMAIN.md` and signs off.**

---

## Phase 3 — Shop, properly
> Waited because it is **better** on this foundation: real inventory, real trending from real
> views, reviews from verified purchasers, equipment tied to the athletes and events that use it
> — the thing a general retailer cannot do.

- [ ] Product taxonomy; **WA equipment-compliance as a modelled, cited field** — or drop the claim.
- [ ] Seller marketplace: verified identity, obligations, payouts, settlement, returns.
- [ ] **Consumer Protection (E-Commerce) Rules 2020**: published **Grievance Officer**, 48-hour
      acknowledgement, 1-month resolution, **country of origin** per listing, seller identity
      disclosure. *(Currently: none implemented.)*
- [ ] **GST**: HSN codes, compliant invoices, **TCS u/s 52 CGST**, e-invoicing thresholds.
- [ ] Order lifecycle, returns, refunds, shipping; courier restrictions on archery equipment
      (investigate state-level constraints).
- [ ] Server-side recommendations from **aggregate real** behaviour; **under-18s excluded**.
- [ ] Reviews **only from verified purchases**.

**Gate:** a real order ships, is **GST-correct**, can be returned, and **every number traces to
a row**. Grievance Officer published; 48-hour clock instrumented.

---

## Phase 4 — The services platform
> Why the domain is `.services`, not `.shop`. `fees.js` already **sells** these at
> ₹7,999–₹8,99,999 — now make them exist.

- [ ] Clubs & ranges: membership, attendance, scheduling, coach assignment, finance, listing.
- [ ] Coaching: licensing, certification, rosters, session plans, progression **on real arrows**.
- [ ] Officials & judges: certification, assignment, decisions log.
- [ ] Federation tier (district → state → national → international): licensing, sanctioning,
      member sync, rankings roll-up, compliance dashboard, API. **Scoped** *(T12)*.
- [ ] **Anti-doping** (NADA/WADA): testing pool, whereabouts, TUE workflow, education. *Currently
      a static page; it is a legal obligation for a federation.*
- [ ] **Safeguarding** — **take this more seriously than the shop.** Background checks, incident
      reporting, mandatory-reporting workflow, two-adult rules. `guard-rail.html` is a page where
      a policy engine belongs.
- [ ] Para: full classification pathway.
- [ ] Jobs, knowledge, community **last** — content, not infrastructure.

**Gate:** one state association runs its **entire season** on it — sanctioning, registration,
scoring, rankings, licences — **and renews**.

---

## Phase 5 — AI that earns the name
> Only now, because only now does the data exist.

- [ ] RAG over our knowledge base + rulebook, **with citations**.
- [ ] Coaching grounded in **that athlete's actual arrows**: group analysis, end-over-end drift,
      fatigue across a 720, distance-specific weakness, equipment correlation.
- [ ] **Eval set before any prompt change**; golden questions reviewed by a real coach, run in CI.
- [ ] Per-user cost tracking + caps; task-appropriate models.
- [ ] **Under-18: no profiling, no engagement optimisation. Full stop.**

**Gate:** a national-level coach uses it weekly and **would notice if it disappeared**. Eval
scores tracked over time and **gate deploys**.

---

## Definition of done (§10)

1. Nothing is fabricated — every number traces to a row.
2. You can **fire someone**; access dies in <60s, provably.
3. You can answer *"who did this, when, what did it look like before"* for any row.
4. A tournament runs **offline on phones** and survives a protest.
5. A tie resolves **correctly per rulebook**, with an audit trail.
6. Rankings are **computed, not typed**, per category; a federation official agrees.
7. A minor can use the platform **lawfully**.
8. An order is **GST-compliant** end to end; Grievance Officer published; 48h clock running.
9. The AI **cites its sources** and knows the athlete's actual arrows.
10. A federation's technical delegate **reads `docs/DOMAIN.md` and signs**.
