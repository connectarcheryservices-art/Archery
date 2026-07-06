// Archery.Services — local dev server.
// Implements the SAME /api surface as the Vercel serverless functions (api/*),
// backed by data.json, so every feature works locally with zero configuration.
// Production uses Vercel + Supabase; this file is for local development only.
//   Run:   node local-server.js     →  http://localhost:3000  (admin pass: archery2025)

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computeQuote } = require('./api/_lib/pricing');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'archery2025';

// ── STORE (data.json) ─────────────────────────────────────────────────────────
const DATA_FILE = path.join(ROOT, 'data.json');
const SEED = {
  version: 2,
  products: [
    {id:1,name:'Pro Recurve Bow — 68" 36lbs',brand:'',category:'Recurve Bows',price:24500,was:29900,stock:14,imgUrl:'',active:true},
    {id:2,name:'Carbon Compound Bow — 60lbs Draw',brand:'',category:'Compound Bows',price:42000,was:null,stock:6,imgUrl:'',active:true},
    {id:3,name:'Aluminium Arrow Set — 12pcs Spine 400',brand:'',category:'Arrows',price:3200,was:3800,stock:47,imgUrl:'',active:true},
    {id:4,name:'Competition Target Face — 80cm WA',brand:'',category:'Targets',price:850,was:960,stock:200,imgUrl:'',active:true},
    {id:5,name:'Olympic Recurve Riser — Carbon ILF',brand:'',category:'Recurve Bows',price:68000,was:78000,stock:3,imgUrl:'',active:true},
    {id:6,name:'Finger Tab — Pro Leather Right Hand',brand:'',category:'Accessories',price:1200,was:null,stock:32,imgUrl:'',active:true},
    {id:7,name:'Bowstand Foldable — Carbon Fibre',brand:'',category:'Accessories',price:2800,was:3200,stock:25,imgUrl:'',active:true},
    {id:8,name:'Carbon Arrow Set — 12pcs Spine 500',brand:'',category:'Arrows',price:8400,was:9200,stock:40,imgUrl:'',active:true},
    {id:9,name:'Arm Guard — Full Length Leather',brand:'',category:'Protective Gear',price:650,was:null,stock:60,imgUrl:'',active:true},
    {id:10,name:'Recurve Sight — Olympic 4-Pin',brand:'',category:'Accessories',price:12500,was:15000,stock:12,imgUrl:'',active:true},
    {id:11,name:'String Wax & Maintenance Kit',brand:'',category:'Accessories',price:380,was:null,stock:90,imgUrl:'',active:true},
    {id:12,name:'Long Rod Stabiliser — 28" Carbon',brand:'',category:'Accessories',price:5600,was:6500,stock:18,imgUrl:'',active:true},
  ],
  tournaments: [
    {id:1,name:'National Open Championship 2026',date:'2026-07-14',location:'New Delhi',prize:2500000,slots:320,registered:248,status:'open',active:true},
    {id:2,name:'National Ranking Tournament — Round 3',date:'2026-08-02',location:'Kolkata',prize:800000,slots:500,registered:412,status:'open',active:true},
    {id:3,name:'International Grand Prix 2026',date:'2026-09-18',location:'Guwahati',prize:2500000,slots:600,registered:72,status:'soon',active:true},
  ],
  athletes: [
    {id:1,name:'Elena Vasquez',state:'Spain',discipline:'Recurve Open',rank:1,pb:687,active:true},
    {id:2,name:'Marcus Lindqvist',state:'Sweden',discipline:'Recurve Open',rank:2,pb:679,active:true},
    {id:3,name:'Yuki Tanaka',state:'Japan',discipline:'Recurve Open',rank:3,pb:674,active:true},
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
    {id:1,title:'Vasquez claims continental gold in dramatic shoot-off',category:'Results',date:'2026-06-18',excerpt:'A perfect final end secured the title after a 6-6 tie.',active:true},
    {id:2,title:'2026 National Ranking series adds two new stages',category:'Announcement',date:'2026-06-12',excerpt:'The calendar expands to twelve stages this season.',active:true},
  ],
  profiles: [
    {id:1,handle:'elena-vasquez',name:'Elena Vasquez',headline:'Recurve Open Athlete · National Team',location:'Madrid, Spain',discipline:'Recurve Open',bio:'World-ranked recurve archer focused on 70m outdoor.',pb:687,rank:1,events:24,years:9,links:[],achievements:[],experience:[],certifications:[],verified:true,active:true},
  ],
  posts: [
    {id:1,author:'Daniel Meyer',category:'Technique',title:'Clicker timing — how do you stop snatching the release?',body:'My clicker control falls apart under pressure. What drills helped you build a calm reactive release?',replies:[{author:'Mia Brown',text:'Blank-bale SPT with eyes closed — 20 mins a day.',ts:1750000000000}],likes:42,pinned:true,active:true,createdAt:1750000000000},
    {id:2,author:'Marcus Lindqvist',category:'Equipment',title:'Best arrow spine for a 68" recurve at 36lbs?',body:'Getting inconsistent grouping at 18m. 800 or 1000 spine?',replies:[],likes:28,pinned:false,active:true,createdAt:1750100000000},
    {id:3,author:'Sofia Herrera',category:'Para Archery',title:'Para classification 2026 — what changes for W1 and Open?',body:'Sharing a simplified breakdown of the updated criteria — ask away.',replies:[],likes:39,pinned:false,active:true,createdAt:1750200000000},
  ],
  registrations: [], reports: [], applications: [], chats: [], orders: [], events: [],
  settings: {
    currency:'INR', storeName:'Archery.Services',
    taxRate:0.10, platformFeeRate:0.05, deliveryStandard:49, deliverySameDay:149,
    freeDeliveryThreshold:999, sameDayEnabled:true,
    maintenanceMode:false, shopEnabled:true, tournamentsEnabled:true, communityEnabled:true,
    registrationOpen:true, announcementText:'', announcementActive:false, heroImage:'',
    siteName:'Archery.Services', tagline:'Global Archery Infrastructure',
    heroTitle:"The World's Complete Archery Platform", heroSubtitle:'From local club to international podium',
  },
  stats: { totalAthletes:50240, totalClubs:1247, totalTournaments:142, totalRevenue:40000000, pageViews:284600, newSignups:1842 },
};

