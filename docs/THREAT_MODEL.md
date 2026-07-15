# THREAT_MODEL.md

**Why this exists:** the absence of this document is the root cause of half the findings in the
audit. `can()` guards **2 of 24** handlers not because anyone decided support staff should be
able to delete the catalogue, but because **nobody ever wrote down who may do what.** This is
that document. It is normative: if code disagrees with this file, the code is a bug.

**Status:** v1, 2026-07-13. Current-state findings are **verified against the code**, not assumed.

---

## 1. Assets (what an attacker wants, ranked)

| # | Asset | Why it matters |
|---|---|---|
| A1 | **Competition results** (arrows, ends, matches, rankings) | The system of record. Corruption = a stolen medal, an invalid national team selection. **Highest integrity requirement on the platform.** |
| A2 | **Money** — orders, payouts, fees (₹7,999 → ₹8,99,999 licences) | Direct loss; marketplace + tax liability. |
| A3 | **Minors' personal data** (`dob`, `gender`, `club`, behaviour) | DPDP s.9 — up to **₹200 crore**. Archery is a youth sport. |
| A4 | **Owner/admin session** | Full platform compromise. |
| A5 | **Athlete PII** (licence numbers, contact, medical/para classification) | Para classification data is health-adjacent → sensitive. |
| A6 | **Credentials & secrets** (`ADMIN_PASSWORD`, DB URL, Razorpay secret) | One secret currently signs everything (see T4). |
| A7 | **LLM spend** | Uncapped, anonymous, Opus-priced (T7). |
| A8 | **Platform reputation / trust** | The product being sold to federations *is* trustworthiness. |

---

## 2. Actors and trust boundaries

Ordered by trust. **Every actor below "staff" is hostile until proven otherwise.**

| Actor | Authenticated | Trust | May do (target state) |
|---|---|---|---|
| **Anonymous** | No | **Zero** | Read public content; register; submit a report. Nothing else. |
| **Customer** | Yes (user token) | Low | Own profile, own orders, own cart. **Own data only.** |
| **Minor (<18)** | Yes | Low + **protected** | As customer, minus: behavioural profiling, targeted merchandising, marketing. **Not a permission tier — a prohibition tier.** |
| **Athlete** | Yes | Low | Own results (read), own profile, own entries. **Cannot alter own scores.** |
| **Seller** | Yes + approved | Low-medium | Own listings, own orders. **Seller-controlled strings are attacker-controlled** (T1). |
| **Coach** | Yes + licensed | Medium | Rostered athletes' training data — **with athlete consent**, scoped to roster. |
| **Club admin** | Yes | Medium | Own club's members/classes/finance. **Scoped to club.** |
| **Federation officer** (president/secretary/treasurer/executive) | Yes | Medium-high | Own federation's scope only. District ⊄ state ⊄ national. **Scope is the boundary, not the role.** |
| **Judge / official** | Yes + certified | High **on results** | Adjudicate arrows/ends; corrections are events (ADR-0007). Highest authority over A1, no authority over A2. |
| **Staff — support** | Yes | Medium | Orders (status), chat, inbox triage. **No content deletion, no settings, no staff.** |
| **Staff — editor** | Yes | Medium | Content + approvals. **No settings, no staff.** |
| **Staff — manager** | Yes | High | + settings, staff. Not owner-only ops. |
| **Owner** | Yes | Highest | Everything. **Must be the most protected account — currently it is the least (T5).** |

**Trust boundaries** (crossing one = validate + authorise + audit):
1. Internet → API (`api/_lib/router.js`)
2. API → Database (`api/_lib/db.js`)
3. API → Razorpay / SMTP / Anthropic
4. **Seller/user content → admin browser** ← *the boundary being crossed today* (T1)
5. Scoring device (offline) → sync endpoint (ADR-0006)
6. Federation scope → federation scope

---

## 3. Threats — verified current state

Each is confirmed against code. `T#` maps to `docs/PLAN.md` Phase 0/1.

### T1 — Stored XSS → owner account takeover · **CRITICAL**
`admin.html:982-984` renders `${p.name}`, `${p.brand}`, `${p.category}` raw into `innerHTML`.
An **approved seller controls these strings**; validation is only "name non-empty, price
numeric". No CSP (verified: 0 occurrences in `vercel.json`, while 5 other headers are set).
**Impact:** seller → script in owner's session → A4 → everything.
*Note the irony:* `admin.html:1307` (profiles) **does** use `escA`. The helper exists; the
highest-value sink doesn't use it. → **Fix + CSP + one sanitiser (ADR-0005).**

