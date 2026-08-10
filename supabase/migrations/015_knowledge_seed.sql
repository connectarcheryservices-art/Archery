-- Archery.Services — migration 015
-- Real knowledge-base articles, and fixes a page/data disconnect: knowledge.html
-- (the public page) was rendering four hardcoded articles baked into its own
-- <script>, completely disconnected from this `knowledge` table — the same
-- table admin.html's Knowledge panel genuinely creates/edits/deletes rows in.
-- An admin adding or editing an article there had zero effect on what a real
-- visitor saw. This migration moves the four real, owner-quality guides that
-- were hardcoded into the page into the real table, and adds one new article
-- (para-archery classification). knowledge.html is updated in the same change
-- to read from /api/knowledge instead of its own static array.
--
-- Also fixes a live CLAUDE.md §1.1 violation found on the same page: the
-- category cards claimed fixed guide counts ("18 guides", "24 guides" ... a
-- "134 Articles" total that was never anything but the sum of those same
-- invented numbers) and listed guide titles that did not exist anywhere.
-- knowledge.html now computes every count from what is actually in this table.
--
-- Idempotent (keyed on title), forward-only (ADR-0002).

insert into knowledge (title, category, level, read_time, excerpt, body, published, active)
select 'The Complete 8-Step Shot Cycle', 'Technique', 'Beginner–Intermediate', '8 min',
  'Frame-by-frame breakdown of the WA standard shot process, with common faults and corrections at each stage.',
  'Every repeatable shot is built from the same eight steps. Master them in order — each one sets up the next.

1. STANCE — Feet shoulder-width across the shooting line, weight 60/40 toward the balls of the feet, hips and shoulders level. Mark your foot position with tape so every arrow starts identically.

2. NOCK — Seat the arrow under the nocking point with the index vane pointing away from the riser. Listen for the click; a half-seated nock is a dropped arrow at full draw.

3. SET / HOOK & GRIP — Hook the string in the first groove of all three fingers, deep enough that the fingers stay relaxed. Set the bow hand: pressure point on the thumb pad, knuckles at 45°, fingers loose. Grip tension is the most common hidden error in scattered groups.

4. SET-UP — Raise the bow to shoulder height with the drawing elbow already behind the arrow line. Pre-align your shoulders to the target now; you cannot fix alignment at full draw.

5. DRAW — Pull with the back muscles, not the arm. The elbow travels around, not backwards. The draw should feel like the shoulder blades sliding toward each other.

6. ANCHOR — String touches the tip of the nose and the centre of the chin; index knuckle in the same facial hollow every shot. Verify on video weekly — anchor drift is invisible from the inside.

7. AIM & EXPANSION — Let the sight ring settle around the gold rather than forcing it still. Keep expanding through the clicker: the shot continues moving, only the sight picture is still.

8. RELEASE & FOLLOW-THROUGH — The fingers relax and the string leaves; the drawing hand finishes beside the neck, the bow arm stays on target until the arrow lands. If your hand ends up away from your neck, you plucked.

Train the cycle at a blank bale, 20–30 arrows a day, saying the step names silently. When the sequence runs without conscious thought, scores follow.',
  true, true
where not exists (select 1 from knowledge where lower(title) = 'the complete 8-step shot cycle');

insert into knowledge (title, category, level, read_time, excerpt, body, published, active)
select 'How to Choose Your First Recurve Bow', 'Equipment', 'Beginner', '12 min',
  'Draw weight, draw length, limb material, and riser options — everything a beginner needs to make the right first purchase.',
  'Buying your first recurve is about fit, not brand. Get these four things right:

DRAW WEIGHT — Beginners: 16–22 lbs (juniors 12–18 lbs). You should be able to draw and hold for 10 seconds, five times in a row, without shaking. Too heavy destroys form and shoulders; you can buy heavier limbs later — most risers accept new limbs.

DRAW LENGTH — Measure your wingspan fingertip-to-fingertip and divide by 2.5. That''s your approximate draw length in inches. It decides your bow length: draw under 26" → 64–66" bow; 26–28" → 66–68"; over 28" → 68–70".

