// Authoritative registration / licensing fee schedule (INR per year).
// Matches the public pricing page tiers. The SERVER always prices from this
// table — the client's selected level only chooses WHICH fee applies, never
// the amount, so a tampered request can't buy a National licence for ₹99.
'use strict';

const FEES = {
  club:          { fee: 7999,   label: 'Club / Range Licence',
                   access: 'Full club management suite: member management, class scheduling, attendance, classification workflow, finance module, club analytics, public club listing.' },
  district:      { fee: 11999,  label: 'District Federation',
                   access: 'Up to 20 member clubs, district rankings, tournament management & draws, member sync, classification oversight, communications board, basic API.' },
  state:         { fee: 39999,  label: 'State Federation',
                   access: 'Up to 100 member clubs, state rankings with category breakdown, compliance dashboard, tournament system with seeding, coach & judge licensing, full API, data export, priority support.' },
  national:      { fee: 79999,  label: 'National Federation',
                   access: 'Unlimited member clubs, national rankings, anti-doping module, judge/official certification, multi-state roll-up reporting, sovereign API, dedicated account manager, custom branding.' },
  international: { fee: 899999, label: 'International Federation',
                   access: 'Multi-country member management, premium SLA-backed API, dedicated technical support, global tournament infrastructure, multi-language portal, data-residency options.' },
  brand:         { fee: 119999, label: 'Equipment Brand Listing',
                   access: 'Brand storefront on the marketplace, unlimited SKUs, sales analytics, sponsored placements (4/yr), event sponsorship tools, verification badge, affiliate integration.' },
};

module.exports = { FEES };
