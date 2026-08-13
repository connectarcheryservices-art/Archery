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

**Status: fixed** — reconciled 2026-08-13 against PLAN.md's 1.2/1.3 claims by re-reading the
current code, not trusting the claim. `api/_lib/auth.js`'s `checkAdmin()` is `async` and, for
staff, runs `select role, name, username, active, token_valid_after from staff where id=$1` on
**every call** — the token itself (`staffToken`) carries only `{sid}`, no role. Owner path
re-checks `owner_security.token_valid_after` against the token's `iat` each request. A real call
site (`api/_handlers/staff.js:16`, `await checkAdmin(req)`) confirms callers actually await the
DB-backed version. A demotion/deactivation takes effect on the demoted actor's *next request*,
not next login.

### T4 — One secret signs everything · **CRITICAL**
`auth.js:14` `SECRET = ADMIN_PASSWORD` signs the **owner token and staff tokens**;
`users-action.js:12` `'archery-users-v1:' + ADMIN_PASSWORD` signs **customer** tokens.
- Rotating the password **logs out the entire platform** → so it never gets rotated.
- Every token holder has a **plaintext/MAC pair signed with the master password**. HMAC-SHA256
  is fast by design → **offline cracking oracle**.
→ **Split secrets. Never sign with a human-chosen password (CLAUDE §1.2).**

**Status: fixed** — reconciled 2026-08-13. `api/_lib/auth.js:35` reads `SESSION_SECRET` (a
distinct env var) to sign owner+staff tokens; `api/_lib/userauth.js:20` reads `USER_TOKEN_SECRET`
independently for customer tokens — two real, separate secrets, not aliases of the same env var.
`ADMIN_PASSWORD` is now used only as the owner's *login credential*, compared via `timingEq` in
`admin-login.js:61`, never as a signing key.

### T5 — Owner token is constant, no expiry, no revocation · **CRITICAL**
`auth.js:35` `HMAC(ADMIN_PASSWORD,'archery-admin-v1')` — constant. No `exp`, no `jti`, no
session store. **Steal once = own forever**; only remedy is rotating the password (which T4
makes catastrophic). Compounded: **no rate limit anywhere** in `api/`, `/api/admin/login`
accepts unlimited guesses (`admin-login.js:16` uses plain `===`, though `timingEq` exists in
`auth.js`), and the owner has **no 2FA while staff do** — *the most privileged account is the
least protected*. `/admin.html` is linked from **11 public pages**.
→ **exp+jti, revocation table, rate limit, owner TOTP, unlink from public footers.**

**Status: fixed** — reconciled 2026-08-13, all five sub-claims checked individually: (a) every
signed token bakes in a real `exp` (`auth.js:82`, 12h TTL, checked in `verify()`); revocation is
a `token_valid_after` watermark rather than a literal `jti`, but functionally equivalent —
`revokeStaffSessions` invalidates every previously-issued token on demand. (b) a real, DB-backed
rate limiter (`api/_lib/ratelimit.js`, table `login_attempts`) gates `admin-login.js` before any
password check, fails closed on a DB error. (c) the owner has real TOTP (`admin-login.js:64-78`,
symmetric with the staff path) — no longer staff-only. (d) `grep -rn "admin.html" *.html` across
the whole repo returns zero links from any public page (the sole hit is a code comment). Plain
`===` password compare replaced with `timingEq`.

### T6 — Payment integrity · **HIGH**
- **No webhook exists** (verified: 0 matches in `api/`). The **only** trigger marking an order
  paid is the customer's browser → tunnel closes = money captured, order `pending` forever.
- `/api/razorpay/verify` is **unauthenticated** and sets `payment_status='failed'` on bad
  signature (`razorpay-verify.js:27`) → **anyone guessing an order ID can fail a stranger's
  order.**
- *Credit:* the HMAC check itself is timing-safe and idempotent (`payment_status <> 'paid'`).
  It's correct — it just never runs.
→ **Webhook = source of truth; authenticate verify; reconcile stuck pendings (real money).**

