# DOMAIN.md — The archery model

**Audience:** engineers building this, and the federation technical delegate who will review it
before signing off (Phase 2 gate).

**Sources — primary, fetched, not remembered:**
- **World Archery Rulebook, Book 3 — Target Archery**, version **2026-01-27**
  ([extranet PDF](https://extranet.worldarchery.sport/documents/index.php/Rules/Rule_Book_versions/2026-01-27/EN-Book_3_-_2026-01-27_Version.pdf))
- **World Ranking Calculation System**
  ([extranet PDF](https://extranet.worldarchery.sport/documents/index.php/Statistics/World_Ranking_Calculation_System.pdf)),
  and the ranking overhaul effective October 2022
  ([announcement](https://www.worldarchery.sport/news/200934/world-ranking-include-indoor-and-field-events-october-2022))
- Rulebook index: <https://www.worldarchery.sport/rulebook>

> **Rule of engagement:** every rule below cites an article. If you need a rule that is not
> here, **fetch the rulebook** — do not infer it, and do not trust this document over the
> primary source. If they disagree, the rulebook wins and you fix this file.
>
> **Book 4 (Field & 3D)** is **not yet incorporated** — field divisions below are named but their
> rules are UNVERIFIED here and must be sourced before implementation.
>
> **The Para classification manual (Book 5.1, Version 2026-01-27) was fetched and read
> 2026-08-12** — see §5 for the sourced class/status model. This corrected two errors this
> document previously asserted unverified ("W1/Open/VI1/VI2/VI3" — wrong; real codes are
> PI1/PI2/VI1/VI2). The detailed medical/functional assessment methodology (who qualifies for
> which class) remains unimplemented by design — a real panel does that, not this platform.

---

## 1. The core insight

**Store arrows, not scores.**

A score is a `SUM`. A personal best is a query. A ranking is a computation. A tiebreak is
`ORDER BY value DESC, is_x DESC`. Coaching analytics is a `GROUP BY`. Live results are a view.

Every feature the business wants is a **view over arrow-level data** — and nobody can copy it,
because they didn't collect the arrows.

**Current state: there is no scores table.** Verified — the only occurrence of the word "arrow"
in the schema is a *product name* ("Aluminium Arrow Set"). The sport is absent. This document
is the fix.

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Arrow** | One shot. Value 0–10, `is_x` (inner 10), `is_miss`. The atomic unit. |
| **End** | A group of arrows scored together (3 or 6). Scoring happens after each end/set (**Art. 12.1.2**). |
| **Set** | An end in a set-play match, worth **set points**. |
| **Division** | recurve · compound · barebow (+ field divisions). |
| **Age class** | U15 · U18 (cadet) · U21 (junior) · senior · 50+ (master). |
| **Para class** | PI1 · PI2 (physical) · VI1 · VI2 (vision). Corrected 2026-08-12 — see §5. |
| **Category** | division × gender × age_class × para_class — **the real competitive unit**. |
| **Qualification** | The ranking round. Seeds the elimination bracket. |
| **Elimination** | Bracket matches (1v64, 2v63 …), seeded **from qualification**. |

---

## 3. Scoring — Book 3, Chapter 12

### 3.1 Arrow value (**Art. 12.2**)
> "An arrow will be scored according to the position of the **shaft** in the target face. If the
> shaft of an arrow touches two colours or any dividing lines between two scoring zones, that
> arrow will score **the higher value** of the two zones involved."

- Line-cutter → **higher** value. This is why an arrow's value is an **adjudicated fact**, not a
  sensor reading — and why corrections must be events with a reason (ADR-0007).
- **Art. 12.1.2** — scoring takes place **after each end/set**.
- **Art. 12.1.3** — values recorded in **descending order**, called by the athlete; disagreement
  → the assigned **judge makes the final decision**. (Model the judge as the actor on the
  correction event.)
- **Art. 12.2.2** — if more than the required arrows are found, only the **lowest** in value
  score. (A scoring client must let a judge apply this; it is not a client-side auto-rule.)
- **Art. 12.1.1** — two scorecards per target; if an electronic and a paper card disagree, **the
  paper card takes precedence**. Our client is *a* scorecard, not *the* authority.

### 3.2 X
**X = inner 10.** Store `is_x` on the arrow. Used for tie resolution **at long distances only**
(§3.4). `is_x` implies value = 10 — enforce in the schema (ADR-0004).

### 3.3 Match formats — **they differ by division (Art. 12.1.4)**
> "**Recurve and Barebow will score using the set system, and Compound will be scored using a
> cumulative score.**"

**Individual set-play (Art. 12.1.4.1)**
- Highest score in the set → **2 set points**. Tied set → **1 set point each**.
- **First to 6 set points wins.**

**Team / Mixed team set-play (Art. 12.1.4.2)**
- Highest score in the set → **2 set points**. Tied → **1 each**.
- **First to 5 set points wins.**

**Individual cumulative — compound (Art. 12.1.4.3)**
- Totals recorded each end. After **5 ends**, highest total wins.

**Team cumulative — compound (Art. 12.1.4.4)**
- After **4 ends**, highest total wins.

> A single `match` table with one format is wrong. Format is a function of **division × team
> type**, and it changes the win condition, the number of ends, and the tiebreak.

### 3.4 Ties — **the rule the prime directive turns on**

**⚠️ Correction to the build directive.** §6 of the directive states the tiebreak order as
"score → X-count → 10-count → shoot-off". The primary source is **more specific**: the order
depends on **distance** *and* **context**.

**General ranking ties (Art. 12.5.1)** — "Except for those ties as set out in Article 12.5.2":
- **Long distances:** greatest number of **Xs (inner 10s)** → if still tied, greatest number of
  **10s**.
- **Short distances:** greatest number of **10s** → if still tied, greatest number of **9s**.
  *(Note: at short distance the tiebreak is 10s then 9s — **X is not used**.)*
- Still tied → **declared equal**; for position in the match play chart, a **disk toss** decides.

**Elimination-entry and match ties (Art. 12.5.2)**
> "there will be **shoot-offs** to break the ties. **The system of Xs/10s and 10s/9s will not be
> used.**"
- Broken on the **distance shot last**, once qualification results are official (**Art. 12.5.2.1**).

**Shoot-off, individuals (Art. 12.5.2.2)**
> "A **single arrow shoot-off for score**. If the score is the same, the arrow **closest to the
> centre** of the target face will resolve the tie. If the distance is the same, **successive
> single arrow shoot-offs** will be conducted until the tie is resolved. If both athletes miss
> the scoring area of the target, both athletes will shoot an additional arrow."

**Shoot-off, teams (Art. 12.5.2.3)** — three-arrow (two for Mixed Team) shoot-off for score, a
single arrow by each team member.

**Implications for the schema — this is *the* reason for arrow-level storage:**
1. `is_x` **and** the ring value must both be stored per arrow. A `total` column cannot resolve
   a tie.
2. Tiebreak logic **branches on distance band** (long vs short) and **context** (ranking vs
   elimination-entry/match). One `ORDER BY` is not enough.
3. **Closest-to-centre** requires arrow **coordinates** (`x_y`) or an explicit judged
   measurement event. Without one of these, Art. 12.5.2.2 is unimplementable — decide which,
   and record it as an adjudicated fact (ADR-0007). *Do not fake a distance.*
4. "Successive single arrow shoot-offs" → a shoot-off is an **ordered sequence of ends**, not a
   single row.

> **The 8–8 case (prime directive):** 8–8 in set points is not a "score tie" — under
> Art. 12.1.4.1 a set-play match is won at 6 set points, so 8–8 cannot arise in an individual
> recurve match; the tie state is **5–5**, resolved by shoot-off (Art. 12.5.2.2). An 8–8 *arrow
> score* tie within a set awards **1 set point each**. Model both, and never conflate arrow
> score with set score. If the CEO's "8–8" means a compound cumulative tie, it resolves by
> shoot-off too. **Ask which; do not guess.**

### 3.5 Order of shooting (**Art. 11.1.4.1**)
- Higher-placed athlete from qualification chooses order in the first end/set.
- Thereafter the athlete with the **lower set-point score** (recurve/barebow) or **lower
  cumulative score** (compound) shoots first.
- If tied, whoever shot first in the first end/set shoots first (also in the shoot-off).

*(Another place where division changes behaviour.)*

### 3.6 Timing (**Art. 11.2.1.1**, World Ranking Events)
- **20 s/arrow** — individual alternate shooting, all team/mixed rounds, incl. shoot-offs.
- **30 s/arrow** — individual qualification and match rounds without alternate shooting.
- Other events (**Art. 11.2.1.2**): 20 s alternate; 40 s individual non-alternate (organisers may
  reduce to 30 s by stating so in the invitation).

---

## 4. Rankings — verified

`ranking_score = base_points × position_% × period_multiplier`

- **Best 7 results**: **4 outdoor + 2 indoor + 1 field** (individual, able-bodied).
- **24-month validity**, decaying to **75%** after 12 months, **50%** after 16, **25%** after 20.
- **Five event groups** define maximum points; the top group (Olympics, Paralympics, World
  Archery Championships, World Archery Para Championships) is worth **100 points to the winner**.
- Archers receive a **fixed percentage** of points by final position.
- Published **weekly**.
- Indoor and field events count **since October 2022**.

**Rules for us:**
- **Never rank two divisions in one list.** WA maintains ~18 separate lists.
- **PB is not a rank.** Delete `query.js:14` → `athletes: { rank: 'pb desc nulls last' }`. It is
  wrong twice over: (a) compound routinely shoots 700+/720 while world-class recurve is ~680, so
  compound outranks recurve **permanently, by construction**; (b) "PB" in *what*? 70m/720,
  50m compound, 18m indoor and barebow are **incomparable scales** in one column.
- A ranking is **computed and published**, never typed.
- *Para ranking uses a separate calculation document — fetch it before implementing.*

---

## 5. Divisions, categories, para

- **Category = division × gender × age_class × para_class.** This is the unit for entries,
  results, brackets and rankings. Free-text `discipline` (current state) cannot express it.
- **Para is classification-first.** PI1 / PI2 (physical impairment) and VI1 / VI2 (vision
  impairment) are the **competitive structure**, not a badge on a profile — a real classification
  panel decides, the platform only records the outcome (migration
  `030_para_classification.sql`, `api/_handlers/members.js` `request-classification` /
  `approve-classification`). `guard-rail.html` still contains zero occurrences of these terms —
  still a placeholder where a model belongs; the model itself now exists elsewhere (dashboard.html
  / admin.html's Officiating panel), guard-rail.html hasn't been wired to it yet.
- **Corrected 2026-08-12 — this used to say "W1 / Open / VI1 / VI2 / VI3."** Fetched and read the
  actual current primary source (World Archery, *Para Archery Classification Rules and
  Regulations*, Version 2026-01-27 — the same rulebook edition already cited above for Book 3)
  before building anything, per §0's "cite the article, do not infer." Two corrections:
  **there is no VI3** — Appendix 2 §4.1: *"There are two sport classes for Visually Impaired
  athletes: VI1 [worse than LogMAR 2.6] / VI2 [LogMAR 1.0–2.6]"*; and **"W1"/"Open" appear
  nowhere in the classification rules** — the physical-impairment Sport Classes it actually
  defines are **PI1** and **PI2** (Appendix 1 §5.1.1/§5.1.2). "W1"/"Open" may be informal or
  competition-format names from a separate, still-unsourced document — asserting that mapping
  would be inferring, not citing, so this codebase uses the classification rules' own codes.
- VI1 requires a blindfold worn for the full event **and** a mandatory Spotter (Appendix 2 §4.a);
  VI2 has no such requirement (§5.a). Both: no distinction by gender/division within the class —
  all VI athletes of a class shoot together within their division (Appendix 2 §4.2).
- Real classification statuses (Art. 18-19, collapsed for gating purposes in
  `classifications.status`): **Confirmed (C)** — stable, no further review (19.1.1); **Review —
  Next Available Opportunity (R-NAO)** (19.1.2); **Review — Fixed Review Date (R-FRD)**,
  typically ≤4 years out (19.1.3.3); **Expired (E)** — 8 years' non-participation, retirement, or
  a missed fixed review date (19.1.4); Art. 20.3: an Expired athlete **cannot** compete until
  re-evaluated. Only Confirmed/R-NAO/R-FRD gate entry into a matching para category.

---

## 6. Target shape (adapt names, keep the grain)

```
athletes          identity, WA/AAI licence, club, nationality
divisions         recurve | compound | barebow (+ field)
age_classes       U15 | U18 cadet | U21 junior | senior | 50+ master
para_classes      PI1 | PI2 (physical) | VI1 | VI2 (vision)
categories        division × gender × age_class × para_class   ← the real unit

events            name, sanctioning body, wa_ranking_group (1..5), venue, dates
event_categories  event × category, round type, distances, face sizes
entries           athlete × event_category, target assignment, qual rank

sessions          qualification | elimination | final; distance, face_size,
                  ends_count, arrows_per_end, distance_band (long|short)  ← drives Art. 12.5.1
matches           bracket position, format (set|cumulative), participants
ends              session|match, entry, end_number, judge, timestamp
arrows            end, sequence, value 0..10, is_x, is_miss, x_y (optional)
                  ← APPEND-ONLY. corrections are new rows w/ reason + actor (ADR-0007)

ranking_results   athlete, event_category, final_position, base_points,
                  position_pct, period_multiplier, ranking_score
ranking_lists     category, published_at (weekly)
ranking_entries   list, athlete, added_ranking_score (best-7), rank
```

**Constraints to declare:** `value BETWEEN 0 AND 10`; `is_x ⇒ value = 10`;
`is_miss ⇒ value = 0`; arrows-per-end matches the session; an arrow belongs to exactly one end.

---

## 7. Consequences for existing code

| Current | Verdict |
|---|---|
| `query.js:14` `athletes: {rank:'pb desc nulls last'}` | **Delete.** Not a ranking (§4). |
| `athletes` table (name/state/discipline/rank/pb) | Not an athlete model. No category, no licence, no results. Replace per §6. |
| `draw.html` "Draw Generator" | Seeds from nothing. WA seeds **from qualification** (1v64, 2v63). Becomes real only after qualification data exists. |
| `guard-rail.html` (para) | No classification model at all. Para = classification. |
| `tournaments` table | An events/marketing table, not `events` + `event_categories` + `sessions`. |
| "WA-compliant equipment" claim | Not currently found in `shop.html`/`product.html` (grep = 0) — **if re-added, it needs a modelled, cited compliance field or the claim must be dropped.** |
| `fedNumber` free text | Unvalidated against AAI membership. |

---

## 8. Open questions — ask, don't guess

1. **Closest-to-centre (Art. 12.5.2.2):** store arrow coordinates, or a judged measurement
   event? Coordinates need a capture method (target camera / tablet tap / manual). **Decide with
   a judge, not in a commit.**
2. **Ianseo interop** — AAI already runs it. Import/export format? Do not reinvent what the
   federation uses. **Investigate before designing.**
3. **Field & 3D (Book 4)** — not sourced yet.
4. **Para classification** — the class/status model and the request→adjudicate workflow are
   built (2026-08-12, migration 030); the eligible-impairment/minimum-impairment-criteria
   assessment methodology itself (Appendices 1-2's detailed medical/functional test protocols)
   is intentionally NOT implemented — a real classification panel performs that in person; this
   platform only records the outcome. Protests/appeals (Chapter 3) and the 8-year/fixed-date
   auto-expiry (Art. 19.1.4) are not automated — no scheduler exists on this stack.
5. **Which "8–8"** does the prime directive mean — arrow-score tie within a set, or a compound
   cumulative tie? (§3.4.)
