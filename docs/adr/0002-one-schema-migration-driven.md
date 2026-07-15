# ADR-0002 — One schema, migration-driven.

**Status:** Accepted · **Date:** 2026-07-13

## Context

Two schema files exist and disagree. Verified:

| File | Indexes | Foreign keys |
|---|---|---|
| `schema.sql` (root) | **0** | **0** |
| `supabase/schema.sql` | 4 | 1 |

Plus `supabase/migrations/` (002 indexes/FTS/constraints, 003 media columns, 006 accounts/roles)
which were applied to the live database out-of-band.

**Nobody can say which schema is deployed** by reading the repo. The live DB currently matches
neither file exactly — it is `supabase/schema.sql` *plus* migrations applied by hand. A schema
you cannot derive from the repo is not a schema; it is folklore.

Zero foreign keys on a system of record means orphaned rows are not merely possible, they are
guaranteed — and there is no audit trail to reconstruct what happened.

## Decision

1. **Delete the root `schema.sql`.**
2. **`supabase/migrations/` is the only source of truth.** Forward-only, ordered, each
   migration reviewed and reversible-by-design (a documented down-path, even if not automated).
3. `supabase/schema.sql` becomes a **generated artifact** (a dump for reading), never
   hand-edited, or is deleted too. It must never be a second place to make a change.
4. Add the missing **indexes and foreign keys**. Every FK that expresses a real constraint gets
   declared, with an explicit `ON DELETE` policy chosen deliberately (soft-delete per ADR-0007
   means `RESTRICT`/`SET NULL` will usually be right, not `CASCADE`).
5. Baseline migration `0001` reflects current production reality so the chain is replayable
   from empty.

## Consequences

- One command reproduces the database from zero. CI can spin an ephemeral DB and run tests
  against real DDL.
- Schema review happens in PRs, where it belongs.
- Cost: the existing hand-applied state must be reconciled into a baseline migration once,
  carefully, against the live DB. Do not skip this — a wrong baseline is worse than none.
