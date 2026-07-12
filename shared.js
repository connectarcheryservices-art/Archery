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
    // ── Install banner — works on EVERY device ──
    // Chrome/Android: one-tap native prompt via beforeinstallprompt.
    // iOS Safari (never fires that event): show Add-to-Home-Screen instructions.
    // Other mobile browsers with no prompt: show a menu hint. Desktop Chrome: native.
    if (page.includes('admin')) return;
    var installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (installed) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
    var isAndroid = /Android/i.test(ua);
    var isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
    var deferred = null, shown = false;

    function injectCss(){
      if (document.getElementById('pwa-banner-css')) return;
      var css = document.createElement('style'); css.id = 'pwa-banner-css';
      css.textContent =
        '#pwa-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(14px);z-index:99998;width:min(560px,calc(100vw - 20px));background:#131316;border:1px solid rgba(201,162,39,.4);border-radius:14px;box-shadow:0 18px 55px rgba(0,0,0,.6);padding:14px 16px;opacity:0;transition:opacity .32s,transform .32s;}' +
        '#pwa-banner.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
        '#pwa-banner .pb-row{display:flex;align-items:center;gap:13px;}' +
        '#pwa-banner img{width:42px;height:42px;border-radius:9px;flex-shrink:0;}' +
        '#pwa-banner .pb-txt{flex:1;min-width:0;}' +
        '#pwa-banner .pb-t{font-family:Oswald,sans-serif;font-size:14.5px;font-weight:600;color:#fff;letter-spacing:.02em;}' +
        '#pwa-banner .pb-s{font-size:12px;color:#B9BEC9;margin-top:2px;line-height:1.45;}' +
        '#pwa-banner .pb-i{background:#C9A227;color:#131316;border:none;border-radius:7px;padding:10px 18px;font-family:Oswald,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;flex-shrink:0;}' +
        '#pwa-banner .pb-l{background:none;border:none;color:#7E8290;font-size:20px;line-height:1;cursor:pointer;flex-shrink:0;padding:4px 6px;}' +
        '#pwa-banner .pb-steps{margin:10px 0 0;font-size:12.5px;color:#E6E8EE;line-height:1.7;}' +
        '#pwa-banner .pb-steps b{color:#C9A227;}';
      document.head.appendChild(css);
    }
    function dismiss(b){ b.classList.remove('show'); setTimeout(function(){ b.remove(); }, 320); localStorage.setItem('archery_pwa_dismissed', '1'); }
    function banner(inner){
      if (shown || document.getElementById('pwa-banner')) return;
      shown = true; injectCss();
      var b = document.createElement('div'); b.id = 'pwa-banner'; b.innerHTML = inner;
      document.body.appendChild(b);
      requestAnimationFrame(function(){ b.classList.add('show'); });
      var close = b.querySelector('.pb-l'); if (close) close.addEventListener('click', function(){ dismiss(b); });
      return b;
    }
    var TITLE='<img src="/icon-192.png" alt=""><div class="pb-txt"><div class="pb-t">Install Archery.Services</div><div class="pb-s">Full-screen app · works offline.</div></div>';
    function iosBanner(force){
      var b=banner('<div class="pb-row">'+TITLE+'<button class="pb-l">&times;</button></div><div class="pb-steps">Tap the <b>Share</b> icon <span style="font-size:15px;">&#x2191;</span> in Safari, then <b>“Add to Home Screen”</b>.</div>', force);
      return b;
    }
    function hintBanner(force){
      return banner('<div class="pb-row">'+TITLE+'<button class="pb-l">&times;</button></div><div class="pb-steps">Open your browser menu <b>⋮</b> and tap <b>“Install app”</b> / “Add to Home screen”.</div>', force);
    }
    // Manual trigger — always works (nav "Install app" item calls this). Ignores dismissed.
    window.ArcheryInstall = function(){
      if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) { return; }
      var existing=document.getElementById('pwa-banner'); if(existing){existing.remove();shown=false;}
      if (deferred){
        deferred.prompt();
        deferred.userChoice.finally(function(){ deferred=null; });
        return;
      }
      if (isIOS) iosBanner(true); else hintBanner(true);
    };
    // 1. Native prompt (Chrome / Edge / Android / desktop) — one-tap install.
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault(); deferred = e;
      if (localStorage.getItem('archery_pwa_dismissed')) return;
      var b = banner('<div class="pb-row">'+TITLE+'<button class="pb-i">Install</button><button class="pb-l">&times;</button></div>');
      if (!b) return;
      b.querySelector('.pb-i').addEventListener('click', function(){
        b.remove(); deferred.prompt();
        deferred.userChoice.finally(function(){ deferred = null; });
      });
    });
    // 2. iOS Safari (no native event) → auto-show Add-to-Home-Screen steps.
    if (isIOS && !localStorage.getItem('archery_pwa_dismissed')) setTimeout(function(){ iosBanner(false); }, 2600);
    // 3. Other mobile with no native prompt → menu hint.
    else if (isMobile && !isIOS && !localStorage.getItem('archery_pwa_dismissed')) setTimeout(function(){ if (!deferred && !shown) hintBanner(false); }, 4200);
  })();

  // ── DAY / NIGHT THEME — real, persistent, site-wide ──
  (function theme(){
    if (page.includes('admin')) return;
    var root = document.documentElement;
    function apply(mode){
      if (mode === 'day'){ root.setAttribute('data-theme','day'); root.classList.add('day'); }
      else { root.removeAttribute('data-theme'); root.classList.remove('day'); }
      var fab = document.getElementById('theme-fab');
      if (fab) fab.innerHTML = mode === 'day'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'   // moon (switch to night)
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'; // sun (switch to day)
    }
    var saved = localStorage.getItem('archery_theme') || 'night';
    apply(saved);
    // Inject the day-mode token overrides (pages built on the shared var() tokens lighten instantly).
    if (!document.getElementById('archery-day-css')){
      var st = document.createElement('style'); st.id='archery-day-css';
      st.textContent =
        'html[data-theme="day"]{--ink:#EEF0F4;--ink-2:#FFFFFF;--ink-3:#E6E8EE;--surface:#FFFFFF;--surface-2:#E9EBF0;--char:#FFFFFF;--char-2:#EEF0F4;--char-3:#E0E3EA;--forest:#EEF0F4;--forest-2:#FFFFFF;--forest-3:#E9EBF0;--forest-4:#DEE1E8;--text:#15161A;--text-2:#454954;--muted:#7A7E88;--muted-2:#5C606B;--ivory:#15161A;--ivory-2:#454954;--ivory-3:#5C606B;}' +
        'html[data-theme="day"] body{background:#EEF0F4!important;background-image:none!important;color:#15161A;}' +
        'html[data-theme="day"] .card,html[data-theme="day"] .stat-card,html[data-theme="day"] .t-card,html[data-theme="day"] .product-card,html[data-theme="day"] .job-card,html[data-theme="day"] .post-card,html[data-theme="day"] .article-card,html[data-theme="day"] .sidebar-card{background:#FFFFFF!important;border-color:rgba(19,19,22,.1)!important;}' +
        'html[data-theme="day"] footer{background:#131316;}' +   // keep footer dark (looks good either mode)
        'html[data-theme="day"] #theme-fab{background:#fff;color:#131316;border-color:rgba(19,19,22,.15);box-shadow:0 6px 20px rgba(0,0,0,.15);}';
      (document.head||document.documentElement).appendChild(st);
    }
    // Floating toggle on every page (bottom-left, clear of the chat FAB on the right).
    function addFab(){
      if (document.getElementById('theme-fab') || !document.body) return;
      var f = document.createElement('button');
      f.id='theme-fab'; f.setAttribute('aria-label','Toggle day / night mode');
      f.style.cssText='position:fixed;left:16px;bottom:16px;z-index:9990;width:44px;height:44px;border-radius:50%;background:#17181D;color:#C9A227;border:1px solid rgba(201,162,39,.35);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4);';
      f.addEventListener('click', function(){
        var next = (localStorage.getItem('archery_theme')==='day') ? 'night' : 'day';
        localStorage.setItem('archery_theme', next); apply(next);
      });
      document.body.appendChild(f);
      apply(localStorage.getItem('archery_theme') || 'night');   // set the correct icon now the FAB exists
    }
    if (document.body) addFab(); else window.addEventListener('DOMContentLoaded', addFab);
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
      var hi = document.createElement('a');
      hi.href = 'account.html';
      hi.style.cssText = 'color:#C9A227;font-size:13px;font-weight:600;white-space:nowrap;text-decoration:none;';
      hi.textContent = 'Hi, ' + String(user.name).split(' ')[0];
      hi.title = 'My account';
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
    if (nm) nm.innerHTML = '<a href="account.html">My account</a>'
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
