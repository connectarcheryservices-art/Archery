# ADR-0005 — Introduce a build step; one design system.

**Status:** Accepted · **Date:** 2026-07-13

## Context

There is no module system. The symptoms are structural, not cosmetic. Verified:

- **`admin.html` is 1,616 lines / ~124KB** with **36 `innerHTML` calls**, all inline, no modules.
- **Multiple copy-pasted `esc()` implementations** across pages, none of them equivalent:
  `tournaments.html:282` escapes only `<`; `community.html:156` turns `0` into `''`; none escape
  `'`. A shared sanitiser cannot exist without a module system, so instead there are several
  subtly-wrong ones — and the one place that matters (`admin.html:982`, product name/brand/
  category) escapes **nothing**.
- The design "system" is ~30 copies of a stylesheet. The identity is inconsistent because there
  is no single place to state it.

You cannot fix the XSS class of bug by fixing 122 call sites by hand. You fix it by having one
sanitiser, one component that renders a table cell, and a CSP that fails the build if you slip.

## Decision

1. **Introduce a build step** — the lightest thing that provides modules, bundling, and a shared
   design system across ~30 pages. (Vite-class; no framework mandate.)
2. **One design system**: tokens, components, one stylesheet. Not thirty copies.
3. **One sanitiser, one escaper**, allow-list based, in a shared module. Delete the rest.
4. **Do not rewrite the frontend into a SPA.** Migrate **page by page, highest-risk first**:
   `admin.html` is first because it holds the privileged session that the XSS targets.
5. **Performance budget enforced in CI.** Per-page budget; the build fails if exceeded.
6. Accessibility (WCAG 2.2 AA) and i18n are build-system concerns from day one, not retrofits —
   para archers are the user base, and "India's platform" implies Hindi + regional languages.
   Retrofitting i18n costs 10× at 300 pages; do it at 30.

## Consequences

- A toolchain now exists where there was none: a real cost, and the only way to stop shipping
  the same bug class forever.
- `admin.html` is decomposed into modules + components. Highest risk, highest payoff, first.
- CSP (Phase 0) becomes enforceable, because inline handlers can be eliminated as pages migrate.
- Migration is incremental: unmigrated pages keep working; no big-bang rewrite.
