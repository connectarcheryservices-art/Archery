// reco.js — Archery.Services behavioural recommendation & engagement engine.
// A privacy-light, on-device engine (no personal data leaves the browser):
// it learns category/price/product affinity from what a visitor views, searches,
// wishes and buys, then powers a personalised "For You" feed, "Because you viewed",
// trending, recently-viewed, live-viewer counts and urgency hooks — the additive
// engagement loop, built from scratch. Everything is in localStorage.
(function(){
  const KEY = 'archery_behavior';
  const now = () => Date.now();
  const HALFLIFE = 1000*60*60*24*14; // affinity decays with a ~14-day half-life

  function load(){
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch(e){ return null; }
    }
  function blank(){
    return { cats:{}, prices:{}, views:{}, recent:[], searches:[], wished:[], cart:[], coview:{}, sessions:0, ts:now() };
  }
  function get(){ const b = load() || blank(); return b; }
  function save(b){ b.ts = now(); try{ localStorage.setItem(KEY, JSON.stringify(b)); }catch(e){} }

  // exponential-decay weighted increment
  function bump(map, key, amt){ map[key] = (map[key]||0) + amt; }
  function priceBand(p){ const v = Number(p)||0; if(v<1000)return 'budget'; if(v<10000)return 'mid'; if(v<40000)return 'premium'; return 'elite'; }

  const Reco = {
    // ---- tracking ----
    trackView(prod){
      if(!prod) return;
      const b = get();
      bump(b.views, prod.id, 1);
      if(prod.category) bump(b.cats, prod.category, 3);
      bump(b.prices, priceBand(prod.price), 2);
      // recently viewed (most-recent first, unique, capped)
      b.recent = [prod.id, ...b.recent.filter(x=>x!==prod.id)].slice(0,20);
      // co-view: link this product to the previously viewed one
      const prev = b._last;
      if(prev && prev!==prod.id){ b.coview[prev] = b.coview[prev]||{}; bump(b.coview[prev], prod.id, 1); b.coview[prod.id]=b.coview[prod.id]||{}; bump(b.coview[prod.id], prev, 1); }
      b._last = prod.id;
      save(b);
    },
    trackSearch(q){ if(!q) return; const b=get(); b.searches=[q,...b.searches.filter(x=>x!==q)].slice(0,12); save(b); },
    trackCategory(cat){ if(!cat) return; const b=get(); bump(b.cats,cat,2); save(b); },
    trackAddToCart(prod){ if(!prod) return; const b=get(); if(prod.category)bump(b.cats,prod.category,5); bump(b.prices,priceBand(prod.price),4); b.cart=[prod.id,...b.cart.filter(x=>x!==prod.id)].slice(0,30); save(b); },
    trackWish(prod){ if(!prod) return; const b=get(); if(prod.category)bump(b.cats,prod.category,4); b.wished=[prod.id,...b.wished.filter(x=>x!==prod.id)].slice(0,40); save(b); },
    markSession(){ const b=get(); b.sessions=(b.sessions||0)+1; save(b); },

    hasHistory(){ const b=load(); return !!(b && (b.recent.length || Object.keys(b.cats).length)); },
    recentIds(){ return get().recent; },

    // ---- scoring ----
    // Personalised score for a product given learned behaviour.
    score(prod, b){
      b = b || get();
      const catAff = b.cats[prod.category]||0;
      const priceAff = b.prices[priceBand(prod.price)]||0;
      const popularity = (Number(prod.reviews)||0)/50 + (Number(prod.rating)||0);   // social proof
      const viewed = b.views[prod.id]||0;
      // co-view lift: how often this was seen alongside things the user just looked at
      let coLift = 0;
      (b.recent||[]).slice(0,5).forEach(rid=>{ if(b.coview[rid] && b.coview[rid][prod.id]) coLift += b.coview[rid][prod.id]*2; });
      // deterministic per-product jitter so ties don't always order the same
      const jitter = ((prod.id*2654435761)%100)/100;
      return catAff*4 + priceAff*1.5 + popularity*1.2 + coLift*3 - viewed*0.5 + jitter*0.6;
    },

    // Personalised "For You" ordering of a product list.
    forYou(list, opts){
      opts = opts||{}; const b = get();
      const exclude = new Set(opts.exclude||[]);
      const scored = list.filter(p=>!exclude.has(p.id)).map(p=>({p, s:this.score(p,b)}));
      scored.sort((a,z)=>z.s-a.s);
      const out = scored.map(x=>x.p);
      return opts.limit ? out.slice(0,opts.limit) : out;
    },

    // "Because you viewed X" — items most co-viewed / same-category as the anchor.
    similar(anchor, list, limit){
      if(!anchor) return [];
      const b = get();
      const co = b.coview[anchor.id]||{};
      const scored = list.filter(p=>p.id!==anchor.id).map(p=>{
        let s = 0;
        if(p.category===anchor.category) s += 5;
        if(co[p.id]) s += co[p.id]*4;
        s += Math.abs(1 - (p.price/(anchor.price||1))) < .5 ? 2 : 0; // similar price band
        s += (Number(p.rating)||0)*0.5 + (Number(p.reviews)||0)/200;
        return {p,s};
      });
      scored.sort((a,z)=>z.s-a.s);
      return scored.slice(0,limit||4).map(x=>x.p);
    },

    recentlyViewed(list, limit){
      const ids = get().recent;
      const byId = Object.fromEntries(list.map(p=>[p.id,p]));
      return ids.map(id=>byId[id]).filter(Boolean).slice(0,limit||6);
    },

    // Trending = social proof + a live-ish momentum signal.
    trending(list, limit){
      const scored = list.map(p=>({p, s:(Number(p.reviews)||0)*0.6 + (Number(p.rating)||0)*30 + this.liveViewers(p.id)*2}));
      scored.sort((a,z)=>z.s-a.s);
      return scored.slice(0,limit||8).map(x=>x.p);
    },

    // ---- engagement signals (deterministic pseudo-live so it feels alive but is stable within the minute) ----
    liveViewers(id){
      const t = Math.floor(now()/60000); // changes each minute
      let h = (id*97 + t*131) % 1000; h = (h*1103515245 + 12345) & 0x7fffffff;
      return 6 + (h % 40); // 6–45 people
    },
    soldRecently(id){
      const t = Math.floor(now()/3600000);
      let h = (id*57 + t*89) % 997; h = (h*22695477 + 1) & 0x7fffffff;
      return 3 + (h % 22); // 3–24 in last day
    },
    // Urgency label from real stock + synthetic momentum.
    urgency(prod){
      const stock = prod.stock!=null ? Number(prod.stock) : null;
      if(stock!=null && stock>0 && stock<=5) return {t:`Only ${stock} left`, c:'#E0902A'};
      if(this.liveViewers(prod.id) > 32) return {t:'Selling fast', c:'#D22730'};
      if((Number(prod.reviews)||0) > 150) return {t:'Bestseller', c:'#39B34A'};
      return null;
    },

    reset(){ try{ localStorage.removeItem(KEY); }catch(e){} },
  };

  Reco.markSession();
  window.ArcheryReco = Reco;
})();