RISER — A 25" aluminium ILF riser is the standard first buy. ILF (International Limb Fitting) matters more than the logo: it means limbs from almost any maker will fit when you upgrade. Check the grip feels neutral in your hand and the riser has bushings for a plunger, rest, sight and long rod.

LIMBS — Wood/fibreglass limbs are perfectly good to 30m and cost a fraction of carbon. Buy cheap limbs and a good riser: you will outgrow limbs in 6–12 months, the riser can last a decade.

BUDGET SPLIT (first full setup) — Riser 40%, limbs 15%, arrows 20% (never skimp — mismatched arrows will not group no matter how well you shoot), tab/armguard/quiver 10%, rest+plunger+sight 15%.

WHAT TO SKIP — Stabiliser weights, clicker and expensive sights can wait until your groups at 18m are fist-sized. Buy them when they solve a problem you actually have.

Finally: buy from a shop (or seller) that lets you draw the bow before paying, and get your club coach to check the fit in the first week.',
  true, true
where not exists (select 1 from knowledge where lower(title) = 'how to choose your first recurve bow');

insert into knowledge (title, category, level, read_time, excerpt, body, published, active)
select 'WA 70m Outdoor Scoring System — Full Guide', 'Rules', 'All Levels', '6 min',
  'Zone values, shoot-off procedures, appeals, timing rules, and equipment checks explained clearly for competitive archers.',
  'The 70m round is the Olympic format for recurve. Here is how scoring actually works.

THE TARGET — 122cm face, ten concentric rings. Gold scores 10 (inner) and 9, red 8 and 7, blue 6 and 5, black 4 and 3, white 2 and 1. The innermost "X" ring counts 10 and is used to break ties on total 10s.

RANKING ROUND — 72 arrows in 12 ends of 6 (4 minutes per end). Maximum score 720. This seeds the elimination brackets.

LINE CUTTERS — An arrow touching the line between two zones scores the HIGHER value. If athletes dispute a call, a judge decides; the arrow must not be touched before the call.

ELIMINATION MATCHES (SET SYSTEM) — Head-to-head matches are shot in sets of 3 arrows. Win a set: 2 set points. Draw: 1 each. First to 6 set points wins the match. This is why a match can be won by an archer with a lower total score — sets reset every 3 arrows.

SHOOT-OFF — At 5–5, each archer shoots a single arrow; closest to the centre wins. Judges measure if needed.

TIMING — 20 seconds per arrow in alternating-shot matches, 120 seconds per 3-arrow end otherwise. Shooting after the signal costs your highest arrow of that end.

EQUIPMENT CHECKS — Judges may inspect at any time. For recurve: no electronics, no magnifying sights, arrows marked with the athlete''s name or initials, and identical arrows within an end (same fletch colour/pattern).

BOUNCE-OUTS & PASS-THROUGHS — Score by the mark left on the face, confirmed by a judge, provided all arrow holes are properly marked from previous ends — mark your holes every end.',
  true, true
where not exists (select 1 from knowledge where lower(title) = 'wa 70m outdoor scoring system — full guide');

insert into knowledge (title, category, level, read_time, excerpt, body, published, active)
select '8-Week Training Block for Championship Prep', 'Training', 'Advanced', '14 min',
  'Volume, intensity, and competition simulation schedule used by national coaches to peak athletes for major events.',
  'A peaking block for a target event in week 9. Volume builds to week 5, then tapers while intensity holds. Arrows/week assumes a senior recurve athlete with a 250–350 base.

WEEKS 1–2 (FOUNDATION, 300 arrows/wk) — Mon: blank bale 60, SPT holds 5×30s. Tue: 70m grouping 90 arrows, no scoring. Wed: rest / gym pull work. Thu: technique focus 60 (one cue only). Fri: 70m scoring 72 (record). Sat: 90 arrows mixed 50m/70m. Sun: rest.

