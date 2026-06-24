-- This file creates all the database tables
-- Run it once to set everything up

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS: stores every person's account
CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT UNIQUE NOT NULL,
  password_hash          TEXT NOT NULL,
  dob                    DATE NOT NULL,
  display_name           TEXT,
  phone                  TEXT,
  phone_verified         BOOLEAN DEFAULT FALSE,
  tier                   TEXT NOT NULL DEFAULT 'none',
  membership_expires_at  TIMESTAMPTZ,
  membership_term_months INTEGER,
  coin_balance           INTEGER NOT NULL DEFAULT 0,
  is_artist              BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ACTIVE SESSIONS: tracks who is logged in where
-- UNIQUE on user_id means only ONE login allowed at a time
CREATE TABLE active_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  session_id    UUID NOT NULL,
  device_hint   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

-- COIN LEDGER: every Wonder Coins transaction ever
CREATE TABLE coin_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),
  type             TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  label            TEXT NOT NULL,
  funding_rail     TEXT,
  processor_tx_id  TEXT,
  consent_version  TEXT,
  consented_at     TIMESTAMPTZ,
  related_id       UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- MONTHLY ALLOTMENTS: tracks free messages and unlocks per month
CREATE TABLE monthly_allotments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id),
  month_key            TEXT NOT NULL,
  unlocks_used         INTEGER DEFAULT 0,
  messages_used        INTEGER DEFAULT 0,
  free_set_used        BOOLEAN DEFAULT FALSE,
  password_resets_used INTEGER DEFAULT 0,
  UNIQUE(user_id, month_key)
);

-- SETS: the content Jinal uploads (photos, videos, albums)
CREATE TABLE sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  mode        TEXT NOT NULL,
  price_coins INTEGER NOT NULL,
  visible     BOOLEAN DEFAULT FALSE,
  cover_key   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- SET ITEMS: individual files inside a set
CREATE TABLE set_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID REFERENCES sets(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  position   INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ACCESS GRANTS: who has access to which content and why
CREATE TABLE access_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  set_id      UUID REFERENCES sets(id),
  grant_type  TEXT NOT NULL,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  UNIQUE(user_id, set_id)
);

-- FAN SETTINGS: Jinal's per-person overrides
CREATE TABLE fan_settings (
  user_id            UUID PRIMARY KEY REFERENCES users(id),
  custom_chat_price  INTEGER,
  can_send_media     BOOLEAN DEFAULT FALSE,
  personal_chat_bg   TEXT,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- APP CONFIG: platform-wide settings like chat backgrounds
CREATE TABLE app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_config (key, value) VALUES
  ('default_personal_chat_bg', NULL),
  ('community_chat_bg', NULL);

-- MERCHANDISE: physical items for sale
CREATE TABLE merchandise (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  price_coins INTEGER NOT NULL,
  total_stock INTEGER NOT NULL,
  remaining   INTEGER NOT NULL,
  img_key     TEXT,
  visible     BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ORDERS: merchandise purchases
CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),
  merch_id         UUID REFERENCES merchandise(id),
  coins_charged    INTEGER NOT NULL,
  shipping_address JSONB,
  status           TEXT DEFAULT 'paid',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- CUSTOM REQUESTS: shoutouts and personal greetings
CREATE TABLE custom_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  type          TEXT NOT NULL,
  details       TEXT NOT NULL,
  coins_charged INTEGER NOT NULL,
  status        TEXT DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- CALL REQUESTS: video and audio call bookings
CREATE TABLE call_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  call_type       TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  coins_per_min   INTEGER NOT NULL,
  coins_charged   INTEGER NOT NULL,
  stream_call_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- COMMUNITY POSTS: the group feed messages
CREATE TABLE community_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  tier_scope  TEXT NOT NULL,
  content     TEXT NOT NULL,
  pinned      BOOLEAN DEFAULT FALSE,
  removed     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- GIFTS: Wonder Coins sent from a member to Jinal
CREATE TABLE gifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID REFERENCES users(id),
  coins_amount    INTEGER NOT NULL,
  funding_method  TEXT NOT NULL,
  processor_tx_id TEXT,
  consent_version TEXT,
  consented_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ARTIST NOTIFICATIONS: alerts for Jinal in her console
CREATE TABLE artist_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL,
  fan_id     UUID REFERENCES users(id),
  payload    JSONB,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Speed up common searches
CREATE INDEX idx_coin_ledger_user   ON coin_ledger(user_id, created_at DESC);
CREATE INDEX idx_access_grants_user ON access_grants(user_id);
CREATE INDEX idx_monthly_user_month ON monthly_allotments(user_id, month_key);
CREATE INDEX idx_community_tier     ON community_posts(tier_scope, removed);
CREATE INDEX idx_notifs_unread      ON artist_notifications(read, created_at DESC);