**Status: fixed** (`8c4675b`) — sink escaped, one shared `esc.js`, CSP added.

**On the CSP in `vercel.json` — read before touching it.** It is defence-in-depth, *not* the
fix; the fix is escaping. `object-src`/`base-uri`/`form-action`/`frame-ancestors` are hard
blocks. But `script-src` still carries **`'unsafe-inline'`**, because ~30 pages use inline
`<script>` and `onclick=` attributes. That means **an injected inline handler is NOT blocked by
CSP today** — which is exactly why escaping is mandatory and why ADR-0005 (build step) exists.
Removing `'unsafe-inline'` is a **Phase 1 gate item**; do not consider CSP complete until it is
gone. (This note lived as a `"comment"` key inside `vercel.json` until 2026-07-15 — Vercel's
schema rejects unknown properties, so that file could not deploy at all. JSON has no comments;
rationale for `vercel.json` belongs here.)

### T2 — No capability enforcement · **CRITICAL**
`can()` called in **2 of 24** handlers (`mail.js`, `staff.js`). The other 22 use `checkAdmin()`
= *"is some admin logged in"*. **A support-role hire can hard-delete the entire catalogue.**
→ **Middleware, default deny (ADR-0003).**

### T3 — Roles read from token, not DB · **CRITICAL**
`auth.js:56` returns `role` from the **token payload**. **You cannot demote or fire anyone** —
their token keeps its role until the master password rotates.
→ **Read role from DB per request; sessions revocable (CLAUDE §1.3).**

### T4 — One secret signs everything · **CRITICAL**
`auth.js:14` `SECRET = ADMIN_PASSWORD` signs the **owner token and staff tokens**;
`users-action.js:12` `'archery-users-v1:' + ADMIN_PASSWORD` signs **customer** tokens.
- Rotating the password **logs out the entire platform** → so it never gets rotated.
- Every token holder has a **plaintext/MAC pair signed with the master password**. HMAC-SHA256
  is fast by design → **offline cracking oracle**.
→ **Split secrets. Never sign with a human-chosen password (CLAUDE §1.2).**

### T5 — Owner token is constant, no expiry, no revocation · **CRITICAL**
`auth.js:35` `HMAC(ADMIN_PASSWORD,'archery-admin-v1')` — constant. No `exp`, no `jti`, no
session store. **Steal once = own forever**; only remedy is rotating the password (which T4
makes catastrophic). Compounded: **no rate limit anywhere** in `api/`, `/api/admin/login`
accepts unlimited guesses (`admin-login.js:16` uses plain `===`, though `timingEq` exists in
`auth.js`), and the owner has **no 2FA while staff do** — *the most privileged account is the
least protected*. `/admin.html` is linked from **11 public pages**.
→ **exp+jti, revocation table, rate limit, owner TOTP, unlink from public footers.**

### T6 — Payment integrity · **HIGH**
- **No webhook exists** (verified: 0 matches in `api/`). The **only** trigger marking an order
  paid is the customer's browser → tunnel closes = money captured, order `pending` forever.
- `/api/razorpay/verify` is **unauthenticated** and sets `payment_status='failed'` on bad
  signature (`razorpay-verify.js:27`) → **anyone guessing an order ID can fail a stranger's
  order.**
- *Credit:* the HMAC check itself is timing-safe and idempotent (`payment_status <> 'paid'`).
  It's correct — it just never runs.
→ **Webhook = source of truth; authenticate verify; reconcile stuck pendings (real money).**

### T7 — Unmetered anonymous LLM · **HIGH (financial)**
`/api/coach`: no auth, no rate limit, no spend cap, `claude-opus-4-8` (`coach.js:40`), and
`b.history` client-supplied and trusted (`coach.js:33`) → forged assistant turns = trivial
jailbreak, **on our card**.
→ **ADR-0008.**

### T8 — TLS not verified to the database · **HIGH**
`db.js:13` `ssl: { rejectUnauthorized: false }` → MITM-able. → **Pin the Supabase CA.**