WEEKS 3–4 (LOADING, 350 arrows/wk) — Add a second scoring day. Introduce match simulation: 3-arrow ends against a training partner, set-point scoring. SPT rises to 5×45s holds. Video anchor and release once per week and compare against week 1.

WEEK 5 (PEAK VOLUME, 380 arrows/wk) — Two full 72-arrow rounds plus one full elimination-day simulation (ranking round in the morning, 4 matches in the afternoon). This is the hardest week — protect sleep and protein.

WEEK 6 (CONVERSION, 300 arrows/wk) — Cut volume 20%, keep every scoring session. All shooting now at competition pace with full pre-shot routine. Practise between-end routines: sit, breathe, plan the next end in one sentence.

WEEK 7 (SHARPEN, 240 arrows/wk) — Shoot at the same time of day as your event schedule. One pressure session: every arrow below 8 restarts the end. Confirm equipment — this is the LAST week for any change, including new strings.

WEEK 8 (TAPER, 150–180 arrows/wk) — Short, crisp sessions of 30–50 arrows ending on a strong end. No technique changes, no video analysis, no new ideas. Visualise the venue nightly: walk-in, warm-up, first end.

EVENT WEEK — Arrive early enough to shoot official practice. Total arrows before qualification day: under 60. Trust the block — the work is already in the bank.',
  true, true
where not exists (select 1 from knowledge where lower(title) = '8-week training block for championship prep');

-- New: real, sourced content for the Para Archery category, which previously
-- had zero real articles despite the category card existing on the page.
-- Classification mechanics are described at the level this project's own
-- research verified against World Archery's public classification framework —
-- article-level rulebook citation kept general where a specific sub-clause was
-- not directly confirmed (CLAUDE.md §1.9: cite what is verified, do not infer
-- the rest).
insert into knowledge (title, category, level, read_time, excerpt, body, published, active)
select 'Para Archery Classification, Explained', 'Para Archery', 'All Levels', '7 min',
  'How W1, Open, VI1, VI2 and VI3 classes are assessed, what each permits, and how the classification process actually works.',
  'Para archery classification decides which class an athlete competes in and what equipment they may use. It is a competitive category, not a medical label — governed by World Archery Rulebook Book 5.1.

THE CLASSES — W1: the most severe impairment class, affecting both arms and legs (or an equivalent functional loss); competes from a wheelchair. Open: combines W2 (wheelchair-using athletes with less severe impairment than W1) and ST (standing athletes with a qualifying physical impairment) into one competitive class. VI1, VI2, VI3: vision-impairment classes ordered by severity, VI1 being the most severe; VI1 archers compete blindfolded regardless of residual vision, to keep competition fair within the class.

HOW ASSESSMENT WORKS — Classification is not self-declared. It follows a documented process: a medical/eligibility form describing the impairment, a physical assessment (strength, range of motion, coordination) or a visual-acuity test for VI classes, carried out by a panel — normally two accredited international classifiers. The outcome is a classification card stating the sport class, any permitted assistive equipment (e.g. a stabilising strap for W1), and a review date, since some conditions are reassessed periodically rather than classified once for life.

WHAT THIS MEANS FOR EQUIPMENT — Permitted adaptive equipment is tied to the class on the card, not to what an athlete or coach thinks is fair — a strap, mouth-tab, or wheelchair modification allowed for one athlete''s class may not be permitted for another''s. Always check the current card, not a previous one; a lapsed review date can make equipment non-compliant even if the athlete''s impairment hasn''t changed.

GETTING CLASSIFIED — Contact your national federation (in India, the Archery Association of India) to be scheduled for classification, normally at a sanctioned event with classifiers present. Bring existing medical documentation of the impairment — it speeds up the assessment but does not replace it; classifiers make the sporting determination, not a doctor''s letter alone.

Source: World Archery Rulebook Book 5.1 (Para Archery) and World Archery''s published classification framework. If a specific sub-clause matters for a real eligibility decision, confirm the exact current wording with World Archery or AAI directly — rules are periodically amended.',
  true, true
where not exists (select 1 from knowledge where lower(title) = 'para archery classification, explained');
