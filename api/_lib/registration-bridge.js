// api/_lib/registration-bridge.js — connects an APPROVED tournament
// registration (api/_lib/inbox.js) to the real scoring domain (categories/
// events/event_categories/entries — migration 021). Before this existed,
// approving a registration only incremented tournaments.registered; the
// approved archer was never actually enterable into that tournament's
// real, offline-capable scoring system (ADR-0006/0007, commit ff96084).
// See migration 038 for the schema this depends on.
'use strict';
const { withTransaction } = require('./db');
const { computeAgeClass } = require('./age');

// Division is parsed from the free-text `discipline` field — "Para X"
// prefixes are treated as a distinct, unmappable case (see below), not as
// an ordinary division, since a Para entry needs a real World Archery
// sport classification this registration form never collects.
function parseDivision(discipline) {
  const d = String(discipline || '').trim().toLowerCase();
  if (d.startsWith('para')) return { division: null, isPara: true };
  if (d.startsWith('recurve')) return { division: 'recurve', isPara: false };
  if (d.startsWith('compound')) return { division: 'compound', isPara: false };
  if (d.startsWith('barebow')) return { division: 'barebow', isPara: false };
  return { division: null, isPara: false };
}

// categories.gender only recognises 'men'/'women' for an individual entry
// ('mixed' is for team events, not an individual archer's own category —
// migration 021). "Non-binary" (a real option on the registration form)
// has no mapping in the current World Archery class structure and is
// intentionally NOT force-fit into either — that would misrepresent who
// actually holds the category, not just leave a gap.
function parseGender(gender) {
  const g = String(gender || '').trim().toLowerCase();
  if (g === 'male') return 'men';
  if (g === 'female') return 'women';
  return null;
}

/**
 * Runs once, when a registration is first approved. Idempotent by design
 * (every insert here is find-or-create), so re-invoking it for an
 * already-bridged registration is harmless — but the caller (inbox.js)
 * still guards on first-time-approved to avoid the wasted work.
 *
 * @param {object} reg  the full registrations row (camelCase, from rowToObj)
 * @returns {Promise<{athleteId:number, entryId:number|null, manualReason:string|null}>}
 */
async function bridgeRegistrationToEntry(reg) {
  const fullName = `${reg.firstName || ''} ${reg.lastName || ''}`.trim();

  return withTransaction(async (client) => {
    // 1) find-or-create the athlete. Matched by email first (the real,
    // reliable key added in migration 038), falling back to exact
    // name+dob when no email was given — name matching alone is not
    // trustworthy (spelling variants), so it is never used on its own.
    let athlete = null;
    if (reg.email) {
      athlete = (await client.query('select id from athletes where lower(email)=lower($1) limit 1', [reg.email])).rows[0];
    }
    if (!athlete && reg.dob) {
      athlete = (await client.query('select id from athletes where lower(name)=lower($1) and dob=$2 limit 1', [fullName, reg.dob])).rows[0];
    }
    let athleteId;
    if (athlete) {
      athleteId = athlete.id;
      // Best-effort enrichment only — never overwrite a value that's
      // already there (a later registration's data isn't more
      // authoritative than what's already on file).
      await client.query('update athletes set email=coalesce(email,$1), dob=coalesce(dob,$2) where id=$3',
        [reg.email || null, reg.dob || null, athleteId]);
    } else {
      const insA = await client.query(
        `insert into athletes (name, state, discipline, dob, email, active) values ($1,$2,$3,$4,$5,true) returning id`,
        [fullName || 'Unnamed archer', reg.country || '', reg.discipline || '', reg.dob || null, reg.email || null]
      );
      athleteId = insA.rows[0].id;
    }

    // 2) map division/gender/age_class -> a real category. Anything that
    // can't be mapped honestly is surfaced as needs_manual_category, not
    // guessed or silently dropped — the athlete row above still gets
    // created either way, so staff can finish the entry by hand without
    // starting from nothing.
    const { division, isPara } = parseDivision(reg.discipline);
    const genderCode = parseGender(reg.gender);
    let entryId = null, manualReason = null;

    if (isPara) {
      manualReason = 'Para entry — a real World Archery sport classification (PI1/PI2/VI1/VI2) is required and is not collected on this registration form; staff must confirm classification and enter this athlete manually.';
    } else if (!division) {
      manualReason = `Could not determine a division from "${reg.discipline || '(none given)'}" — staff must set the category manually.`;
    } else if (!genderCode) {
      manualReason = `"${reg.gender || '(none given)'}" has no individual competition category in the current World Archery class structure (men/women only) — staff must confirm how to enter this athlete.`;
    } else if (!reg.dob) {
      manualReason = 'No validated date of birth on this registration — cannot compute an age class.';
    } else {
      const tour = (await client.query('select date, name from tournaments where id=$1', [reg.tournamentId])).rows[0];
      const asOf = (tour && tour.date) || new Date();
      const ageClass = computeAgeClass(reg.dob, asOf); // World Archery Book 2 Art. 4.2.1/4.2.3-4.2.5 — see api/_lib/age.js

      const cat = await client.query(
        `insert into categories (division, gender, age_class, para_class) values ($1,$2,$3,null)
         on conflict (division, gender, age_class, para_class) do update set division = excluded.division
         returning id`,
        [division, genderCode, ageClass]
      );
      const categoryId = cat.rows[0].id;

      let ev = (await client.query('select id from events where tournament_id=$1 limit 1', [reg.tournamentId])).rows[0];
      let eventId;
      if (ev) {
        eventId = ev.id;
      } else {
        const insE = await client.query(
          `insert into events (tournament_id, name, starts_on, ends_on) values ($1,$2,$3,$3) returning id`,
          [reg.tournamentId, (tour && tour.name) || reg.tournamentName || 'Tournament', (tour && tour.date) || null]
        );
        eventId = insE.rows[0].id;
      }

      // round_name is fixed to a real, non-null value on purpose: Postgres
      // treats every NULL as distinct for uniqueness, so a NULL round_name
      // would let this find-or-create silently create a duplicate
      // event_categories row on every call instead of reusing one.
      const ec = await client.query(
        `insert into event_categories (event_id, category_id, round_name) values ($1,$2,'Qualification')
         on conflict (event_id, category_id, round_name) do update set event_id = excluded.event_id
         returning id`,
        [eventId, categoryId]
      );
      const eventCategoryId = ec.rows[0].id;

      const ent = await client.query(
        `insert into entries (event_category_id, athlete_id) values ($1,$2)
         on conflict (event_category_id, athlete_id) do update set athlete_id = excluded.athlete_id
         returning id`,
        [eventCategoryId, athleteId]
      );
      entryId = ent.rows[0].id;
    }

    await client.query(
      'update registrations set athlete_id=$1, entry_id=$2, needs_manual_category=$3 where id=$4',
      [athleteId, entryId, manualReason, reg.id]
    );

    return { athleteId, entryId, manualReason };
  });
}

module.exports = { bridgeRegistrationToEntry, parseDivision, parseGender };