**Status: fixed** — reconciled 2026-08-13. `api/razorpay-webhook.js` is a real webhook: raw-body
HMAC verification (`payments.js`'s `verifyWebhookSignature`) before anything is parsed or
written, idempotent via a unique index on `webhook_events(provider,event_id)`, only ever moves
`pending→paid`/`failed`. `razorpay-verify.js` now requires `verifyCallbackSignature` (HMAC over
`order_id|payment_id` with the key secret) and writes nothing on a bad signature — the old
unauthenticated-fail branch is gone. `markPaid()` checks the captured amount against `orders.total`
before ever fulfilling — server-priced, never client-claimed (§1.6).

### T7 — Unmetered anonymous LLM · **HIGH (financial)**
`/api/coach`: no auth, no rate limit, no spend cap, `claude-opus-4-8` (`coach.js:40`), and
`b.history` client-supplied and trusted (`coach.js:33`) → forged assistant turns = trivial
jailbreak, **on our card**.
→ **ADR-0008.**

**Status: fixed** — reconciled 2026-08-13. `api/_handlers/coach.js` now requires real auth
(`authedUserChecked`, 401 if absent), a per-user + per-IP rate limit, and a real spend cap with a
kill switch (`api/_lib/ai.js`'s `checkBudget`/`recordUsage`, backed by per-user and global 24h
paise sums in `ai_usage`) — matching ADR-0008. The model is read from `ai_config`, not hardcoded
Opus. Conversation history is loaded server-side from `coach_messages` keyed by an
ownership-checked `conversationId`; a client-supplied `history` body field is never read.

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

**Status: fixed for the account-holder path** (migration `027_age_assurance.sql`,
`api/_lib/age.js`, 2026-08-12) — `date_of_birth` is now **mandatory** on every
`/api/users/register` call (`api/_handlers/users-action.js`); a minor cannot register without a
real, distinct `parentEmail`. Consent is *verifiable*, not a checkbox: a single-use
`crypto.randomBytes(24)` token is emailed **only to the parent**, landing on a standalone
`parental-consent.html` that requires an explicit grant/deny — never something the child (or a
checkbox on their behalf) can satisfy. Until granted, `requireConsentedMember()`
(`api/_handlers/members.js`) blocks `become-athlete`, `become-coach`, `coach-link` accept,
`request-certification` with 403 — but never blocks *declining* a link or `revoke-coach-link`,
so a minor can always reduce exposure without a parent. `isAthleteConsentBlocked()`
(`api/_lib/member-capability.js`) closes the gap the CRUD/scoring paths would otherwise leave:
it checks the **athlete's own** `date_of_birth`/`parent_consent_status`, so `api/_handlers/
scoring.js`'s `entries` action refuses to enter a non-consented minor **even when a staff token
initiates it** — DPDP governs whose data is processed, not who clicks the button. `reco.js`'s
`trackView`/`trackSearch`/`trackCategory`/`trackAddToCart`/`trackWish`/`markSession` are all
early-return no-ops for a signed-in minor regardless of consent status (profiling is never
consent-unlockable per s.9(3)); `forYou`/`recentlyViewed`/`trending` fall back to
non-personalised results. (Fixed a real pre-existing gap while doing this: `shop.html` and
`product.html` loaded `reco.js` without ever loading `auth.js`, so the minor check could not
have run at all — both now load `auth.js` first.) A non-consented minor's `profiles` row is
excluded from `/api/profiles` (list + direct-by-id) and `/api/search`
(`filterUnconsentedMinorProfiles` in `api/_lib/crud.js`, `NOT_UNCONSENTED_MINOR` in
`api/_handlers/search.js`) — public discoverability is itself exposure, so this is **not**
staff-overridable the way the active/inactive toggle is. Pre-existing accounts with no
`date_of_birth` are treated as **unknown**, never assumed adult (`isMinor()` returns `null`,
not `false`) — nothing is fabricated to make old rows look compliant.
Verified end-to-end against the local dev stack: `age-assurance-test.js` (21 API-level
assertions — DOB validation, parent-email requirement, token grant/deny/already-answered,
every gated action blocked-then-unblocked, staff-cannot-bypass-consent on tournament entry,
profile/search visibility) and `age-assurance-ui-test.js` (signup.html field reveal, reco.js
tracking gate, adult-visitor sanity check) both green; full 34-file regression suite re-run
clean after updating the three pre-existing tests (`flow-test.js`, `security-test.js`,
`coach-test.js`) that registered accounts without a DOB.
**Status: also fixed for the registration path** (migration `037_registration_age_assurance.sql`,
2026-08-13) — the gap this file itself flagged above is closed. `tournaments.html`'s standalone
`registrations.dob` field is arguably the bigger surface than account signup: it's public,
unauthenticated, and is the platform's primary point of collecting a real child's PII (most
competitive entries are U15/U18/U21). `api/_lib/inbox.js`'s `inboxCreate` now runs the same
`validateDob()`/`isMinor()` machinery as account registration before ever inserting a row; a
minor registration requires a real, valid `parentEmail` or is rejected outright. Consent is the
same *verifiable* standard — a single-use token mailed only to the parent, resolved on
`parental-consent.html?type=registration` (extended to branch between the account and
registration flows rather than forking a second copy of the same page), not a checkbox on the
submitter's behalf. A minor's registration starts in a new `pending_consent` status, structurally
outside the normal staff review queue; `inboxItem`'s `PUT` handler refuses (409) to move it to
`approved` while `parent_consent_status='pending'` **regardless of what an admin session
tries** — capability enforced centrally (CLAUDE.md §4), not left to the admin UI to remember not
to offer. A denial auto-rejects the registration; DPDP s.9(3) leaves no lawful partial-processing
state to fall back to. Fixed alongside this: `inboxList`/`inboxItem`'s admin-facing `select *`
was leaking the raw `parent_consent_token` — a bearer credential equivalent — to any admin
viewing the registrations list; it's now stripped before the row ever leaves the server, the same
least-privilege standard the emailed-link-only design already implied.
Verified end-to-end against the local dev stack: 27 API-level assertions (adult path unchanged,
minor-without-parent-email rejected, garbage DOB rejected, minor-with-consent flow, admin listing
shows status but never the token, staff blocked from approving pending-consent, wrong-token
rejected, grant flow, single-use token enforcement, staff can approve once granted, deny
auto-rejects) plus two CDP UI passes (`tournaments.html`'s minor-DOB field toggle and blocked/
successful submission; `parental-consent.html?type=registration` rendering real data and a real
grant click flipping the DB) — all green. Full regression suite (`age-assurance-test.js`,
`flow-test.js`, `admin-test.js`, `admin-test2.js`, `security-test.js`) re-run clean, confirming
the shared `safeOrigin()` extraction (moved from `users-action.js` into `api/_lib/origin.js` so
both consent flows use one origin allow-list, not two that could drift) didn't regress the
existing account-consent path.
**2026-08-13: the residual UX gap above is closed.** `dashboard.html` now renders an "Account
Status" card, shown only for a minor account, explaining a pending parent/guardian email, a
granted "full access" confirmation, or an honest denial citing the DPDP Act — never a bare 403
with no explanation. The no-profiling protection notice is stated unconditionally in every state.
Verified end-to-end (`dashboard-consent-test.js`): a real minor sees the pending explanation,
granting consent via the real `parental-consent.html` flow flips it to granted on reload, a
second minor whose parent denies sees the denial explained, and an adult account shows no card
at all. This was always a UX gap, never a compliance one — the block itself was fully
server-enforced throughout.

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

**Status: fixed** — reconciled 2026-08-13. `api/_lib/audit.js`'s `writeAudit()` inserts into a
real `audit_log` table (actor/action/resource/before/after/ip), never throws into the caller.
66 call sites across 14 handler files; spot-checked `staff.js` (create/update/delete all call it
with real before/after) and `sellers.js` (status_change) directly.

### T12 — Scope confusion (federation / club / seller) · **HIGH**
Roles exist; **scope does not**. A federation officer is an actor *within a federation*; a club
admin within a club; a seller over their own listings. Nothing in the code expresses "this
actor, over this resource". `can(actor, action)` (2 handlers) has no **resource** argument.
→ **`can(actor, action, resource)`. Scope is the boundary.**

**Status: still open** — reconciled 2026-08-13, confirmed by re-reading the code, not assuming
the fix landed just because several sessions' worth of features shipped since this was written.
`api/_lib/auth.js`'s `can(actor, action)` signature is **unchanged** — still no resource/scope
argument; all 9 call sites (`crud.js`, `staff.js`, `orders.js`, `orders-id.js`, `mail.js`,
`audit-log.js`, `order-invoice.js`, `razorpay-reconcile.js`) pass only a role/action pair, never
a resource id. What exists instead is a pile of **one-off, hand-rolled point functions** — each
specific to one relationship, not the general pattern this threat calls for:
`isOwnAthlete`/`isActiveCoach`/`canActForAthlete`/`isAssignedCertifiedOfficial`/`isClubAdmin`/
`isCoachOfClub`/`requireScorerForMatchEntry`/`requireScorerForEnd` (all in
`api/_lib/member-capability.js`) plus `federation.js`'s `hasJurisdiction`. No shared abstraction;
no generic mechanism a new resource type (e.g. a seller's own listings — `sellers.js` is still
admin-only, no owner-scoped capability exists for it at all) could plug into without writing yet
another bespoke function. **Genuinely still the open, general architectural gap T12 describes** —
mitigated only for the four specific relationships (club/coach/federation/athlete) that happen to
have point solutions today.

### T13 — Offline sync integrity (future, ADR-0006) · **HIGH**
When scoring goes offline: a malicious/buggy device could replay, reorder, or forge arrows.
→ **Idempotent event IDs, causal ordering, judge-adjudicated conflicts, append-only (ADR-0007).
Test adversarially: partition, dupe, reorder, clock skew, two devices one target.**

**Status: fixed (2026-08-12).** Idempotent event IDs already existed (`client_id`); everything
else here did not. Fixed while building this, not by design: migration 021's
`unique(match_entry_id, end_number, shootoff_sequence)` never actually enforced anything for a
regular end — NULL `shootoff_sequence` made every one "distinct" — so a resubmission under a
fresh `client_id` silently inserted a second `ends` row, and `computeMatchState` would have
summed both. Migration `029_ends_uniqueness_fix.sql` replaces it with two correct partial unique
indexes. **Reorder** doesn't need a causal-ordering mechanism beyond what already exists: each
end carries its own `end_number`, and score computation sums by end regardless of insert order,
so out-of-order delivery is a non-issue by construction, not by added machinery — noted here
rather than building unneeded complexity. **Two devices, one target**: `scoring_conflicts`
(migration 028) + `api/_handlers/scoring.js`'s `end` action now refuse (409) a genuine
disagreement instead of silently accepting it, and log it for a judge — `conflicts`/
`resolve-conflict` actions, resolution via the same append-only arrow-supersede path
`correct-arrow` uses (ADR-0007, previously schema-only with no write path). **Dupe** — already
covered by `client_id` idempotency, now also covers the case where the DUPLICATE arrives via a
different `client_id` (benign resubmission, same values → treated as idempotent, not a
conflict). Adversarial tests actually run: `scoring-conflicts-test.js` (27 assertions — benign
dupe, genuine conflict, all 3 resolutions, standalone correction, audit trail),
`offline-queue-test.js` (15 assertions — real network blocking via CDP, IndexedDB persistence
across a reload, auto-resync), `conflict-ui-test.js` (9 assertions). **Not covered**: forged
arrows from a compromised client are out of scope here — `requireScorerForMatchEntry` (auth) is
the control for that, not this fix. Full detail: `docs/PLAN.md` 2.2.

### T14 — Polymorphic analytics column · **MEDIUM**
`analytics_events.value` holds **product IDs and rupee totals**; `crud.js:46` casts
`value::bigint`. One bad row = 500 on trending. → **ADR-0004.**

**Status: the described crash does not reproduce, but hardened anyway (2026-08-13).**
Reconciled by actually attempting the exploit against the local dev stack, not just tracing
code: `analytics_events.value` is `numeric(10,2)` (schema.sql), which already rejects a
non-numeric string at INSERT — a `POST /api/analytics {type:'product_view', value:'garbage'}`
returns `{ok:true}` (the write path's own try/catch swallows the DB type error) but **no row is
ever persisted** — confirmed by querying the table directly after the attempt. So the originally-
feared "one bad row crashes the trending `::bigint` cast" was never actually reachable through
the public endpoint, and the semantic-polymorphism concern (money amounts, pageview counts, and
product ids sharing one column) remains a real design smell but not a live crash vector.
Hardened regardless, since relying on a column type never changing is fragile: `api/_handlers/
analytics.js`'s public POST now validates `type` against a real allow-list (matching every event
type actually emitted by `reco.js`/`shared.js`) and requires `value`, when present, to be a
finite, non-negative number, rejecting both at the boundary (400) rather than depending on the
column type to fail safely. Verified: `analytics-hardening-test.js` — real event types still
accepted, an unknown type/non-numeric/negative/non-finite value all rejected, zero
out-of-allowlist rows exist in the table.

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
