(function(){
  var page = location.pathname.split('/').pop() || 'index.html';
  var links = [
    {href:'shop.html',label:'Shop'},
    {href:'knowledge.html',label:'Knowledge'},
    {href:'community.html',label:'Community'},
    {href:'tournaments.html',label:'Tournaments'},
    {href:'athletes.html',label:'Athletes'},
    {href:'jobs.html',label:'Jobs'},
    {href:'federation.html',label:'Federation'},
  ];
  var linkHTML = links.map(function(l){
    return '<li><a href="'+l.href+'"'+(l.href===page?' class="active"':'')+'>'+l.label+'</a></li>';
  }).join('');

  var navHTML = '<nav id="main-nav"><div class="nav-inner">'
    + '<a href="index.html" class="nav-logo">'
    + '<svg viewBox="0 0 42 42" fill="none"><circle cx="21" cy="21" r="20" stroke="#C9A227" stroke-width="1"/><circle cx="21" cy="21" r="14" stroke="#C9A227" stroke-width=".5" stroke-dasharray="2 3"/><circle cx="21" cy="21" r="7" stroke="#C9A227" stroke-width="1"/><circle cx="21" cy="21" r="2.5" fill="#C9A227"/><line x1="4" y1="21" x2="19" y2="21" stroke="#C9A227" stroke-width="1.2" stroke-linecap="round"/><polygon points="16,18.5 19,21 16,23.5" fill="#C9A227"/></svg>'
    + '<div><div class="nav-logo-main">Archery<span>.</span>Services</div><div class="nav-logo-sub">Global Archery Infrastructure</div></div>'
    + '</a>'
    + '<ul class="nav-links">' + linkHTML + '</ul>'
    + '<div class="nav-right">'
    +   '<a class="btn-ghost" href="signin.html" style="text-decoration:none;display:inline-flex;align-items:center;">Sign In</a>'
    +   '<a class="btn-primary-nav" href="signup.html" style="text-decoration:none;display:inline-flex;align-items:center;">Join Free</a>'
    +   '<button id="nav-burger" aria-label="Open menu" aria-expanded="false">'
    +     '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
    +   '</button>'
    + '</div>'
    + '</div>'
    + '<div id="nav-mobile"><ul>' + linkHTML + '</ul>'
    + '<div class="nm-actions"><a href="signin.html">Sign In</a><a href="signup.html" class="nm-join">Join Free</a></div>'
    + '</div></nav>';

  document.body.insertAdjacentHTML('afterbegin', navHTML);

  // Mobile nav styles — injected here so every page gets them without touching each file.
  var css = document.createElement('style');
  css.id = 'nav-mobile-css';
  css.textContent =
    '#nav-burger{display:none;background:none;border:1px solid rgba(201,162,39,.35);color:#C9A227;border-radius:8px;width:40px;height:38px;align-items:center;justify-content:center;cursor:pointer;}' +
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
      '.nav-links{display:none!important;}' +
      '#nav-burger{display:inline-flex;}' +
      'nav .nav-right .btn-ghost{display:none!important;}' +
      'nav #main-nav, nav .nav-inner{flex-wrap:nowrap;}' +
      'nav .nav-logo-sub{display:none;}' +
      'nav:not(.scrolled){background:rgba(16,17,22,.88);backdrop-filter:blur(14px);}' +
    '}';
  document.head.appendChild(css);

  var nav = document.getElementById('main-nav');
  var burger = document.getElementById('nav-burger');
  if (burger) burger.addEventListener('click', function(){
    var open = nav.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Close the menu after choosing a link
  document.querySelectorAll('#nav-mobile a').forEach(function(a){
    a.addEventListener('click', function(){ nav.classList.remove('nav-open'); });
  });
})();
