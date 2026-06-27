// shared.js — loaded by every page on Archery.Services
// Handles: nav active state, announcement banner, settings from API

(function() {
  const API = '/api';   // relative so it works on Vercel and locally alike
  const page = location.pathname.split('/').pop() || 'index.html';

  // ── ARCHERY TARGET-COLOUR THEME + ENHANCEMENTS ──
  // World Archery target-face palette — gold(yellow) · red · blue · black · white.
  // Injected last on every page so it overrides each page's own inline tokens.
  (function injectTheme(){
    if (document.getElementById('archery-theme-css')) return;
    const css = `
    :root{
      --tgt-gold:#FFC72C;--tgt-red:#E4002B;--tgt-blue:#009BDE;--tgt-black:#141414;--tgt-white:#F5F7FA;
      --gold:#FFC72C;--gold-light:#FFD45E;--gold-dark:#C9971A;--gold-ring:#FFC72C;
      --ember:#E4002B;--ember-light:#FF3B53;--ember-dark:#B00020;
      --ink:#0C0D10;--ink-2:#15171C;--ink-3:#1E2129;
      --surface:#15171C;--surface-2:#1E2129;
      --muted:#7A828F;--muted-2:#9AA2AE;
      --text:#F5F7FA;--text-2:#B7BECA;
      --forest:#0C0D10;--forest-2:#15171C;--forest-3:#1E2129;--forest-4:#272B35;
      --ivory:#F5F7FA;--ivory-2:#B7BECA;--ivory-3:#7A828F;
      --ease:cubic-bezier(.22,1,.36,1);
      --shadow-neu:10px 10px 30px rgba(0,0,0,.55),-8px -8px 22px rgba(255,255,255,.025);
      --glow-gold:0 14px 44px rgba(255,199,44,.30);
    }
    body{
      background-image:
        radial-gradient(1100px 680px at 82% -8%,rgba(228,0,43,.12),transparent 58%),
        radial-gradient(820px 560px at 4% 8%,rgba(0,155,222,.12),transparent 55%),
        radial-gradient(900px 900px at 50% 122%,rgba(255,199,44,.08),transparent 60%),
        linear-gradient(180deg,#0A0B0E,#0C0D10 45%,#08090C);
      background-attachment:fixed;
    }
    a,button,.card,.stat-card,.product-card,.t-card,.job-card,.post-card,.article-card{transition:transform .35s var(--ease),box-shadow .35s var(--ease),border-color .35s var(--ease);}
    .card,.stat-card{box-shadow:var(--shadow-neu);transform-style:preserve-3d;}
    .card:hover,.stat-card:hover{transform:perspective(1100px) translateY(-6px) rotateX(2.4deg);border-color:rgba(255,199,44,.38);box-shadow:16px 20px 50px rgba(0,0,0,.6),var(--glow-gold);}
    .btn-action,.btn-primary-nav{background:var(--tgt-gold)!important;color:#141414!important;position:relative;overflow:hidden;}
    .btn-primary,.btn-reg,.cart-d-checkout,.new-post-btn{position:relative;overflow:hidden;}
    .btn-action::after,.btn-primary-nav::after,.btn-primary::after{content:'';position:absolute;inset:0;transform:translateX(-130%);pointer-events:none;background:linear-gradient(120deg,transparent 22%,rgba(255,255,255,.5),transparent 78%);transition:transform .7s var(--ease);}
    .btn-action:hover::after,.btn-primary-nav:hover::after,.btn-primary:hover::after{transform:translateX(130%);}
    .section-title em,.sec-title em,.hero-title em,.nav-logo-main span,.footer-logo span,.footer-brand-name span{background:linear-gradient(110deg,var(--tgt-gold) 0%,var(--tgt-red) 55%,var(--tgt-blue) 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
    .nav-links a:hover,.nav-links a.active{color:var(--tgt-gold)!important;}
    *::-webkit-scrollbar{width:11px;height:11px;}
    *::-webkit-scrollbar-track{background:#0A0B0E;}
    *::-webkit-scrollbar-thumb{background:linear-gradient(var(--tgt-red),var(--tgt-gold));border-radius:8px;border:2px solid #0A0B0E;}
    *::-webkit-scrollbar-thumb:hover{background:linear-gradient(var(--tgt-blue),var(--tgt-gold));}
    `;
    const el = document.createElement('style');
    el.id = 'archery-theme-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  })();

  // ── ACTIVE NAV LINKS ──
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  // ── CURSOR ──
  const dot  = document.getElementById('cursor-dot');
  const ring = document.getElementById('cursor-ring');
  if (dot && ring) {
    let mx=0,my=0,rx=0,ry=0;
    document.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx+'px'; dot.style.top = my+'px';
    });
    (function anim() {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12;
      ring.style.left = rx+'px'; ring.style.top = ry+'px';
      requestAnimationFrame(anim);
    })();
  }

  // ── SCROLL PROGRESS + NAV ──
  const bar = document.getElementById('scroll-bar');
  const nav = document.getElementById('main-nav');
  window.addEventListener('scroll', () => {
    if (bar) bar.style.width = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight) * 100) + '%';
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
  });

  // ── REVEAL ON SCROLL ──
  const ro = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.reveal').forEach(r => ro.observe(r));

  // ── LOAD SETTINGS FROM API ──
  fetch(API + '/settings')
    .then(r => r.json())
    .then(s => {
      // Announcement banner
      if (s.announcementActive && s.announcementText) {
        const banner = document.createElement('div');
        banner.id = 'announcement-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--gold);color:var(--ink);text-align:center;padding:8px 40px;font-size:13px;font-weight:600;';
        banner.innerHTML = s.announcementText + ' <button onclick="this.parentElement.remove()" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:18px;cursor:pointer;color:var(--ink);">×</button>';
        document.body.prepend(banner);
        if (nav) nav.style.top = '36px';
      }
      // Maintenance mode
      if (s.maintenanceMode && !page.includes('admin')) {
        document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;font-family:sans-serif;background:#0A0A0F;color:#E8E8F0;text-align:center;padding:40px;"><div style="font-size:48px;">🏹</div><h1 style="font-size:28px;color:#C9A227;">Archery.Services</h1><p style="color:#A8A8C0;font-size:16px;">We are performing scheduled maintenance.<br>Back shortly.</p></div>';
      }
    })
    .catch(() => {}); // Server not running — fail silently

  // ── EXPOSE GLOBAL API HELPER ──
  window.ArcheryAPI = {
    base: API,
    get:  (r) => fetch(`${API}/${r}`).then(x=>x.json()),
    post: (r,d) => fetch(`${API}/${r}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(x=>x.json()),
    put:  (r,id,d) => fetch(`${API}/${r}/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(x=>x.json()),
    del:  (r,id) => fetch(`${API}/${r}/${id}`,{method:'DELETE'}).then(x=>x.json()),
  };

  // ── 3D POINTER TILT (desktop, motion-safe) ──
  // Gives cards real depth: they lean toward the cursor with a parallax feel.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover:none),(pointer:coarse)').matches;
  if (!reduceMotion && !isTouch && !page.includes('admin')) {
    const TILT_SEL = '.card,.stat-card,.product-card,.t-card,.job-card,.k-cat,.article-card,.post-card,.sidebar-card,.feature-card';
    let raf = 0;
    document.addEventListener('pointermove', e => {
      const el = e.target.closest(TILT_SEL);
      if (!el) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(1000px) translateY(-6px) rotateX(${(-py*5).toFixed(2)}deg) rotateY(${(px*6).toFixed(2)}deg)`;
        el.style.transition = 'transform .08s linear';
      });
    }, { passive: true });
    document.addEventListener('pointerout', e => {
      const el = e.target.closest(TILT_SEL);
      if (el) { el.style.transform = ''; el.style.transition = 'transform .4s var(--ease,ease)'; }
    }, { passive: true });
  }
})();