**Status: fixed** (`34ea1fa`) — CA pinned at `api/_certs/supabase-prod-ca-2021.crt`, verified
against production on 2026-07-15 (a real connection with `rejectUnauthorized: true`).

**Why `vercel.json` has a `functions.includeFiles` entry — do not remove it.** `db.js` now
*refuses to connect* without the pinned CA, which is the point of the fix but makes that `.crt`
load-bearing for the whole site: if it is not bundled into the function, production comes up
with **no database at all**. It is read via `fs.readFileSync(CA_PATH)` where `CA_PATH` is a
`const` built with `path.join` — the pattern Vercel's automatic file tracing is least reliable
at detecting. A file whose absence is a total outage does not get left to static analysis.
Correspondingly, **never add `api/_certs/` to `.vercelignore`.**

### T9 — Minors unprotected · **CRITICAL (legal, A3)**
`registrations` takes `dob`/`gender`/`club`/`fedNumber` with only "a name exists". **No age
gate, no parental consent.** `reco.js` behaviourally profiles **every** visitor. Own seed data
includes "Junior Coach — U-18 Programme".
**DPDP s.9(1)** requires *verifiable* parental consent (Rule 10, DPDP Rules 2025 —
DigiLocker-anchored). **s.9(3) is an absolute prohibition on behavioural monitoring of
under-18s that parental consent cannot unlock.** Up to **₹200 crore**. Full compliance:
**May 2027**.
→ **Age assurance at creation; profiling off for minors, unconditionally.**

### T10 — Fabricated data / dark patterns · **CRITICAL (legal + constitutional)**
`reco.js:113/118` `liveViewers()` / `soldRecently()` are LCGs (6–45 "viewers", 3–24 "sold");
`reco.js:107` **blends `liveViewers(p.id)*2` into `trending()` ranking**. The source comment
reads *"so it feels alive"* — **documented intent**.
CCPA **Guidelines for Prevention and Regulation of Dark Patterns, 2023** name *"displaying a
false sense of popularity of a product"* as the worked example of prohibited **False Urgency**.
Also: `resource.js:32` `{...SEED, ...(data||{})}` → the fabricated **52,000 athletes /
1,400 clubs** (`seed.js`) is what the homepage shows whenever the DB is empty.
→ **Delete. Constitutional (CLAUDE §1.1). Phase 0, item 1.**

### T11 — No audit log · **HIGH**
Verified: no audit table, no audit writes. **You cannot answer "who deleted this product."**
Disqualifying for a system of record; unsellable to a federation.
→ **CLAUDE §1.5 + ADR-0003.**

### T12 — Scope confusion (federation / club / seller) · **HIGH**
Roles exist; **scope does not**. A federation officer is an actor *within a federation*; a club
admin within a club; a seller over their own listings. Nothing in the code expresses "this
actor, over this resource". `can(actor, action)` (2 handlers) has no **resource** argument.
→ **`can(actor, action, resource)`. Scope is the boundary.**

### T13 — Offline sync integrity (future, ADR-0006) · **HIGH**
When scoring goes offline: a malicious/buggy device could replay, reorder, or forge arrows.
→ **Idempotent event IDs, causal ordering, judge-adjudicated conflicts, append-only (ADR-0007).
Test adversarially: partition, dupe, reorder, clock skew, two devices one target.**

### T14 — Polymorphic analytics column · **MEDIUM**
`analytics_events.value` holds **product IDs and rupee totals**; `crud.js:46` casts
`value::bigint`. One bad row = 500 on trending. → **ADR-0004.**

---

## 4. Non-goals (v1)

- Nation-state adversaries; physical range security; DDoS beyond platform rate limiting.
- Anti-cheat on the *shooting* itself — that is a judge's job, not software's. Our duty is that
  what the judge decided is **recorded faithfully and provably** (ADR-0007).

---

## 5. Invariants — verify these hold, forever

1. No untrusted string reaches `innerHTML`. CSP enforces it.
2. No secret signs two things. No token is signed with a password.
3. Every token expires; every session is revocable; **role comes from the DB**.
4. Every write is `can(actor, action, resource)`, **default deny**.
5. Every mutation writes an audit row.
6. Payment state changes only via **webhook**.
7. **No number renders that isn't a `SELECT`.**
8. Under-18 → **zero** behavioural processing, regardless of consent.
9. Arrows are append-only; corrections are attributable events.
10. A federation officer cannot read or write outside their federation's scope.
