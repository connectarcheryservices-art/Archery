# ADR-0001 — One backend. Delete `local-server.js`.

**Status:** Accepted · **Date:** 2026-07-13

## Context

There are two complete, independent backends:

- `api/**` — the production surface (Vercel serverless behind `api/_lib/router.js`).
- `local-server.js` — **604 lines**, verified: its own `adminToken()`, its own router, its own
  seed data, its own validation, its own analytics aggregation.

Dev/prod parity is broken **by construction**. Every feature must be written twice, and drift
is not detectable by tests (there is one test file). During this repo's own history, the two
implementations have already diverged in seed content, analytics shape, and auth handling.

A parallel implementation is not a dev convenience; it is a second product with no users and
full maintenance cost, and it silently invalidates every local verification.

## Decision

**Delete `local-server.js` entirely.** Development runs the same code as production via
`vercel dev`, against a local or branch Supabase database.

Parity is not negotiable.

## Consequences

- Local dev requires `vercel dev` + a `DATABASE_URL` (branch DB or local Postgres). Slower to
  boot than a bespoke 604-line server. Accepted.
- "Test mode payments" that `local-server.js` faked must be replaced by **Razorpay test keys**
  — which is what a test key is for. This is strictly more honest (see CLAUDE.md §1.1).
- All seed data moves to migrations/fixtures, not a JS object served to users.
- One-time cost: any behaviour only present in `local-server.js` must be ported to `api/**`
  before deletion, or consciously dropped. Inventory it first.
- Verifications done against `local-server.js` in the past must be **re-run against `api/**`**;
  they proved nothing about production.
