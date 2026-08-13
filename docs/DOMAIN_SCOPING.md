# DOMAIN_SCOPING.md — every "actor, over this resource" check, in one place

This exists because of THREAT_MODEL.md T12: "Roles exist; scope does not... nothing in the
code expresses 'this actor, over this resource'." That's still mostly true in the sense that
there's no single generic mechanism — but it's not true that scoping doesn't exist. It exists as
a genuinely large, still-growing set of hand-written, per-resource-type functions, scattered
across several files, each discovered independently by whoever built that feature. This file is
the index that should have existed from the first one. **If you're adding a new resource type
that needs "only the owner/admin/coach of X can touch this row" — read this file first.** Copy
the shape of the closest existing entry rather than inventing a new one.

This is a reference, not a redesign. Nothing listed here changed behavior when this file was
written (2026-08-13) — it's a catalogue of what's already real and already tested.

---

## Staff (employees) — `api/_lib/auth.js`

Global, not resource-scoped: `can(actor, action)` answers "does this STAFF ROLE have this
CAPABILITY at all" (`content`, `orders`, `approvals`, `chat`, `manage_staff`, `settings`) —
never "over which specific row." That's correct for these actions: an editor who can touch
content can touch *any* content row: there's no per-product ownership among staff. Don't add a
resource parameter here; it would be surface area with no real check behind it. `checkAdmin(req)`
re-reads role from the `staff`/`owner_security` tables on every request (§1.4) — never trust a
token payload's role claim.

## Platform members (archers/coaches/officials) — `api/_lib/member-capability.js`

| Function | Scopes | Real question it answers |
|---|---|---|
| `isOwnAthlete(userId, athleteId)` | one athlete | is this user the athlete themself (`athletes.user_id`)? |
| `isActiveCoach(coachUserId, athleteId)` | one athlete | an ACTIVE, mutually-consented coach link (`coach_athletes.status='active'`) — never pending/revoked |
| `canActForAthlete(userId, athleteId)` | one athlete | self OR active coach — the actual "can register/edit this athlete" gate |
| `isAthleteConsentBlocked(athleteId)` | one athlete | is the underlying account a confirmed minor with no parental consent? (§1.8/DPDP — blocks regardless of who's asking, even staff) |
| `isAssignedCertifiedOfficial(userId, eventId)` | one event | approved certification AND actually assigned to THIS event (`event_officials`) — both conditions independently required |
| `requireScorerForMatchEntry(req, matchEntryId)` | one match_entry | staff (owner/manager, free pass) OR an official assigned to the event that match_entry belongs to (walks `match_entries → matches → event_categories`) |
| `requireScorerForEnd(req, endId)` | one end | same as above, one hop further (`ends → match_entries → matches → event_categories`) |
| `isClubAdmin(userId, clubId)` | one club | active `member_role='admin'` row in `club_members` for THIS club — not global |
| `isCoachOfClub(userId, clubId)` | one club | active `member_role='coach'` row — deliberately narrower than admin (can run sessions/attendance, not approve joins) |

## Federation hierarchy — `api/_lib/federation-lib.js`

Extracted 2026-08-13 from `federation.js`, where `hasJurisdiction` used to be duplicated —
a security-critical tree-walk belongs in one place.

| Function | Scopes | Real question it answers |
|---|---|---|
| `hasJurisdiction(userId, federationId, offices=null)` | one federation node + every ancestor | does this user hold `offices` (or any office) at `federationId` itself OR at any node above it in the tree? A national officer has jurisdiction over every state/district beneath them. |
| `isFederationOfficerOrAncestor(userId, federationId)` | same | any office at all — sufficient to create a child node, NOT sufficient to appoint officers |
| `isPresidentOrAncestor(userId, federationId)` | same | president rank specifically — the governance-decision gate (appointing officers). A lesser office was previously enough to self-promote to president; fixed, see federation.js's own comment. |
| `federationDescendantIds(federationId)` | subtree | every federation id AT OR BELOW this node (recursive CTE, not a JS loop — this fans out, unlike the single-chain functions above) |
| `clubIdsUnderFederation(federationId)` | subtree | every club whose `federation_id` resolves at-or-under this node — the building block for federation-roster.js and rankings.js's federation-scoped leaderboard |

## Sellers — inline in `api/_handlers/my-profile.js` (`sub==='products'`)

Not a named exported function — an inline ownership check inside the handler. Listed here
specifically because THREAT_MODEL.md T12 once claimed (wrongly — corrected 2026-08-13) that no
such thing existed. The pattern: `seller_id` is stamped from the authenticated caller's own id on
create (never read from the client body — a spoofed `sellerId` in the request is silently
ignored), and every PUT/DELETE requires `select 1 from products where id=$1 and seller_id=$2`
before proceeding, gated to `seller_status='approved'`. Tested: `test/seller-scope.test.js`.

## Verified purchases — inline in `api/_handlers/reviews.js`

`findVerifyingOrder(email, productId)`: a real query — a PAID order whose `customer_email`
matches the reviewer's own account email (orders are guest-checkout, no `user_id` link, so this
IS the verification) AND whose `items` JSONB actually contains this product. Computed at write
time, every time; never trusted from a client-supplied order number alone. Tested:
`test/reviews`-equivalent coverage lives in the manual local-dev-stack pass documented in
PLAN.md's 2026-08-13 entries (not yet a `stubDb` regression test — a real gap, listed honestly
rather than implied covered).

## Orders (guest checkout, no user_id) — `api/_handlers/order-invoice.js`, `api/_handlers/returns.js`

Both use the SAME pattern: `orders.order_no` (high-entropy, minted at checkout) as a
possession-based bearer credential, since there's no account to check ownership against for a
guest checkout. `order-invoice.js`: `?on=<order_no>` must exactly match. `returns.js`: same, for
filing/checking a return request. Both return the SAME response (403/404) whether the order
doesn't exist or the credential is merely wrong — no enumeration signal either way.

---

## The actual gap, honestly stated

None of the above shares a common function signature, error-handling convention, or even a
common file. **Adding a new resource type still means writing a new function** — this file makes
that function easier to find and copy the shape of, not unnecessary to write. A genuine `can
(actor, action, resource)` generic mechanism (looking up a scope-check by resource type from a
registry, e.g. `SCOPES[resourceType].check(actor, resourceId)`) was considered and deliberately
NOT built 2026-08-13: every existing check above has a different actor shape, a different
resolution path (some walk a tree, some join through 2-3 tables, some are a flat existence
check), and forcing them into one dispatch function would add a layer of indirection without
actually reducing the risk this file is trying to reduce — someone still has to write the real
query for the new resource type either way. What WOULD help, and is out of scope for this pass:
a lint rule or code-review checklist item that says "does this new resource type need an entry
in DOMAIN_SCOPING.md" — a process fix, not a code fix.
