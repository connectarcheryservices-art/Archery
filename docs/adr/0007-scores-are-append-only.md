# ADR-0007 — Scores are append-only. Corrections are events.

**Status:** Accepted · **Date:** 2026-07-13

## Context

A tournament result is a legal artifact. It is protested, appealed, and used to select national
teams. "The row says 9" is not a defence; "arrow 3 of end 4 was recorded 10 by scorer A at
14:02, corrected to 9 by judge B at 14:06 with reason *line-cutter re-inspected*, per Art. 12.2"
is a defence.

Today there is no scores table at all (verified: the only occurrence of "arrow" in the schema is
a **product name**). So this ADR is written before the mistake, not after it — which is the only
time it's cheap.

An in-place `UPDATE` on an arrow destroys the evidence that a protest needs, and makes the
offline sync problem (ADR-0006) unsolvable: last-write-wins silently eats a judge's decision.

## Decision

1. **An arrow is never updated in place.** `arrows` is append-only.
2. A **correction is a new event** referencing the original, carrying:
   - `reason` (free text, required)
   - `actor` (who — judge, scorer, athlete's agent)
   - `authority` (the rule invoked, e.g. Art. 12.2 line-cutter)
   - timestamp
3. The current value of an arrow is a **projection** (latest non-superseded event), not a column
   someone mutates.
4. A judge's decision is **auditable, reversible, and attributable**. Reversal is another event.
5. This composes with ADR-0006: sync replays events; superseding is explicit and causal.

## Consequences

- Reads go through a projection/view. Slightly more query complexity; index it.
- Storage grows with corrections. Irrelevant at archery's data volume.
- **This is what survives a protest**, and it is a saleable feature to federations — the audit
  trail *is* the product for a system of record.
- The same discipline extends to any adjudicated fact (equipment inspection, DQ, TUE decision).
- Hard deletes of arrows are forbidden. Soft-delete/supersede only.
