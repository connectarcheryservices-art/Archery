# ADR-0008 — AI is a thin, metered, authenticated layer over our own data.

**Status:** Accepted · **Date:** 2026-07-13

## Context

`/api/coach` is, verified, an unmetered LLM billed to us:

- **No authentication.** Anyone on the internet can call it.
- **No rate limit.** (There is no rate limiting anywhere in `api/`.)
- **No spend cap.**
- **Model: `claude-opus-4-8`** (`coach.js:40`) — the most expensive option, for a chat widget.
- **`b.history` is client-supplied and trusted** (`coach.js:33`). The "conversation" is whatever
  the caller says it is, so an attacker can forge assistant turns and trivially jailbreak or
  redirect the model — while we pay for it.

This is a CFO problem and a CISO problem simultaneously: an anonymous, uncapped, forgeable,
Opus-priced endpoint on our card.

Separately: it is not "AI" in any sense that matters. It has no access to the athlete's arrows —
because there are no arrows (`docs/DOMAIN.md`). It is a chat box next to a knowledge base.

## Decision

**No LLM call without all of the following:**

1. **An authenticated user.** No anonymous inference.
2. **A rate limit** (per user and per IP), enforced in the middleware chain (ADR-0003).
3. **A spend cap** — per user, per day, and a global kill-switch. Track cost per call.
4. **A model chosen by task.** **Default Sonnet.** Opus only where *measurably* better, proven
   by evals, and documented.
5. **Server-held conversation state.** Client-supplied history is **never** trusted. The client
   sends a conversation ID and a message; the server owns the transcript.
6. **Streaming**, so long answers don't hit request timeouts.

And, per CLAUDE.md §1.8: **under-18 users get no behavioural profiling and no engagement
optimisation.** Coaching content is fine; profiling is not — regardless of consent.

The AI only earns the name in Phase 5, when it can cite the rulebook (RAG with citations) and
reason over *that athlete's actual arrow history*. A coach answer that cites Art. 12.5.1 beats a
fluent one that doesn't.

## Consequences

- The chat widget requires sign-in. Accepted: unmetered anonymous inference is not a feature.
- Conversation storage is now ours (a table), which is also what makes coaching context possible.
- An **eval set gates prompt changes** (Phase 5). You cannot improve what you cannot measure;
  golden questions reviewed by a real coach, run in CI.
- Cost becomes observable per user — a prerequisite for pricing it.
