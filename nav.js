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
  var navHTML = '<nav id="main-nav"><div class="nav-inner">'
    + '<a href="index.html" class="nav-logo">'
    + '<svg viewBox="0 0 42 42" fill="none"><circle cx="21" cy="21" r="20" stroke="#C9A227" stroke-width="1"/><circle cx="21" cy="21" r="14" stroke="#C9A227" stroke-width=".5" stroke-dasharray="2 3"/><circle cx="21" cy="21" r="7" stroke="#C9A227" stroke-width="1"/><circle cx="21" cy="21" r="2.5" fill="#C9A227"/><line x1="4" y1="21" x2="19" y2="21" stroke="#C9A227" stroke-width="1.2" stroke-linecap="round"/><polygon points="16,18.5 19,21 16,23.5" fill="#C9A227"/></svg>'
    + '<div><div class="nav-logo-main">Archery<span>.</span>Services</div><div class="nav-logo-sub">Global Archery Infrastructure</div></div>'
    + '</a>'
    + '<ul class="nav-links">'
    + links.map(function(l){return '<li><a href="'+l.href+'"'+(l.href===page?' class="active"':'')+'>'+l.label+'</a></li>';}).join('')
    + '</ul>'
    + '<div class="nav-right"><button class="btn-ghost">Sign In</button><button class="btn-primary-nav">Join Free</button></div>'
    + '</div></nav>';
  document.body.insertAdjacentHTML('afterbegin', navHTML);
})();
