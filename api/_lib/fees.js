// Authoritative registration / licensing fee schedule (CHF per year).
//
// Currency moved INR -> CHF on 2026-07-16 at the owner's instruction. These are
// PLATFORM LICENCES (software access), so a single international currency is
// coherent. The physical shop is deliberately NOT converted — it ships within
// India with rupee delivery and Indian tax, and pricing real inventory in CHF
// while charging Indian logistics would misprice it.
//
// ⚠ Razorpay must have INTERNATIONAL PAYMENTS enabled (Dashboard → Account &
// Settings → International payments) or every CHF charge fails. Settlement
// still lands in INR — that is Razorpay's behaviour, not a bug here.
// Matches the public pricing page tiers. The SERVER always prices from this
// table — the client's selected level only chooses WHICH fee applies, never
// the amount, so a tampered request can't buy a National licence for ₹99.
'use strict';

const FEES = {
  club:          { fee: 89,   label: 'Club / Range Licence',
                   access: 'Full club management suite: member management, class scheduling, attendance, classification workflow, finance module, club analytics, public club listing.' },
  district:      { fee: 129,  label: 'District Federation',
                   access: 'Up to 20 member clubs, district rankings, tournament management & draws, member sync, classification oversight, communications board, basic API.' },
  state:         { fee: 429,  label: 'State Federation',
                   access: 'Up to 100 member clubs, state rankings with category breakdown, compliance dashboard, tournament system with seeding, coach & judge licensing, full API, data export, priority support.' },
  national:      { fee: 849,  label: 'National Federation',
                   access: 'Unlimited member clubs, national rankings, anti-doping module, judge/official certification, multi-state roll-up reporting, sovereign API, dedicated account manager, custom branding.' },
  international: { fee: 9499, label: 'International Federation',
                   access: 'Multi-country member management, premium SLA-backed API, dedicated technical support, global tournament infrastructure, multi-language portal, data-residency options.' },
  brand:         { fee: 1299, label: 'Equipment Brand Listing',
                   access: 'Brand storefront on the marketplace, unlimited SKUs, sales analytics, sponsored placements (4/yr), event sponsorship tools, verification badge, affiliate integration.' },
};

const CURRENCY = 'CHF';

module.exports = { FEES, CURRENCY };
