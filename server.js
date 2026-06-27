// Archery.Services — Local Development Server
// Run: node server.js
// Opens at: http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// Simple in-memory data store (resets on server restart)
// In production this would be a database
let STORE = {
  products: [
    {id:1,name:'Pro Recurve Bow — 68" 36lbs',brand:'Yuggenite',price:24500,was:29900,category:'Recurve Bows',stock:14,active:true},
    {id:2,name:'Carbon Compound Bow — 60lbs',brand:'Gosports',price:42000,was:null,category:'Compound Bows',stock:6,active:true},
    {id:3,name:'Aluminium Arrow Set — 12pcs',brand:'Ten Ring',price:3200,was:3800,category:'Arrows',stock:48,active:true},
    {id:4,name:'Competition Target Face 80cm',brand:'Archery Card',price:850,was:960,category:'Targets',stock:200,active:true},
    {id:5,name:'Olympic Recurve Riser Carbon',brand:'Superspeed',price:68000,was:78000,category:'Recurve Bows',stock:3,active:true},
    {id:6,name:'Finger Tab Pro Leather',brand:'Mychoice',price:1200,was:null,category:'Accessories',stock:32,active:true},
  ],
  tournaments: [
    {id:1,name:'Assam Open Archery Championship 2025',date:'2025-07-14',location:'Guwahati, Assam',prize:240000,slots:320,registered:248,status:'open',active:true},
    {id:2,name:'National Ranking Tournament Round 3',date:'2025-08-02',location:'Pune, Maharashtra',prize:800000,slots:500,registered:412,status:'open',active:true},
    {id:3,name:'India International Grand Prix 2025',date:'2025-09-18',location:'New Delhi',prize:4500000,slots:600,registered:72,status:'soon',active:true},
  ],
  athletes: [
    {id:1,name:'Deepika Singh',state:'Jharkhand',discipline:'Recurve Open',rank:1,pb:687,active:true},
    {id:2,name:'Atanu Bora',state:'Assam',discipline:'Recurve Open',rank:2,pb:679,active:true},
    {id:3,name:'Priya Das',state:'West Bengal',discipline:'Recurve Open',rank:3,pb:674,active:true},
  ],
  settings: {
    siteName: 'Archery.Services',
    tagline: 'Global Virtual Archery Infrastructure',
    heroTitle: "The World's Complete Archery Platform",
    heroSubtitle: 'From local club to international federation',
    maintenanceMode: false,
    shopEnabled: true,
    tournamentsEnabled: true,
    communityEnabled: true,
    registrationOpen: true,
    announcementText: '',
    announcementActive: false,
  },
  announcements: [],
  jobs: [
    {id:1,title:'Head Recurve Coach',org:'SAI Guwahati',location:'Guwahati, Assam',type:'Full Time',salary:'₹60,000–₹80,000/month',active:true},
    {id:2,title:'Club Development Officer',org:'AAI',location:'New Delhi',type:'Full Time',salary:'₹45,000/month',active:true},
    {id:3,title:'Junior Coach — U-18 Programme',org:'Karnataka Archery',location:'Bengaluru',type:'Contract',salary:'₹35,000/month',active:true},
  ],
  stats: {
    totalAthletes: 50240,
    totalClubs: 1247,
    totalTournaments: 142,
    totalRevenue: 40000000,
    pageViews: 284600,
    newSignups: 1842,
  }
};

// API ROUTES
function handleAPI(reqUrl, method, body, res) {
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  // parts = ['api', resource, id?]
  const resource = parts[1];
  const id = parts[2] ? parseInt(parts[2]) : null;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (method === 'GET') {
    if (resource === 'settings') return res.end(JSON.stringify(STORE.settings));
    if (resource === 'stats')    return res.end(JSON.stringify(STORE.stats));
    if (STORE[resource])         return res.end(JSON.stringify(STORE[resource]));
    return res.end(JSON.stringify({error:'Not found'}));
  }

  if (method === 'POST' || method === 'PUT') {
    try {
      const data = JSON.parse(body);
      if (resource === 'settings') {
        STORE.settings = {...STORE.settings, ...data};
        return res.end(JSON.stringify({ok:true, settings: STORE.settings}));
      }
      if (resource === 'stats') {
        STORE.stats = {...STORE.stats, ...data};
        return res.end(JSON.stringify({ok:true}));
      }
      if (STORE[resource]) {
        if (id !== null) {
          // Update existing
          const idx = STORE[resource].findIndex(x => x.id === id);
          if (idx > -1) { STORE[resource][idx] = {...STORE[resource][idx], ...data}; return res.end(JSON.stringify({ok:true})); }
        } else {
          // Create new
          const newId = Math.max(0, ...STORE[resource].map(x=>x.id||0)) + 1;
          STORE[resource].push({...data, id:newId});
          return res.end(JSON.stringify({ok:true, id:newId}));
        }
      }
    } catch(e) { return res.end(JSON.stringify({error:'Invalid JSON'})); }
  }

  if (method === 'DELETE' && id !== null && STORE[resource]) {
    STORE[resource] = STORE[resource].filter(x => x.id !== id);
    return res.end(JSON.stringify({ok:true}));
  }

  res.end(JSON.stringify({error:'Not handled'}));
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    return res.end();
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => handleAPI(parsed, req.method, body, res));
    return;
  }

  // Serve static files
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try adding .html
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) {
          res.writeHead(404, {'Content-Type':'text/html'});
          return res.end('<h1 style="font-family:sans-serif;padding:40px;color:#fff;background:#0A0A0F;min-height:100vh;">404 — Page not found<br><br><a href="/" style="color:#C9A227;">← Back to Home</a></h1>');
        }
        res.writeHead(200, {'Content-Type':'text/html'});
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {'Content-Type': MIME[ext] || 'text/plain'});
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('\n');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   🏹  ARCHERY.SERVICES — DEV SERVER     ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║   Site:   http://localhost:${PORT}          ║`);
  console.log(`  ║   Admin:  http://localhost:${PORT}/admin.html║`);
  console.log('  ║   API:    http://localhost:3000/api/...  ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('\n  Press Ctrl+C to stop\n');
});
