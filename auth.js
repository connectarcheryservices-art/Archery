// auth.js — shared client-side user authentication helper for Archery.Services
// Stores the session token + basic profile in localStorage and talks to /api/users/*
(function(){
  const TOKEN_KEY = 'archery_user_token';
  const USER_KEY  = 'archery_user';

  // "Remember me" unchecked -> sessionStorage (cleared when the tab closes),
  // checked (or unspecified, e.g. register) -> localStorage. Previously the
  // signin.html checkbox had no effect at all: every login persisted to
  // localStorage regardless, which misrepresented what unchecking it did on
  // a shared/public device.
  function save(token, user, remember){
    const store = remember === false ? sessionStorage : localStorage;
    const other = remember === false ? localStorage : sessionStorage;
    other.removeItem(TOKEN_KEY); other.removeItem(USER_KEY);
    if (token) store.setItem(TOKEN_KEY, token);
    if (user)  store.setItem(USER_KEY, JSON.stringify(user));
  }
  function clear(){
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY);
  }

  window.ArcheryAuth = {
    token(){ return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; },
    user(){ try { return JSON.parse(sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY) || 'null'); } catch(e){ return null; } },
    isLoggedIn(){ return !!this.token() && !!this.user(); },
    authHeaders(){ const t = this.token(); return t ? { 'Authorization': 'Bearer ' + t } : {}; },

    async register(name, email, password){
      const r = await fetch('/api/users/register', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, email, password })
      }).then(x=>x.json()).catch(()=>null);
      if (r && r.ok && r.token) save(r.token, r.user);
      return r;
    },

    async login(email, password, totp, remember){
      const r = await fetch('/api/users/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password, totp: totp || undefined })
      }).then(x=>x.json()).catch(()=>null);
      if (r && r.ok && r.token) save(r.token, r.user, remember);
      return r;
    },

    async logout(){
      const t = this.token();
      clear();
      if (t) { try { await fetch('/api/users/logout', { method:'POST', headers:{ 'Authorization':'Bearer ' + t } }); } catch(e){} }
    },

    // Re-validate the session with the server; clears stale local state on 401.
    async refresh(){
      const t = this.token();
      if (!t) return null;
      const r = await fetch('/api/users/me', { headers:{ 'Authorization':'Bearer ' + t } }).then(x=>x.json()).catch(()=>null);
      if (r && r.ok && r.user) { save(t, r.user); return r.user; }
      if (r && r.ok === false) clear();   // server no longer recognises this token
      return null;
    },
  };
})();
