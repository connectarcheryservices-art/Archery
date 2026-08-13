// api/_lib/age.js — the ONE place age is computed from a date of birth.
// CLAUDE.md §1.8: age assurance at account creation; under-18 protections
// apply regardless of consent. "Is this person a minor" must always be
// computed fresh from a real date of birth, never cached as a boolean that
// silently goes stale the day someone turns 18.
'use strict';

const ADULT_AGE = 18;

// null dateOfBirth -> null (unknown — never assumed adult, never assumed
// minor; every caller must decide what "unknown" means for that specific
// action, not this function).
function isMinor(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age < ADULT_AGE;
}

// Validates a date-of-birth STRING from a request body. Rejects the future,
// rejects implausible ages (>120y), rejects garbage — never silently
// coerces an invalid date into "adult" or "minor".
function validateDob(input) {
  const s = String(input || '').trim();
  if (!s) return { valid: false, error: 'Date of birth is required.' };
  const dob = new Date(s + 'T00:00:00Z');
  if (isNaN(dob.getTime())) return { valid: false, error: 'Enter a valid date of birth.' };
  const now = new Date();
  if (dob > now) return { valid: false, error: 'Date of birth cannot be in the future.' };
  const oldest = new Date(now); oldest.setFullYear(oldest.getFullYear() - 120);
  if (dob < oldest) return { valid: false, error: 'Enter a valid date of birth.' };
  return { valid: true, date: dob.toISOString().slice(0, 10) };
}

// Age at a given "as-of" date, using the calendar-year convention World
// Archery itself uses for class eligibility (Book 2 Art. 4.2.3-4.2.5,
// fetched 2026-08-13: "up to and in the year of his Nth birthday" — the
// year the athlete turns that age, not their exact birthdate). This is
// NOT the same calculation as isMinor() above, which is exact-birthdate
// (used for a legal age-of-majority test, where DPDP cares about the real
// day someone turns 18, not a calendar-year convention).
function ageInYear(dateOfBirth, asOf) {
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  const ref = asOf instanceof Date ? asOf : new Date(asOf);
  if (isNaN(dob.getTime()) || isNaN(ref.getTime())) return null;
  return ref.getFullYear() - dob.getFullYear();
}

// Computes the World Archery age_class for a competition happening on
// `asOf` (the event/tournament date — age class is evaluated for the
// competition year, not "today"; a registration submitted months before
// the event must not be classified as of the submission date).
//
// Cited, exact (World Archery Rule Book, Book 2 "Events", fetched 2026-08-13
// from extranet.worldarchery.sport, version 2022-09-01):
//   Art. 4.2.3 — Under 18 Class: competition up to and in the year of the
//                athlete's 17th birthday.
//   Art. 4.2.4 — Under 21 Class: competition up to and in the year of the
//                athlete's 20th birthday.
//   Art. 4.2.5 — 50+ Class: competition in the year of the athlete's 50th
//                birthday and thereafter.
//   Art. 4.2.1 confirms these are the ONLY age classes World Archery
//   recognises internationally (Under 18 / Under 21 / Women / Men / 50+) —
//   there is no "Under 15" class in the current WA rulebook.
//
// NOT independently cited — inferred, flagged, not fabricated as equally
// certain: 'u15' matches this schema's existing CHECK constraint (migration
// 021) and corresponds to a real domestic category Indian archery runs
// below WA's own international minimum (AAI's "Sub-Junior"/"U-15" tier —
// confirmed to exist via AAI/state-association competition-rule documents,
// but a precise primary-source numeric cutoff for it could not be found).
// Implemented here by extending WA's OWN cited calendar-year pattern one
// tier further down (up to and in the year of the 14th birthday) for
// internal consistency, NOT because that specific cutoff is independently
// verified against an AAI rulebook. Anyone wiring this into a real
// AAI-sanctioned Sub-Junior event should confirm the exact cutoff against
// AAI's current competition rules before trusting it — this is the one
// piece of this function that is a reasoned default, not a citation.
function computeAgeClass(dateOfBirth, asOf = new Date()) {
  const age = ageInYear(dateOfBirth, asOf);
  if (age == null) return null;
  if (age <= 14) return 'u15';   // inferred pattern-continuation — see note above
  if (age <= 17) return 'u18';   // Art. 4.2.3
  if (age <= 20) return 'u21';   // Art. 4.2.4
  if (age >= 50) return 'master50'; // Art. 4.2.5
  return 'senior';
}

module.exports = { ADULT_AGE, isMinor, validateDob, ageInYear, computeAgeClass };
