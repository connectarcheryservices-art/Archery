# ADR-0006 — Offline-first scoring is an architectural requirement, not a feature.

**Status:** Accepted · **Date:** 2026-07-13

## Context

Indian ranges have poor connectivity. Scoring happens outdoors, on cheap Android phones, in
sun, sometimes with gloves, often with no usable network for an entire session.

A scoring client that assumes the network is a scoring client that loses a competition's data.
This cannot be retrofitted: offline-first dictates the data model (event-sourced, client-
generated IDs, causal ordering), the API shape (idempotent batch sync, not RPC-per-arrow), and
the UI (optimistic, queue-visible, conflict-aware). Bolting it on later means rewriting all three.

The existing PWA/service worker caches *pages*. That is not offline scoring; it is offline
reading. They are unrelated problems.

## Decision

**Design the scoring client around offline from line one.**

1. Arrow entries are **append-only events** with **client-generated IDs** (UUIDv7 or ULID —
   sortable, collision-free without coordination).
2. Causal ordering via **vector clocks or equivalent** (Lamport timestamps + device ID is
   acceptable if justified in the sync doc).
3. The client **queues locally** (IndexedDB) and syncs when able. The queue is visible to the
   user — a scorer must be able to see "12 arrows pending".
4. **The server reconciles; it never overwrites blind.** Sync is idempotent: replaying the same
   event ID is a no-op, not a duplicate arrow.
5. Conflicts are **surfaced to a judge**, not auto-resolved by timestamp. Two devices claiming
   different values for the same arrow is a *human* decision with an audit trail (ADR-0007).
6. The sync endpoint accepts **batches** and is safe to retry indefinitely.

## Consequences

- The domain model must be event-shaped (`docs/DOMAIN.md`): arrows are facts, not rows to UPDATE.
- Server-generated sequential IDs cannot be the primary key for arrows. Accepted.
- Sync/conflict logic is genuinely hard and must be **tested adversarially** (partition, dupe,
  reorder, clock skew, two devices, one target). This is in the "tests before merge" set.
- The UI must be designed for gloves and sun: ≥48px targets, high contrast, one-hand entry.
- Payoff: the platform works where the sport actually happens, which is the whole moat.
