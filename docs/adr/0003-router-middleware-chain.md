# ADR-0003 — Keep the single-function router; put a middleware chain in front of it.

**Status:** Accepted · **Date:** 2026-07-13

## Context

`api/_lib/router.js` dispatches the whole `/api/*` surface from ~3 function files. This is a
**legitimate** response to the Vercel Hobby 12-function limit and should be kept — it is one of
the few load-bearing decisions in this repo that was made for a real reason.

But it is a hand-rolled if-chain with two structural problems:

1. **Cross-cutting concerns are per-handler, therefore forgotten.** Verified: `can()` is called
   in **2 of 24** handlers (`mail.js`, `staff.js`). The other 22 rely on `checkAdmin()`, which
   answers only *"is some admin logged in"*. There is **no rate limiting anywhere** in `api/`.
   There is **no audit log**. Nothing structural prevents the next handler from forgetting all
   three.
2. **Unmatched routes silently 404.** A typo in a route string is indistinguishable from a
   missing feature.

Security controls that must be remembered are security controls that will be forgotten. This is
not a discipline problem; it is an architecture problem.

## Decision

Keep the single-function router. Put a **middleware chain** in front of every request:

```
requestId → rateLimit → auth → capability → validate → handler → audit → errorEnvelope
```

- **Default deny.** A handler that declares no capability is unreachable, not public.
- Handlers become pure: `(ctx) => result`. They do not read headers, parse bodies, or check auth.
- **Unmatched routes are loud in dev** (throw/log), 404 in prod.
- Every mutation emits an audit row from the chain, not from handler goodwill (ADR + CLAUDE §1.5).
- The error envelope is uniform: no stack traces or driver errors to clients.

## Consequences

- Every handler is refactored once to the `(ctx)` shape. Mechanical but touches all 24.
- Adding a capability check becomes declarative and reviewable in one place.
- Rate limiting needs shared state across serverless invocations — use Postgres or an
  edge/KV store. Do **not** use in-memory counters; they are per-instance and therefore fiction.
- Audit becomes automatic and complete, which is what makes it saleable to federations.