let STORE;
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (saved && saved.version === 2) {
    STORE = { ...JSON.parse(JSON.stringify(SEED)), ...saved };
    console.log('  Data:  data.json loaded');
  } else {
    if (saved) fs.writeFileSync(path.join(ROOT, 'data.old.json'), JSON.stringify(saved, null, 2));
    STORE = JSON.parse(JSON.stringify(SEED));
    console.log('  Data:  old data.json backed up to data.old.json — fresh v2 store seeded');
  }
} catch (e) {
  STORE = JSON.parse(JSON.stringify(SEED));
  console.log('  Data:  fresh store seeded');
}
function save(){ fs.writeFile(DATA_FILE, JSON.stringify(STORE, null, 2), () => {}); }
function nextId(arr){ return Math.max(0, ...arr.map(x => x.id || 0)) + 1; }

// ── AUTH (same token derivation as api/_lib/auth.js) ──────────────────────────
function adminToken(){
  return crypto.createHmac('sha256', ADMIN_PASSWORD || 'no-admin-password-set').update('archery-admin-v1').digest('hex');
}
function isAdmin(req){
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) return false;
  const a = Buffer.from(t), b = Buffer.from(adminToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function send(res, obj, code = 200){
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(obj));
}
const CONTENT = ['products','tournaments','athletes','jobs','knowledge','news','profiles'];
const INBOX = {
  registrations:{fields:['tournamentId','tournamentName','firstName','lastName','dob','gender','fedNumber','country','discipline','level','club'],required:r=>(String(r.firstName||'').trim()||String(r.lastName||'').trim())?null:'Your name is required.',defaultStatus:'pending'},
  reports:{fields:['type','name','email','description','urgency'],required:r=>String(r.description||'').trim()?null:'A description of the concern is required.',defaultStatus:'open'},
  applications:{fields:['orgName','orgType','contactName','email','phone'],required:r=>String(r.orgName||'').trim()?null:'Organisation name is required.',defaultStatus:'pending'},
};
function orderNo(){ return 'ARC-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random()*1e4).toString(36).toUpperCase(); }

// ── API ────────────────────────────────────────────────────────────────────────
async function api(parts, method, body, req, res){
  const resource = parts[1];
  const id = parts[2] ? parseInt(parts[2], 10) : null;
  const action = parts[3] || null;
  let data = {};
  if (body) { try { data = JSON.parse(body); } catch(e){ return send(res, {ok:false, error:'Invalid JSON'}, 400); } }
  const now = Date.now();

  // Admin login
  if (resource === 'admin' && parts[2] === 'login' && method === 'POST') {
    if (data.password === ADMIN_PASSWORD) return send(res, {ok:true, token: adminToken()});
    return send(res, {ok:false, error:'Wrong password'}, 401);
  }

  // Settings / stats (single object)
  if (resource === 'settings' || resource === 'stats') {
    if (method === 'GET') return send(res, STORE[resource]);
    if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
    STORE[resource] = { ...STORE[resource], ...data }; save();
    return send(res, {ok:true, [resource]: STORE[resource]});
  }

  // Razorpay config
  if (resource === 'razorpay' && parts[2] === 'config') {
    return send(res, {keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || ''});
  }

  // Checkout quote
  if (resource === 'checkout' && parts[2] === 'quote' && method === 'POST') {
    const delivery = data.delivery === 'sameday' && STORE.settings.sameDayEnabled !== false ? 'sameday' : 'standard';
    const quote = computeQuote(data.items || [], { delivery, config: STORE.settings });
    return send(res, {ok:true, quote, sameDayEnabled: STORE.settings.sameDayEnabled !== false});
  }

  // Checkout create — re-prices from the store; without Razorpay keys runs in TEST MODE
  if (resource === 'checkout' && parts[2] === 'create' && method === 'POST') {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return send(res, {ok:false, error:'Your cart is empty.'}, 400);
    const cust = data.customer || {};
    if (!cust.name || !cust.phone) return send(res, {ok:false, error:'Name and phone are required.'}, 400);
    if (!cust.address1 || !cust.pincode) return send(res, {ok:false, error:'A delivery address and pincode are required.'}, 400);
    const priced = items.map(i => {
      const p = STORE.products.find(x => x.id === parseInt(i.id) && x.active !== false);
      return p ? {id:p.id, name:p.name, price:Number(p.price), qty:Math.max(1, parseInt(i.qty)||1)} : null;
    }).filter(Boolean);
    if (!priced.length) return send(res, {ok:false, error:'Cart items are no longer available.'}, 400);
    const delivery = data.delivery === 'sameday' && STORE.settings.sameDayEnabled !== false ? 'sameday' : 'standard';
    const quote = computeQuote(priced, { delivery, config: STORE.settings });
    const geo = data.geo || {};
    const order = {
      id: nextId(STORE.orders), orderNo: orderNo(),
      customerName: String(cust.name).slice(0,120), customerEmail: String(cust.email||'').slice(0,160), customerPhone: String(cust.phone).slice(0,20),
      addressLine1: cust.address1, addressLine2: cust.address2||'', city: cust.city||'', state: cust.state||'', pincode: cust.pincode, country: cust.country||'India',
      geoLat: geo.lat ?? null, geoLng: geo.lng ?? null, geoAccuracy: geo.accuracy ?? null,
      deliveryType: delivery, items: quote.items,
      goods: quote.goods, deliveryFee: quote.deliveryFee, tax: quote.tax, platformFee: quote.platformFee, total: quote.total, currency: quote.currency,
      paymentStatus: 'pending', paymentMethod: 'razorpay', status: 'new', createdAt: now, updatedAt: now,
    };
    // Local test mode (no Razorpay keys): complete the order immediately.
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      order.paymentStatus = 'paid'; order.paymentMethod = 'test-mode'; order.status = 'confirmed';
      for (const it of order.items) {
        const p = STORE.products.find(x => x.id === it.id);
        if (p) p.stock = Math.max(0, (p.stock||0) - it.qty);
      }
      STORE.orders.push(order);
      STORE.events.push({type:'purchase', value:order.total, orderId:order.id, ts:now});
      save();
      return send(res, {ok:true, testMode:true, orderId:order.id, orderNo:order.orderNo, quote});
    }
    // Real Razorpay (local with keys set)
    try {
      const auth = 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:auth},
        body: JSON.stringify({amount: quote.totalPaise, currency:'INR', receipt: order.orderNo, payment_capture:1}),
      });
      const rp = await r.json();
      if (!r.ok) return send(res, {ok:false, error: rp?.error?.description || 'Razorpay order failed'}, 502);
      order.razorpayOrderId = rp.id;
      STORE.orders.push(order); save();
      return send(res, {ok:true, orderId:order.id, orderNo:order.orderNo, quote,
        razorpay:{keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID, orderId: rp.id, amount: quote.totalPaise, currency:'INR'}});
    } catch(e){ return send(res, {ok:false, error:'Could not reach Razorpay.'}, 502); }
  }

  // Federation/brand registration fee — level priced server-side (parity with api/_handlers/checkout-fee.js)
  if (resource === 'checkout' && parts[2] === 'fee' && method === 'POST') {
    const FEES = {
      club:{fee:7999,label:'Club / Range Licence'}, district:{fee:11999,label:'District Federation'},
      state:{fee:39999,label:'State Federation'}, national:{fee:79999,label:'National Federation'},
      international:{fee:899999,label:'International Federation'}, brand:{fee:119999,label:'Equipment Brand Listing'},
    };
    const tier = FEES[String(data.level||'').toLowerCase()];
    if (!tier) return send(res, {ok:false, error:'Please choose a registration level.'}, 400);
    if (!String(data.orgName||'').trim()) return send(res, {ok:false, error:'Organisation name is required.'}, 400);
    if (!String(data.email||'').trim()) return send(res, {ok:false, error:'An official email is required.'}, 400);
    const app = { id: nextId(STORE.applications), orgName:String(data.orgName).trim(), orgType:tier.label,
      contactName:data.contactName||'', email:String(data.email).trim(), phone:data.phone||'', status:'awaiting-payment', createdAt: now };
    STORE.applications.push(app);
    const order = {
      id: nextId(STORE.orders), orderNo: 'ARC-FED-'+now.toString(36).toUpperCase(),
      customerName: data.contactName||app.orgName, customerEmail: app.email, customerPhone: app.phone,
      addressLine1: app.orgName, pincode:'000000', country:'India', deliveryType:'registration',
      items:[{name:tier.label+' — annual registration ('+app.orgName+')', price:tier.fee, qty:1, applicationId:app.id, level:String(data.level).toLowerCase()}],
      goods:tier.fee, deliveryFee:0, tax:0, platformFee:0, total:tier.fee, currency:'INR',
      paymentStatus:'pending', paymentMethod:'razorpay', status:'new', createdAt: now, updatedAt: now,
    };
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      order.paymentStatus='paid'; order.paymentMethod='test-mode'; order.status='confirmed';
      app.status='paid-pending-review';
      STORE.orders.push(order);
      STORE.events.push({type:'purchase', value:order.total, orderId:order.id, ts:now});
      save();
      return send(res, {ok:true, testMode:true, applicationId:app.id, orderNo:order.orderNo, fee:tier.fee, level:String(data.level).toLowerCase(), label:tier.label});
    }
    try {
      const auth = 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:auth},
        body: JSON.stringify({amount: tier.fee*100, currency:'INR', receipt: order.orderNo, payment_capture:1}),
      });
      const rp = await r.json();
      if (!r.ok) return send(res, {ok:false, error: rp?.error?.description || 'Razorpay order failed'}, 502);
      order.razorpayOrderId = rp.id;
      STORE.orders.push(order); save();
      return send(res, {ok:true, applicationId:app.id, orderNo:order.orderNo, fee:tier.fee, label:tier.label,
        razorpay:{keyId: process.env.PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID, orderId: rp.id, amount: tier.fee*100, currency:'INR'}});
    } catch(e){ return send(res, {ok:false, error:'Could not reach Razorpay.'}, 502); }
  }

  // Razorpay verify (real-key path)
  if (resource === 'razorpay' && parts[2] === 'verify' && method === 'POST') {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const o = STORE.orders.find(x => x.razorpayOrderId === data.razorpay_order_id);
    if (!secret || !o) return send(res, {ok:false, error:'Not configured'}, 400);
    const expected = crypto.createHmac('sha256', secret).update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`).digest('hex');
    if (expected !== String(data.razorpay_signature)) { o.paymentStatus='failed'; save(); return send(res, {ok:false, error:'Payment verification failed'}, 400); }
    if (o.paymentStatus !== 'paid') {
      o.paymentStatus='paid'; o.status='confirmed'; o.razorpayPaymentId=data.razorpay_payment_id; o.updatedAt=now;
      for (const it of o.items){ const p=STORE.products.find(x=>x.id===it.id); if(p) p.stock=Math.max(0,(p.stock||0)-it.qty); }
      STORE.events.push({type:'purchase', value:o.total, orderId:o.id, ts:now});
      save();
    }
    return send(res, {ok:true, orderNo:o.orderNo});
  }

  // Orders (admin)
  if (resource === 'orders') {
    if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
    if (method === 'GET' && id === null) return send(res, STORE.orders.slice().sort((a,b)=>b.id-a.id));
    if (id !== null) {
      const o = STORE.orders.find(x => x.id === id);
      if (!o) return send(res, {error:'Not found'}, 404);
      if (method === 'GET') return send(res, o);
      if (method === 'PUT') { o.status = String(data.status||o.status).slice(0,30); o.updatedAt = now; save(); return send(res, {ok:true}); }
      if (method === 'DELETE') { STORE.orders = STORE.orders.filter(x => x.id !== id); save(); return send(res, {ok:true}); }
    }
    return send(res, {error:'Not handled'}, 405);
  }

  // Analytics
  if (resource === 'analytics') {
    if (method === 'POST') { STORE.events.push({type:String(data.type||'').slice(0,40), path:data.path, value:data.value??null, ts:now}); if (STORE.events.length>5000) STORE.events=STORE.events.slice(-4000); save(); return send(res, {ok:true}); }
    if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
    const paid = STORE.orders.filter(o=>o.paymentStatus==='paid');
    const byStatus = {}; STORE.orders.forEach(o=>{byStatus[o.status]=(byStatus[o.status]||0)+1;});
    const events = {}; STORE.events.forEach(e=>{events[e.type]=(events[e.type]||0)+1;});
    const cities = {}; STORE.orders.forEach(o=>{if(o.city)cities[o.city]=(cities[o.city]||0)+1;});
    const days = {}; const DAY=864e5;
    paid.forEach(o=>{ if(now-o.createdAt<14*DAY){ const d=new Date(o.createdAt).toLocaleDateString('en-IN',{month:'short',day:'2-digit'}); days[d]=(days[d]||0)+o.total; }});
    return send(res, {
      paidOrders: paid.length, revenue: paid.reduce((s,o)=>s+o.total,0), byStatus, events,
      topCities: Object.entries(cities).map(([city,n])=>({city,n})).sort((a,b)=>b.n-a.n).slice(0,8),
      recent: STORE.orders.slice(-10).reverse().map(o=>({id:o.id,order_no:o.orderNo,customer_name:o.customerName,total:o.total,status:o.status,payment_status:o.paymentStatus,city:o.city,created_at:o.createdAt})),
      revenueSeries: Object.entries(days).map(([d,v])=>({d,v})),
    });
  }

  // Inbox (registrations / reports / applications)
  if (INBOX[resource]) {
    const cfg = INBOX[resource];
    if (method === 'POST' && id === null) {
      const rec = {};
      for (const f of cfg.fields){ let v=data[f]; if(v==null)v=''; if(typeof v==='string')v=v.slice(0,4000); rec[f]=v; }
      if (resource==='registrations') rec.tournamentId = parseInt(data.tournamentId)||null;
      const err = cfg.required(rec); if (err) return send(res, {ok:false, error:err}, 400);
      rec.id = nextId(STORE[resource]); rec.status = cfg.defaultStatus; rec.createdAt = now;
      STORE[resource].push(rec); save();
      return send(res, {ok:true, id:rec.id});
    }
    if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
    if (method === 'GET') return send(res, STORE[resource].slice().sort((a,b)=>b.id-a.id));
    if (id !== null) {
      const item = STORE[resource].find(x=>x.id===id);
      if (!item) return send(res, {error:'Not found'}, 404);
      if (method === 'PUT') {
        const status = String(data.status||'').slice(0,40);
        if (resource==='registrations' && status==='approved' && item.status!=='approved' && item.tournamentId){
          const t = STORE.tournaments.find(x=>x.id===item.tournamentId); if (t) t.registered=(t.registered||0)+1;
        }
        item.status = status || item.status; save();
        return send(res, {ok:true});
      }
      if (method === 'DELETE') { STORE[resource]=STORE[resource].filter(x=>x.id!==id); save(); return send(res, {ok:true}); }
    }
    return send(res, {error:'Not handled'}, 405);
  }

  // AI coach — local dev always uses the page's built-in knowledge base.
  // (The live Claude-powered path runs in the Vercel function api/coach.js.)
  if (resource === 'coach') return send(res, { ok: false, fallback: true });

  // User accounts (register / login / me) — same contract as the serverless API
  if (resource === 'users') {
    if (!STORE.users) STORE.users = [];
    const action = parts[2];
    const b = data;
    const usecret = 'archery-users-v1:' + ADMIN_PASSWORD;
    const usign = u => {
      const p = Buffer.from(JSON.stringify({id:u.id,name:u.name,email:u.email})).toString('base64url');
      return p + '.' + crypto.createHmac('sha256', usecret).update(p).digest('base64url');
    };
    if (action === 'register' && method === 'POST') {
      const name = String(b.name||'').trim().slice(0,80);
      const email = String(b.email||'').trim().toLowerCase().slice(0,160);
      const password = String(b.password||'');
      if (!name || !email || !password) return send(res, {ok:false,error:'Name, email and password are required.'}, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, {ok:false,error:'Please enter a valid email address.'}, 400);
      if (password.length < 8) return send(res, {ok:false,error:'Password must be at least 8 characters.'}, 400);
      if (STORE.users.find(u=>u.email===email)) return send(res, {ok:false,error:'An account with this email already exists.'}, 409);
      const salt = crypto.randomBytes(16).toString('hex');
      const pass = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
      const user = { id: nextId(STORE.users), name, email, pass, createdAt: Date.now() };
      STORE.users.push(user); save();
      return send(res, {ok:true, token:usign(user), user:{id:user.id,name,email}});
    }
    if (action === 'login' && method === 'POST') {
      const email = String(b.email||'').trim().toLowerCase();
      const u = STORE.users.find(x=>x.email===email);
      let valid = false;
      if (u && u.pass && u.pass.includes(':')) {
        const [salt, hash] = u.pass.split(':');
        valid = crypto.scryptSync(String(b.password||''), salt, 64).toString('hex') === hash;
      }
      if (!valid) return send(res, {ok:false,error:'Incorrect email or password.'}, 401);
      return send(res, {ok:true, token:usign(u), user:{id:u.id,name:u.name,email:u.email}});
    }
    if (action === 'me' && method === 'GET') {
      const h = req.headers['authorization'] || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : '';
      const [p, sig] = t.split('.');
      if (p && sig && crypto.createHmac('sha256', usecret).update(p).digest('base64url') === sig) {
        try { return send(res, {ok:true, user: JSON.parse(Buffer.from(p,'base64url').toString())}); } catch(e){}
      }
      return send(res, {ok:false}, 401);
    }
    return send(res, {ok:false,error:'Not found'}, 404);
  }

  // Forum posts
  if (resource === 'posts') {
    if (method === 'GET' && id === null) {
      const list = isAdmin(req) ? STORE.posts : STORE.posts.filter(p=>p.active!==false);
      return send(res, list.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.id-a.id));
    }
    if (method === 'POST' && id === null) {
      const title=String(data.title||'').trim().slice(0,200), bodyTxt=String(data.body||'').trim().slice(0,8000);
      if (!title||!bodyTxt) return send(res, {ok:false, error:'Title and message are both required.'}, 400);
      const p={id:nextId(STORE.posts),author:String(data.author||'Guest').trim().slice(0,80)||'Guest',category:String(data.category||'General').slice(0,40),title,body:bodyTxt,replies:[],likes:0,pinned:false,active:true,createdAt:now};
      STORE.posts.push(p); save();
      return send(res, {ok:true, id:p.id});
    }
    if (id !== null) {
      const p = STORE.posts.find(x=>x.id===id);
      if (!p) return send(res, {error:'Not found'}, 404);
      if (method==='POST' && action==='like'){ p.likes=(p.likes||0)+1; save(); return send(res,{ok:true}); }
      if (method==='POST' && action==='reply'){
        const text=String(data.text||'').trim().slice(0,4000);
        if(!text) return send(res,{ok:false,error:'Reply cannot be empty.'},400);
        p.replies.push({author:String(data.author||'Guest').slice(0,80)||'Guest',text,ts:now}); save();
        return send(res,{ok:true});
      }
      if (method==='GET') return send(res, p);
      if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
      if (method==='PUT'){ if(data.pinned!==undefined)p.pinned=!!data.pinned; if(data.active!==undefined)p.active=!!data.active; save(); return send(res,{ok:true}); }
      if (method==='DELETE'){ STORE.posts=STORE.posts.filter(x=>x.id!==id); save(); return send(res,{ok:true}); }
    }
    return send(res, {error:'Not handled'}, 405);
  }

  // Live chat
  if (resource === 'chat') {
    if (method === 'GET' && id === null) {
      if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
      return send(res, STORE.chats.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
    }
    if (method === 'POST' && id === null) {
      const text = String(data.text||'').slice(0,2000);
      if (data.id) {
        const t = STORE.chats.find(c=>c.id===parseInt(data.id));
        if (!t) return send(res, {ok:false, error:'Not found'}, 404);
        if (text) t.messages.push({from:'user', text, ts:now});
        t.unread = true; t.updatedAt = now; save();
        return send(res, {ok:true, id:t.id});
      }
      const t = {id:nextId(STORE.chats), name:String(data.name||'Guest').slice(0,80), email:String(data.email||'').slice(0,160), status:'open', unread:true, updatedAt:now,
        messages:[{from:'admin', text:'Welcome to Archery.Services. How can our team help you today?', ts:now}]};
      if (text) t.messages.push({from:'user', text, ts:now});
      STORE.chats.push(t); save();
      return send(res, {ok:true, id:t.id});
    }
    if (id !== null) {
      const t = STORE.chats.find(c=>c.id===id);
      if (!t) return send(res, {error:'Not found'}, 404);
      if (method==='GET') return send(res, t);
      if (method==='POST' && action==='reply'){
        if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
        const text=String(data.text||'').slice(0,2000);
        if(!text) return send(res,{ok:false,error:'Empty reply'},400);
        t.messages.push({from:'admin',text,ts:now}); t.unread=false; t.updatedAt=now; save();
        return send(res,{ok:true});
      }
      if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
      if (method==='PUT'){ t.unread=false; save(); return send(res,{ok:true}); }
      if (method==='DELETE'){ STORE.chats=STORE.chats.filter(c=>c.id!==id); save(); return send(res,{ok:true}); }
    }
    return send(res, {error:'Not handled'}, 405);
  }

  // Content collections (products, tournaments, athletes, jobs, knowledge, news, profiles)
  if (CONTENT.includes(resource)) {
    if (method === 'GET' && id === null) {
      const list = isAdmin(req) ? STORE[resource] : STORE[resource].filter(x=>x.active!==false);
      return send(res, list.slice().sort((a,b)=>b.id-a.id));
    }
    if (method === 'GET' && id !== null) {
      const item = STORE[resource].find(x=>x.id===id);
      return send(res, item || {error:'Not found'}, item?200:404);
    }
    if (!isAdmin(req)) return send(res, {error:'Unauthorised'}, 401);
    if (method === 'POST') {
      const item = {...data, id: nextId(STORE[resource])};
      STORE[resource].push(item); save();
      return send(res, {ok:true, id:item.id});
    }
    if (id !== null) {
      const idx = STORE[resource].findIndex(x=>x.id===id);
      if (idx < 0) return send(res, {error:'Not found'}, 404);
      if (method === 'PUT'){ STORE[resource][idx] = {...STORE[resource][idx], ...data, id}; save(); return send(res,{ok:true}); }
      if (method === 'DELETE'){ STORE[resource].splice(idx,1); save(); return send(res,{ok:true}); }
    }
  }

  return send(res, {error:'Not found'}, 404);
}

// ── HTTP + STATIC FILES ────────────────────────────────────────────────────────
const MIME = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4'};

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    const u = new URL(req.url.replace(/^\/{2,}/, '/'), 'http://localhost');
    pathname = decodeURIComponent(u.pathname);
  } catch (e) {
    res.writeHead(400, {'Content-Type':'text/plain'});
    return res.end('Bad request');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => {
      api(pathname.split('/').filter(Boolean), req.method, body, req, res)
        .catch(e => { console.error('API error:', e.message); send(res, {error:'Internal server error'}, 500); });
    });
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(filePath + '.html', (e2, c2) => {
        if (e2) { res.writeHead(404, {'Content-Type':'text/html'}); return res.end('<h1 style="font-family:sans-serif;padding:40px;color:#F5F6F8;background:#101116;min-height:100vh;">404 — Page not found<br><br><a href="/" style="color:#C9A227;">← Back to Home</a></h1>'); }
        res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-cache'});
        res.end(c2);
      });
      return;
    }
    res.writeHead(200, {'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream','Cache-Control':'no-cache'});
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   🏹  ARCHERY.SERVICES — DEV SERVER       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  Site:     http://localhost:${PORT}`);
  console.log(`  Admin:    http://localhost:${PORT}/admin.html   (password: ${ADMIN_PASSWORD})`);
  console.log(`  Payments: ${process.env.RAZORPAY_KEY_ID ? 'Razorpay LIVE keys' : 'TEST MODE (no Razorpay keys — orders auto-confirm)'}`);
  console.log('  Full API implemented locally (same routes as Vercel).\n');
});
