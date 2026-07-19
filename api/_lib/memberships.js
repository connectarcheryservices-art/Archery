// Authoritative membership plan table (CHF per year unless stated).
//
// THE SERVER PRICES MEMBERSHIPS. The client only chooses WHICH plan — never the
// amount (CLAUDE.md §1.6). Same rule as fees.js.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
// Archery.Services is an INDEPENDENT PLATFORM, not a national governing body.
// The structure here is modelled on how federations tier membership (age bands,
// family, lifetime, single-event), but the BENEFITS are deliberately different,
// because a private company cannot lawfully grant what an NGB grants:
//
//   NOT included, and never to be listed:   why
//     • liability / accident insurance      we hold no policy; claiming cover is fraud
//     • national team eligibility           only the national federation selects teams
//     • sanctioned-competition eligibility  we do not sanction competitions
//     • official national rankings          those belong to the national federation
//     • governance / voting rights          members are customers, not an association
//
// Every benefit below is something the platform actually does today. Do not add
// a benefit here before it exists — a membership page is a promise people pay
// for, and §1.1 applies to promises as much as to numbers.
'use strict';

const CURRENCY = 'CHF';

const PLANS = {
  recreational: {
    label: 'Recreational',
    price: 20,
    period: 'year',
    for: 'Anyone who shoots for enjoyment and wants the platform tools.',
    benefits: [
      'Public archer profile you own and can share',
      'Knowledge hub — technique, tuning and rules guides',
      'Community discussions',
      'Member pricing in the equipment store',
    ],
  },
  youth: {
    label: 'Youth',
    price: 45,
    period: 'year',
    ageNote: 'Under 18',
    for: 'Archers under 18. Registration requires a parent or guardian.',
    benefits: [
      'Everything in Recreational',
      'Verified athlete profile with training history',
      'Entry to events hosted on this platform',
      'Digital participation records for events you enter here',
      'AI coach — daily allowance',
    ],
    // CLAUDE.md §1.8 / DPDP s.9(3): under-18 accounts get no behavioural
    // profiling and no targeted merchandising, regardless of consent.
    minorSafeguards: true,
  },
  student: {
    label: 'Student',
    price: 45,
    period: 'year',
    for: 'Enrolled college or university archers. Proof of enrolment required.',
    benefits: [
      'Everything in Recreational',
      'Verified athlete profile with training history',
      'Entry to events hosted on this platform',
      'Digital participation records for events you enter here',
      'AI coach — daily allowance',
    ],
  },
  adult: {
    label: 'Adult',
    price: 65,
    period: 'year',
    recommended: true,
    for: 'Competing and club archers aged 18 and over.',
    benefits: [
      'Everything in Student',
      'Priority entry to events hosted on this platform',
      'Coach and club discovery',
      'Higher AI coach allowance',
    ],
  },
  family: {
    label: 'Family',
    price: 140,
    period: 'year',
    from: true,
    for: 'Two adults and up to three under-18s at one address.',
    benefits: [
      'Adult membership for two adults',
      'Youth membership for up to three under-18s',
      'One shared household billing record',
    ],
  },
  lifetime: {
    label: 'Lifetime',
    price: 1600,
    period: 'once',
    for: 'A one-time payment instead of renewing every year.',
    benefits: [
      'Everything in Adult, with no annual renewal',
      'Locked in against future price changes',
    ],
  },
  event: {
    label: 'Event Pass',
    price: 20,
    period: 'event',
    for: 'Enter a single event hosted on this platform without an annual plan.',
    benefits: [
      'Entry to one event hosted on this platform',
      'Digital participation record for that event',
    ],
  },
};

/** Server-side price lookup. Returns null for an unknown plan — never a default. */
function priceOf(planKey) {
  const p = PLANS[planKey];
  return p ? { key: planKey, label: p.label, price: p.price, currency: CURRENCY, period: p.period } : null;
}

module.exports = { PLANS, CURRENCY, priceOf };
