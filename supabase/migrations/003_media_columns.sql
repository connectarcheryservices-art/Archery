-- Archery.Services — migration 003
-- Image columns for news covers and athlete/profile photos. Idempotent.
-- (Products already have img_url from schema.sql.) Run after 002.

alter table news     add column if not exists img_url text;
alter table profiles add column if not exists img_url text;
alter table athletes add column if not exists img_url text;
