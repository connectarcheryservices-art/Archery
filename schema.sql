-- Archery.Services — Neon PostgreSQL Schema
-- Run once: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS products (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  brand     TEXT NOT NULL DEFAULT '',
  price     NUMERIC(10,2) NOT NULL DEFAULT 0,
  was       NUMERIC(10,2),
  category  TEXT NOT NULL DEFAULT '',
  stock     INTEGER NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT true,
  img_data  TEXT
);

CREATE TABLE IF NOT EXISTS tournaments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  date       DATE,
  location   TEXT NOT NULL DEFAULT '',
  prize      NUMERIC(12,2) NOT NULL DEFAULT 0,
  slots      INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'open',
  active     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS athletes (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT '',
  discipline TEXT NOT NULL DEFAULT '',
  rank       INTEGER,
  pb         INTEGER,
  active     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS news (
  id       SERIAL PRIMARY KEY,
  title    TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  date     DATE,
  excerpt  TEXT NOT NULL DEFAULT '',
  active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS jobs (
  id       SERIAL PRIMARY KEY,
  title    TEXT NOT NULL,
  org      TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  type     TEXT NOT NULL DEFAULT '',
  salary   TEXT NOT NULL DEFAULT '',
  active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS knowledge (
  id        SERIAL PRIMARY KEY,
  title     TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT '',
  level     TEXT NOT NULL DEFAULT '',
  read_time TEXT NOT NULL DEFAULT '',
  excerpt   TEXT NOT NULL DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT true,
  active    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS profiles (
  id             SERIAL PRIMARY KEY,
  handle         TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  headline       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  discipline     TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  pb             INTEGER,
  rank           INTEGER,
  events         INTEGER NOT NULL DEFAULT 0,
  years          INTEGER NOT NULL DEFAULT 0,
  links          JSONB NOT NULL DEFAULT '[]',
  achievements   JSONB NOT NULL DEFAULT '[]',
  experience     JSONB NOT NULL DEFAULT '[]',
  certifications JSONB NOT NULL DEFAULT '[]',
  verified       BOOLEAN NOT NULL DEFAULT false,
  active         BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS chats (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',
  unread     BOOLEAN NOT NULL DEFAULT true,
  updated_at BIGINT,
  messages   JSONB NOT NULL DEFAULT '[]'
);

-- End-user accounts (passwords stored only as scrypt salt:hash)
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT UNIQUE NOT NULL,
  pass       TEXT NOT NULL,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  text       TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public tournament registration submissions (moderated in the admin panel)
CREATE TABLE IF NOT EXISTS registrations (
  id              SERIAL PRIMARY KEY,
  tournament_id   INTEGER,
  tournament_name TEXT NOT NULL DEFAULT '',
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  dob             TEXT,
  gender          TEXT,
  fed_number      TEXT,
  country         TEXT,
  discipline      TEXT,
  level           TEXT,
  club            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      BIGINT
);

-- Confidential welfare / safeguarding reports
CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT '',
  name        TEXT,
  email       TEXT,
  description TEXT NOT NULL DEFAULT '',
  urgency     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  BIGINT
);

-- Federation / association access applications
CREATE TABLE IF NOT EXISTS applications (
  id           SERIAL PRIMARY KEY,
  org_name     TEXT NOT NULL DEFAULT '',
  org_type     TEXT,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   BIGINT
);

-- Shop orders (line items stored as JSONB)
CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_email TEXT,
  items          JSONB NOT NULL DEFAULT '[]',
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     BIGINT
);

-- Community forum posts (replies stored as JSONB)
CREATE TABLE IF NOT EXISTS posts (
  id         SERIAL PRIMARY KEY,
  author     TEXT NOT NULL DEFAULT 'Guest',
  category   TEXT NOT NULL DEFAULT 'General',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  replies    JSONB NOT NULL DEFAULT '[]',
  likes      INTEGER NOT NULL DEFAULT 0,
  pinned     BOOLEAN NOT NULL DEFAULT false,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT
);

-- Single-row tables for settings and stats
CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stats (
  id   INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'
);

-- Seed default settings row (ignored if already exists)
INSERT INTO settings (id, data) VALUES (1, '{
  "siteName": "Archery.Services",
  "tagline": "Global Archery Infrastructure",
  "heroTitle": "The World''s Complete Archery Platform",
  "heroSubtitle": "From local club to international podium",
  "maintenanceMode": false,
  "shopEnabled": true,
  "tournamentsEnabled": true,
  "communityEnabled": true,
  "registrationOpen": true,
  "announcementText": "",
  "announcementActive": false,
  "heroImage": ""
}') ON CONFLICT (id) DO NOTHING;

-- Seed default stats row
INSERT INTO stats (id, data) VALUES (1, '{
  "totalAthletes": 50240,
  "totalClubs": 1247,
  "totalTournaments": 142,
  "totalRevenue": 4000000,
  "pageViews": 284600,
  "newSignups": 1842
}') ON CONFLICT (id) DO NOTHING;
