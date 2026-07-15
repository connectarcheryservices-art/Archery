# ADR-0004 — Schema-validate every input at the boundary.

**Status:** Accepted · **Date:** 2026-07-13

## Context

Input validation today is ad-hoc, per-handler, and thin. Verified examples:

- Seller-controlled product fields are validated as **"name non-empty, price numeric"** — and
  those strings are then rendered into the owner's admin session via unescaped `innerHTML`
  (`admin.html:982`). Weak validation and an XSS sink compound into account takeover.
- `registrations` collects `dob`, `gender`, `club`, `fedNumber` with the only check being *"a
  name exists"* — no age gate on a youth sport (DPDP s.9 exposure), no format validation,
  `fedNumber` unvalidated free text.
- `analytics_events.value` is **polymorphic** — it holds product IDs *and* rupee totals, and
  `crud.js:46` does `value::bigint`. One row of the wrong kind = a 500.

Hand-rolled validation is not merely inconsistent; it is invisible. You cannot audit what each
endpoint accepts because the answer is scattered across 24 files.

## Decision

1. **One schema library**, applied in the middleware chain (ADR-0003), not in handlers.
2. Every endpoint declares an input schema. **No handler parses `req.body` by hand.**
3. Types are **derived from the schema** — one definition, not a type and a validator that drift.
4. Validation failures return a uniform 400 envelope; they never reach the handler.
5. Domain invariants live in the schema where expressible (arrow value `0..10`, `is_x` only when
   value = 10, pincode shape, GST/HSN format, `dob` present and plausible before an account can
   be created).
6. **Fix `analytics_events.value` polymorphism** — separate typed columns/tables per event kind.
   A column that means two things is a bug with a schedule.

## Consequences

- The set of accepted inputs becomes greppable and reviewable — a prerequisite for the threat
  model to be true rather than aspirational.
- Age assurance (CLAUDE §1.8) has a natural, unavoidable home.
- Cost: one dependency, and a mechanical pass over all endpoints.
- Output escaping is a **separate** control (ADR/CSP + one sanitiser). Validation is not
  escaping; do not conflate them.
