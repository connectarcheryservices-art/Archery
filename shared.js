// shared.js — loaded by every page on Archery.Services
// Handles: nav active state, announcement banner, settings from API

(function() {
  const API = '/api';   // relative so it works on Vercel and locally alike
  const page = location.pathname.split('/').pop() || 'index.html';

  // ── VIDEO-FAITHFUL THEME (approved homepage standard) ──
  // Flat bands: royal blue · gold #C9A227 · red #D22730 · black · white, Oswald type.
  // Injected last on every page so it overrides each page's own inline tokens.
  (function injectTheme(){
    if (document.getElementById('archery-theme-css')) return;
    // Oswald display font (same as the homepage) on every page.
    if (!document.querySelector('link[href*="Oswald"]')) {
      var fl = document.createElement('link');
      fl.rel = 'stylesheet';
      fl.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap';
      (document.head || document.documentElement).appendChild(fl);
    }
    const css = `
    :root{
      --tgt-gold:#C9A227;--tgt-red:#D22730;--tgt-blue:#1F3E9C;--tgt-black:#131316;--tgt-white:#F5F6F8;
      --gold:#C9A227;--gold-light:#D9B33A;--gold-dark:#A8871F;--gold-ring:#C9A227;
      --ember:#D22730;--ember-light:#E04653;--ember-dark:#A81D28;
      --blue:#1F3E9C;--blue-2:#1A3690;
      --ink:#101116;--ink-2:#17181D;--ink-3:#1D1E24;
      --surface:#17181D;--surface-2:#1D1E24;
      --muted:#7E8290;--muted-2:#9CA1AD;
      --text:#F5F6F8;--text-2:#B9BEC9;
      --forest:#101116;--forest-2:#17181D;--forest-3:#1D1E24;--forest-4:#26272E;
      --ivory:#F5F6F8;--ivory-2:#B9BEC9;--ivory-3:#838792;
      --ease:cubic-bezier(.22,1,.36,1);
      --shadow-neu:0 10px 30px rgba(0,0,0,.35);
      --glow-gold:0 10px 30px rgba(201,162,39,.22);
    }
    html:not(.day):not([data-theme="day"]) body{
      background:#101116!important;
      background-image:none!important;
      background-attachment:scroll!important;
    }
    body{cursor:auto!important;}
    #cursor-dot,#cursor-ring{display:none!important;}
    a,button,.card,.stat-card,.product-card,.t-card,.job-card,.post-card,.article-card{transition:transform .3s var(--ease),box-shadow .3s var(--ease),border-color .3s var(--ease);}
    .card:hover,.stat-card:hover{transform:translateY(-3px);border-color:rgba(201,162,39,.45);}
    .btn-action,.btn-primary-nav{background:var(--gold)!important;color:#131316!important;}
    .section-title,.sec-title,.hero-title,.page-hero h1{font-family:'Oswald',sans-serif;}
    .section-title em,.sec-title em,.hero-title em,.nav-logo-main span,.footer-logo span,.footer-brand-name span{background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:currentColor;color:var(--gold);}
    .nav-links a:hover,.nav-links a.active{color:var(--gold)!important;}
    #main-nav .nav-links a{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:12.5px;}
    nav#main-nav{background:#131316!important;border-bottom:1px solid rgba(255,255,255,.08);backdrop-filter:none!important;}
    nav#main-nav.scrolled{background:#131316!important;border-bottom:1px solid rgba(201,162,39,.35)!important;}
    input:focus,select:focus,textarea:focus{border-color:rgba(201,162,39,.55);box-shadow:0 0 0 3px rgba(201,162,39,.12);}
    *::-webkit-scrollbar{width:11px;height:11px;}
    *::-webkit-scrollbar-track{background:#101116;}
    *::-webkit-scrollbar-thumb{background:#26272E;border-radius:8px;border:2px solid #101116;}
    *::-webkit-scrollbar-thumb:hover{background:var(--gold-dark);}
    `;
    const el = document.createElement('style');
    el.id = 'archery-theme-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  })();

  // ── FAVICON (every page, one place) ──
  if (!document.querySelector('link[rel="icon"]')) {
    var fav = document.createElement('link');
    fav.rel = 'icon'; fav.type = 'image/svg+xml'; fav.href = '/favicon.svg';
    document.head.appendChild(fav);
  }

  // ── PWA: manifest, theme, service worker, install banner ──
  (function pwa(){
    var head = document.head || document.documentElement;
    if (!document.querySelector('link[rel="manifest"]')) {
      var mf = document.createElement('link'); mf.rel = 'manifest'; mf.href = '/manifest.webmanifest'; head.appendChild(mf);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      var tc = document.createElement('meta'); tc.name = 'theme-color'; tc.content = '#131316'; head.appendChild(tc);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      var at = document.createElement('link'); at.rel = 'apple-touch-icon'; at.href = '/apple-touch-icon.png'; head.appendChild(at);
      var wc = document.createElement('meta'); wc.name = 'apple-mobile-web-app-capable'; wc.content = 'yes'; head.appendChild(wc);
      var ti = document.createElement('meta'); ti.name = 'apple-mobile-web-app-title'; ti.content = 'Archery'; head.appendChild(ti);
    }
    // Register the service worker (offline + fast repeat loads). Admin excluded inside sw.js.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
    }
    // Custom install banner (captures the browser's install prompt) — skipped on admin + when already installed.
    if (page.includes('admin')) return;
    var installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (installed) return;
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault(); deferred = e;
      if (localStorage.getItem('archery_pwa_dismissed')) return;
      showInstall();
    });
    function showInstall(){
      if (document.getElementById('pwa-banner')) return;
      var css = document.createElement('style');
      css.textContent =
        '#pwa-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99998;width:min(560px,calc(100vw - 24px));background:#131316;border:1px solid rgba(201,162,39,.35);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);display:flex;align-items:center;gap:14px;padding:13px 15px;opacity:0;transition:opacity .3s,transform .3s;transform:translateX(-50%) translateY(12px);}' +
        '#pwa-banner.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
        '#pwa-banner img{width:38px;height:38px;border-radius:8px;flex-shrink:0;}' +
        '#pwa-banner .pb-txt{flex:1;min-width:0;}' +
        '#pwa-banner .pb-t{font-family:Oswald,sans-serif;font-size:14px;font-weight:600;color:#fff;letter-spacing:.02em;}' +
        '#pwa-banner .pb-s{font-size:12px;color:#B9BEC9;margin-top:1px;}' +
        '#pwa-banner .pb-i{background:#C9A227;color:#131316;border:none;border-radius:6px;padding:9px 16px;font-family:Oswald,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;flex-shrink:0;}' +
        '#pwa-banner .pb-l{background:none;border:none;color:#7E8290;font-size:12.5px;cursor:pointer;flex-shrink:0;padding:6px;}';
      document.head.appendChild(css);
      var b = document.createElement('div'); b.id = 'pwa-banner';
      b.innerHTML = '<img src="/icon-192.png" alt=""><div class="pb-txt"><div class="pb-t">Install Archery.Services</div><div class="pb-s">Add to your home screen — faster access & offline pages.</div></div>' +
        '<button class="pb-i">Install</button><button class="pb-l">Later</button>';
      document.body.appendChild(b);
      requestAnimationFrame(function(){ b.classList.add('show'); });
      b.querySelector('.pb-i').addEventListener('click', function(){
        b.remove(); if (!deferred) return; deferred.prompt();
        deferred.userChoice.finally(function(){ deferred = null; });
      });
      b.querySelector('.pb-l').addEventListener('click', function(){
        b.remove(); localStorage.setItem('archery_pwa_dismissed', '1');
      });
    }
  })();

  // ── PAGEVIEW ANALYTICS (best-effort; powers the admin dashboard) ──
  if (!page.includes('admin')) {
    try {
      var pv = JSON.stringify({ type: 'pageview', path: location.pathname, referrer: document.referrer || '' });
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/analytics', new Blob([pv], { type: 'application/json' }));
      else fetch(API + '/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pv, keepalive: true }).catch(function(){});
    } catch (e) {}
  }

  // ── UNIVERSAL MOBILE NAV (hamburger) ──
  // Works for pages with their own inline <nav> AND pages using nav.js.
  // Harvests the page's existing .nav-links so the menu always matches.
  (function mobileNav(){
    var nav = document.getElementById('main-nav');
    if (!nav || document.getElementById('nav-burger')) return; // nav.js already added one
    var links = nav.querySelectorAll('.nav-links a');
    if (!links.length) return;

    var items = '';
    links.forEach(function(a){
      items += '<li><a href="' + a.getAttribute('href') + '"' + (a.classList.contains('active') ? ' class="active"' : '') + '>' + a.textContent + '</a></li>';
    });
    var menu = document.createElement('div');
    menu.id = 'nav-mobile';
    menu.innerHTML = '<ul>' + items + '</ul>'
      + '<div class="nm-actions"><a href="signin.html">Sign In</a><a href="signup.html" class="nm-join">Join Free</a></div>';
    nav.appendChild(menu);

    var burger = document.createElement('button');
    burger.id = 'nav-burger';
    burger.setAttribute('aria-label', 'Open menu');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    var right = nav.querySelector('.nav-right') || nav.querySelector('.nav-inner') || nav;
    right.appendChild(burger);

    if (!document.getElementById('nav-mobile-css')) {
      var css = document.createElement('style');
      css.id = 'nav-mobile-css';
      css.textContent =
        '#nav-burger{display:none;background:none;border:1px solid rgba(201,162,39,.35);color:#C9A227;border-radius:8px;width:40px;height:38px;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}' +
        '#nav-mobile{display:none;background:rgba(16,17,22,.98);backdrop-filter:blur(20px);border-bottom:1px solid rgba(201,162,39,.2);padding:10px 18px 18px;}' +
        '#nav-mobile ul{list-style:none;margin:0;padding:0;}' +
        '#nav-mobile li{border-bottom:1px solid rgba(255,255,255,.06);}' +
        '#nav-mobile a{display:block;padding:13px 4px;color:#E6E8EE;text-decoration:none;font-size:15px;}' +
        '#nav-mobile a.active{color:#C9A227;}' +
        '#nav-mobile .nm-actions{display:flex;gap:10px;margin-top:14px;}' +
        '#nav-mobile .nm-actions a{flex:1;text-align:center;border:1px solid rgba(201,162,39,.4);border-radius:9px;padding:11px;color:#C9A227;font-weight:600;font-size:14px;}' +
        '#nav-mobile .nm-actions a.nm-join{background:#C9A227;color:#131316;border-color:#C9A227;}' +
        'nav.nav-open #nav-mobile{display:block;}' +
        '@media(max-width:900px){' +
          '#main-nav .nav-links{display:none!important;}' +
          '#nav-burger{display:inline-flex;}' +
          '#main-nav .nav-right>.btn-ghost,#main-nav .nav-right>a.btn-ghost{display:none!important;}' +
          '#main-nav .nav-logo-sub{display:none;}' +
          '#main-nav:not(.scrolled){background:rgba(16,17,22,.9);backdrop-filter:blur(14px);}' +
        '}';
      document.head.appendChild(css);
    }

    burger.addEventListener('click', function(){
      var open = nav.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ nav.classList.remove('nav-open'); });
    });
  })();

  // ── LOGGED-IN NAV STATE ──
  // Swaps "Sign In / Join Free" for "Hi, <name> · Sign out" on every page.
  (function authNav(){
    var user = null;
    try { user = JSON.parse(localStorage.getItem('archery_user') || 'null'); } catch(e){}
    if (!user || !user.name) return;
    var right = document.querySelector('#main-nav .nav-right');
    if (right) {
      var hi = document.createElement('span');
      hi.style.cssText = 'color:#C9A227;font-size:13px;font-weight:600;white-space:nowrap;';
      hi.textContent = 'Hi, ' + String(user.name).split(' ')[0];
      var out = document.createElement('button');
      out.className = 'btn-primary-nav';
      out.textContent = 'Sign out';
      out.style.cursor = 'pointer';
      out.addEventListener('click', function(){
        localStorage.removeItem('archery_user');
        localStorage.removeItem('archery_user_token');
        location.reload();
      });
      right.querySelectorAll('a.btn-ghost,button.btn-ghost,a.btn-primary-nav,button.btn-primary-nav,a.btn-gold,button.btn-gold,a.nav-cta').forEach(function(el){
        if (/sign in|join free/i.test(el.textContent)) el.remove();
      });
      right.insertBefore(out, right.querySelector('#nav-burger'));
      right.insertBefore(hi, out);
    }
    var nm = document.querySelector('#nav-mobile .nm-actions');
    if (nm) nm.innerHTML = '<a href="profile.html">Hi, ' + String(user.name).split(' ')[0] + '</a>'
      + '<a href="#" class="nm-join" onclick="localStorage.removeItem(\'archery_user\');localStorage.removeItem(\'archery_user_token\');location.reload();return false;">Sign out</a>';
  })();

  // ── TOASTS — branded notifications replacing native alert() on public pages ──
  (function toasts(){
    if (page.includes('admin')) return;
    var wrap = document.createElement('div'); wrap.id = 'as-toasts';
    document.body.appendChild(wrap);
    var css = document.createElement('style');
    css.id = 'as-toasts-css';
    css.textContent =
      '#as-toasts{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;width:min(430px,calc(100vw - 28px));pointer-events:none;}' +
      '.as-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;width:100%;background:#17181D;border:1px solid rgba(255,255,255,.12);border-left:3px solid #C9A227;border-radius:10px;padding:12px 14px;color:#F5F6F8;font-size:13.5px;line-height:1.55;box-shadow:0 16px 40px rgba(0,0,0,.5);opacity:0;transform:translateY(14px);transition:opacity .28s,transform .28s;}' +
      '.as-toast.show{opacity:1;transform:none;}' +
      '.as-toast.err{border-left-color:#D22730;}.as-toast.ok{border-left-color:#22C55E;}' +
      '.as-toast .as-x{margin-left:auto;background:none;border:none;color:#7E8290;font-size:16px;cursor:pointer;line-height:1;padding:0 0 0 6px;flex-shrink:0;}';
    document.head.appendChild(css);
    function toast(msg, type, ms){
      var t = document.createElement('div');
      t.className = 'as-toast' + (type ? ' ' + type : '');
      var color = type === 'err' ? '#E04653' : type === 'ok' ? '#22C55E' : '#C9A227';
      var icon = type === 'err' ? '⚠' : type === 'ok' ? '✓' : 'ℹ';
      var safe = String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;');
      t.innerHTML = '<span style="flex-shrink:0;color:' + color + ';font-weight:700;">' + icon + '</span><span>' + safe + '</span><button class="as-x" aria-label="Dismiss">&times;</button>';
      var timer = setTimeout(hide, ms || (safe.length > 90 ? 7000 : 4500));
      function hide(){ clearTimeout(timer); t.classList.remove('show'); setTimeout(function(){ t.remove(); }, 300); }
      t.querySelector('.as-x').addEventListener('click', hide);
      wrap.appendChild(t);
      while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
      requestAnimationFrame(function(){ t.classList.add('show'); });
    }
    window.ArcheryUI = { toast: toast };
    // Legacy alert() calls surface as branded toasts (tone inferred from the message).
    window.alert = function(m){
      var s = String(m);
      toast(s, /sorry|could not|cannot|failed|invalid|required|please enter|please choose|wrong|error|unable/i.test(s) ? 'err' : 'ok');
    };
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

})();
