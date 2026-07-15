// Initial content for SEEDING THE DATABASE (supabase/apply.js). These rows are
// INSERTed once so a fresh install has a catalogue an admin can then manage.
//
// They are NOT a runtime fallback and MUST NOT be served to users:
//   • an empty table returns an empty list (pages render honest empty states)
//   • a DB outage returns 503, not fabricated inventory
// Serving invented rows to real users as real is prohibited — CLAUDE.md §1.1.
// ROWS is therefore not imported by any request handler. Keep it that way.
'use strict';

const ROWS = {
  products: [
    {id:1,name:'Pro Recurve Bow — 68" 36lbs',brand:'Olympic Line',description:'Tournament-ready recurve with carbon limbs.',price:28999,was:33999,category:'Recurve Bows',stock:12,imgUrl:'',active:true},
    {id:2,name:'Carbon Compound Bow — 60lbs Draw',brand:'Carbon Series',description:'High let-off compound for field and target.',price:47999,was:null,category:'Compound Bows',stock:6,imgUrl:'',active:true},
    {id:3,name:'Aluminium Arrow Set — 12pcs Spine 400',brand:'Field Series',description:'Straightness-matched aluminium arrows.',price:3499,was:3999,category:'Arrows',stock:60,imgUrl:'',active:true},
    {id:4,name:'Competition Target Face — 80cm WA',brand:'Range Series',description:'WA 10-ring target face, weatherproof.',price:899,was:1099,category:'Targets',stock:200,imgUrl:'',active:true},
    {id:5,name:'Olympic Recurve Riser — Carbon ILF',brand:'Olympic Line',description:'Machined ILF riser, tournament grade.',price:68000,was:78000,category:'Recurve Bows',stock:3,imgUrl:'',active:true},
    {id:6,name:'Finger Tab — Pro Leather Right Hand',brand:'Club Series',description:'Anatomical leather tab with spacer.',price:1200,was:null,category:'Accessories',stock:32,imgUrl:'',active:true},
    {id:7,name:'Bowstand Foldable — Carbon Fibre',brand:'Field Series',description:'Lightweight foldable carbon bowstand.',price:2800,was:3200,category:'Accessories',stock:25,imgUrl:'',active:true},
    {id:8,name:'Carbon Arrow Set — 12pcs Spine 500',brand:'Carbon Series',description:'Premium carbon arrows, matched dozen.',price:8400,was:9200,category:'Arrows',stock:40,imgUrl:'',active:true},
    {id:9,name:'Arm Guard — Full Length Leather',brand:'Club Series',description:'Full-length leather arm guard.',price:650,was:null,category:'Protective Gear',stock:60,imgUrl:'',active:true},
    {id:10,name:'Recurve Sight — Olympic 4-Pin',brand:'Olympic Line',description:'Micro-adjust target sight.',price:12500,was:15000,category:'Accessories',stock:12,imgUrl:'',active:true},
    {id:11,name:'String Wax & Maintenance Kit',brand:'Field Series',description:'Complete string care kit.',price:380,was:null,category:'Accessories',stock:90,imgUrl:'',active:true},
    {id:12,name:'Long Rod Stabiliser — 28" Carbon',brand:'Carbon Series',description:'28" carbon long rod stabiliser.',price:5600,was:6500,category:'Accessories',stock:18,imgUrl:'',active:true},
  ],
  tournaments: [
    {id:1,name:'National Open Championship 2026',date:'2026-07-14',location:'New Delhi',prize:2500000,slots:320,registered:248,status:'open',active:true},
    {id:2,name:'National Ranking Tournament — Round 3',date:'2026-08-02',location:'Kolkata',prize:800000,slots:500,registered:412,status:'open',active:true},
    {id:3,name:'International Grand Prix 2026',date:'2026-09-18',location:'Guwahati',prize:2500000,slots:600,registered:72,status:'soon',active:true},
  ],
  athletes: [
    {id:1,name:'Deepika Singh',state:'Jharkhand',discipline:'Recurve Open',rank:1,pb:687,active:true},
    {id:2,name:'Atanu Bora',state:'Assam',discipline:'Recurve Open',rank:2,pb:679,active:true},
    {id:3,name:'Priya Gogoi',state:'Assam',discipline:'Compound Open',rank:3,pb:674,active:true},
    {id:4,name:'Sunil Mahato',state:'Jharkhand',discipline:'Recurve Open',rank:4,pb:661,active:true},
    {id:5,name:'Rohit Krishnan',state:'Tamil Nadu',discipline:'Recurve Open',rank:5,pb:658,active:true},
  ],
  jobs: [
    {id:1,title:'Head Recurve Coach',org:'National Training Centre',location:'On-site',type:'Full Time',salary:'₹80,000–₹1,10,000/month',active:true},
    {id:2,title:'Club Development Officer',org:'Regional Archery Council',location:'Hybrid',type:'Full Time',salary:'₹55,000/month',active:true},
    {id:3,title:'Junior Coach — U-18 Programme',org:'Metro Archery Academy',location:'On-site',type:'Contract',salary:'₹40,000/month',active:true},
  ],
  knowledge: [
    {id:1,title:'The Complete 8-Step Shot Cycle',category:'Technique',level:'Beginner–Intermediate',readTime:'8 min',excerpt:'Stance, nocking, set, draw, anchor, aim, release, follow-through.',body:'',published:true,active:true},
    {id:2,title:'How to Choose Your First Recurve Bow',category:'Equipment',level:'Beginner',readTime:'12 min',excerpt:'Draw length, limb weight, riser sizing, and budget.',body:'',published:true,active:true},
    {id:3,title:'WA 70m Outdoor Scoring — Full Guide',category:'Rules',level:'All Levels',readTime:'6 min',excerpt:'Ends, scoring zones, and shoot-offs under the international round.',body:'',published:true,active:true},
    {id:4,title:'8-Week Training Block for Championships',category:'Training',level:'Advanced',readTime:'14 min',excerpt:'Periodised volume, SPT, and mental routines to peak.',body:'',published:true,active:true},
  ],
  news: [
    {id:1,title:'Deepika Singh claims national gold in dramatic shoot-off',category:'Results',date:'2026-06-18',excerpt:'A perfect final end secured the title after a 6-6 tie.',active:true},
    {id:2,title:'2026 National Ranking series adds two new stages',category:'Announcement',date:'2026-06-12',excerpt:'The calendar expands to twelve stages this season.',active:true},
  ],
  profiles: [
    {id:1,handle:'deepika-singh',name:'Deepika Singh',headline:'Recurve Open Athlete · National Team',location:'Ranchi, Jharkhand',discipline:'Recurve Open',bio:'National-ranked recurve archer focused on 70m outdoor.',pb:687,rank:1,events:24,years:9,links:[],achievements:[],experience:[],certifications:[],verified:true,active:true},
  ],
};

const SETTINGS = {
  currency:'INR', storeName:'Archery.Services',
  taxRate:0.10, platformFeeRate:0.05, deliveryStandard:49, deliverySameDay:149,
  freeDeliveryThreshold:999, sameDayEnabled:true,
  maintenanceMode:false, shopEnabled:true, tournamentsEnabled:true, communityEnabled:true,
  registrationOpen:true, announcementText:'', announcementActive:false, heroImage:'',
};

// STATS deleted 2026-07-13: totalAthletes:52000 / totalClubs:1400 were invented
// and were served as fact by /api/stats via {...SEED, ...data} (CLAUDE.md §1.1).
// /api/stats now returns COUNT(*) from real tables. Do not reintroduce.

module.exports = { ROWS, SETTINGS };
