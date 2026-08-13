// api/_lib/origin.js — the one place a client-supplied "origin" is trusted
// enough to build a link mailed to someone (a password reset, a parental
// consent request, ...). Extracted from api/_handlers/users-action.js so a
// second, independently-maintained allow-list can't quietly drift from
// this one — origin validation is exactly the kind of thing that's only
// as strong as its least-checked copy.
//
// A reset/consent link must point back at a real, known Archery.Services
// origin — never at whatever `origin` a caller puts in the request body.
// Otherwise a crafted `{email, origin:'https://evil.example'}` POST turns a
// real, valid, single-use token into a link handed to attacker
// infrastructure (classic reset-link poisoning).
'use strict';

const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?archery\.services$/, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

function safeOrigin(origin) {
  const o = String(origin || '');
  return ALLOWED_ORIGINS.some(re => re.test(o)) ? o : 'https://archery.services';
}

module.exports = { safeOrigin };
