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

module.exports = { ADULT_AGE, isMinor, validateDob };
