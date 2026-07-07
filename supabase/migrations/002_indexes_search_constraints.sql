-- Archery.Services — migration 002
-- Production-grade indexing, full-text search, integrity constraints, and
-- derived-data support. Idempotent: safe to run repeatedly. Run AFTER schema.sql.
-- Supabase → SQL Editor → paste → Run.

-- ─────────────── HOT-PATH INDEXES ───────────────
-- Every public list query filters `active` and orders by id/date; these back them.
create index if not exists products_active_cat_idx  on products(active, category);
create index if not exists products_price_idx       on products(price);
create index if not exists products_created_idx     on products(id desc);
create index if not exists tournaments_status_idx   on tournaments(active, status, date);
create index if not exists athletes_rank_idx        on athletes(active, discipline, pb desc);
create index if not exists jobs_active_idx          on jobs(active, id desc);
create index if not exists knowledge_active_idx     on knowledge(active, category);
create index if not exists news_active_idx          on news(active, date desc);
create index if not exists posts_feed_idx           on posts(active, pinned desc, created_at desc);
create index if not exists profiles_active_idx      on profiles(active, rank);
create index if not exists registrations_status_idx on registrations(status, id desc);
create index if not exists reports_status_idx       on reports(status, id desc);
create index if not exists applications_status_idx  on applications(status, id desc);

-- ─────────────── FULL-TEXT SEARCH (products + knowledge) ───────────────
-- A generated tsvector column + GIN index gives real relevance-ranked search
-- server-side, instead of loading every row and filtering in the browser.
alter table products  add column if not exists search tsvector
  generated always as (to_tsvector('english',
    coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'') || ' ' || coalesce(description,''))) stored;
create index if not exists products_search_idx on products using gin(search);

alter table knowledge add column if not exists search tsvector
  generated always as (to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(category,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body,''))) stored;
create index if not exists knowledge_search_idx on knowledge using gin(search);

-- product-view analytics: value carries the product id for type='product_view'.
create index if not exists analytics_product_view_idx
  on analytics_events(created_at desc) where type = 'product_view';

-- ─────────────── INTEGRITY CONSTRAINTS ───────────────
-- Added defensively (NOT VALID-free via DO blocks so re-runs don't error).
do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_price_nonneg') then
    alter table products add constraint products_price_nonneg check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='products_stock_nonneg') then
    alter table products add constraint products_stock_nonneg check (stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_total_nonneg') then
    alter table orders add constraint orders_total_nonneg check (total >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_payment_status_ck') then
    alter table orders add constraint orders_payment_status_ck
      check (payment_status in ('pending','paid','failed','refunded'));
  end if;
  if not exists (select 1 from pg_constraint where conname='orders_status_ck') then
    alter table orders add constraint orders_status_ck
      check (status in ('new','confirmed','packed','shipped','delivered','cancelled'));
  end if;
end $$;

-- ─────────────── updated_at TRIGGER (orders) ───────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

-- ─────────────── DERIVED: athlete ranking view ───────────────
-- Ranking is computed from personal-best within each discipline, not hand-set.
create or replace view athlete_rankings as
  select id, name, state, discipline, pb, active,
         rank() over (partition by discipline order by pb desc nulls last) as computed_rank
  from athletes where active is not false;
