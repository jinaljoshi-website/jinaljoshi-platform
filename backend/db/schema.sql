-- ─────────────────────────────────────────────────────────────
-- Personal Space — full database schema
-- Run once on a fresh database.
-- Uses pgcrypto for UUID generation.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT        UNIQUE NOT NULL,
  password_hash          TEXT        NOT NULL,
  dob                    DATE        NOT NULL,
  display_name           TEXT,
  phone                  TEXT,
  phone_verified         BOOLEAN     DEFAULT FALSE,

  -- membership
  tier                   TEXT        NOT NULL DEFAULT 'guest',
  membership_expires_at  TIMESTAMPTZ,
  membership_term        TEXT,                        -- 'monthly' | 'quarterly' | 'annual'
  membership_started_at  TIMESTAMPTZ,

  -- tokens
  coin_balance           INTEGER     NOT NULL DEFAULT 0,

  -- roles
  is_artist              BOOLEAN     DEFAULT FALSE,

  created_at             TIMESTAMPTZ DEFAULT NOW(),
  last_login_at          TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────
-- ACTIVE SESSIONS
-- One row per user — enforces single-device login
-- ─────────────────────────────────────────────────────────────

CREATE TABLE active_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  session_id    UUID        NOT NULL,
  device_hint   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- COIN LEDGER
-- Every token transaction ever
-- ─────────────────────────────────────────────────────────────

CREATE TABLE coin_ledger (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        REFERENCES users(id),
  type                  TEXT        NOT NULL,
  -- 'recharge' | 'membership_purchase' | 'membership_upgrade'
  -- | 'dm_charge' | 'content_unlock' | 'call_charge'
  -- | 'merch_purchase' | 'custom_request' | 'gift_sent'
  -- | 'community_chat_charge' | 'gifted_membership' | 'debit'
  amount                INTEGER     NOT NULL,           -- always positive
  direction             TEXT        NOT NULL DEFAULT 'debit',  -- 'credit' | 'debit'
  label                 TEXT        NOT NULL,
  funding_rail          TEXT,                           -- 'razorpay' | 'balance' | 'gift'
  processor_tx_id       TEXT,
  consent_version       TEXT,
  consent_text_snapshot TEXT,
  consented_at          TIMESTAMPTZ,
  related_id            UUID,                           -- e.g. set_id, order_id
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- MONTHLY ALLOTMENTS
-- Tracks per-user per-month usage of free quotas
-- ─────────────────────────────────────────────────────────────

CREATE TABLE monthly_allotments (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID    REFERENCES users(id),
  month_key             TEXT    NOT NULL,               -- 'YYYY-MM'

  -- DMs
  free_dms_used         INTEGER DEFAULT 0,
  free_dms_today        INTEGER DEFAULT 0,
  dms_date              DATE,                           -- date free_dms_today was last reset

  -- Set unlocks
  unlocks_used          INTEGER DEFAULT 0,

  -- Community chat (for guests: date-keyed cost tracking)
  community_chat_paid_date DATE,                        -- last date guest paid for chat

  -- Password resets
  password_resets_used  INTEGER DEFAULT 0,

  UNIQUE(user_id, month_key)
);

-- ─────────────────────────────────────────────────────────────
-- COMMUNITY CHAT FAIR USE
-- Tracks hourly + daily message counts for all users
-- ─────────────────────────────────────────────────────────────

CREATE TABLE community_chat_usage (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES users(id),
  hour_key         TEXT        NOT NULL,   -- 'YYYY-MM-DD HH' in UTC
  day_key          TEXT        NOT NULL,   -- 'YYYY-MM-DD' in UTC
  messages_this_hour INTEGER   DEFAULT 0,
  messages_today   INTEGER     DEFAULT 0,
  UNIQUE(user_id, hour_key)
);

-- ─────────────────────────────────────────────────────────────
-- MEMBERSHIP GIFTS
-- Tracks free memberships Jinal grants by email
-- ─────────────────────────────────────────────────────────────

CREATE TABLE membership_gifts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  granted_by      UUID        REFERENCES users(id),     -- Jinal's user id
  recipient_email TEXT        NOT NULL,
  recipient_id    UUID        REFERENCES users(id),     -- null until user signs up
  tier            TEXT        NOT NULL,
  term            TEXT        NOT NULL,                 -- 'monthly' | 'quarterly' | 'annual'
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SETS (content Jinal uploads)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE sets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  type             TEXT        NOT NULL,                -- 'photo_set' | 'video' | 'album' | 'bts'
  category         TEXT        NOT NULL DEFAULT 'content',
  -- 'content' | 'access' | 'merchandise' | 'greetings'
  price_coins      INTEGER     NOT NULL DEFAULT 0,      -- 0 = community post (free to paid members)
  min_tier         TEXT        NOT NULL DEFAULT 'community',
  -- 'community' | 'insider' | 'premium' | 'supreme'
  use_unlock_credit BOOLEAN    DEFAULT TRUE,
  visible          BOOLEAN     DEFAULT FALSE,
  cover_key        TEXT,                                -- R2 object key for cover image
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SET ITEMS (files inside a set)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE set_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID    REFERENCES sets(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,   -- 'image' | 'video'
  r2_key     TEXT    NOT NULL,
  position   INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- ACCESS GRANTS (who unlocked what)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE access_grants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id),
  set_id      UUID        REFERENCES sets(id),
  grant_type  TEXT        NOT NULL,   -- 'unlock_credit' | 'token_purchase' | 'membership_free'
  coins_paid  INTEGER     DEFAULT 0,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  UNIQUE(user_id, set_id)
);

-- ─────────────────────────────────────────────────────────────
-- MERCHANDISE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE merchandise (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT    NOT NULL,
  description  TEXT,
  price_coins  INTEGER NOT NULL,
  total_stock  INTEGER NOT NULL,
  remaining    INTEGER NOT NULL,
  img_key      TEXT,
  category     TEXT    DEFAULT 'merchandise',
  visible      BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- ORDERS (merch purchases)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    REFERENCES users(id),
  merch_id         UUID    REFERENCES merchandise(id),
  coins_charged    INTEGER NOT NULL,
  shipping_address JSONB,
  status           TEXT    DEFAULT 'paid',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- CUSTOM REQUESTS (greetings, shoutouts)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE custom_requests (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID    REFERENCES users(id),
  type          TEXT    NOT NULL,   -- 'birthday' | 'anniversary' | 'shoutout' | 'priority'
  details       TEXT    NOT NULL,
  coins_charged INTEGER NOT NULL,
  status        TEXT    DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- CALL REQUESTS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE call_requests (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID    REFERENCES users(id),
  call_type      TEXT    NOT NULL,   -- 'audio' | 'video' | 'priority-video'
  status         TEXT    DEFAULT 'pending',
  coins_per_min  INTEGER NOT NULL,
  coins_charged  INTEGER NOT NULL,
  stream_call_id TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- COMMUNITY POSTS (Jinal's posts visible to members)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE community_posts (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    REFERENCES users(id),
  tier_scope  TEXT    NOT NULL DEFAULT 'community',
  -- 'community' | 'insider' | 'premium' | 'supreme'
  content     TEXT    NOT NULL,
  pinned      BOOLEAN DEFAULT FALSE,
  removed     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- GIFTS (tokens sent from fan to Jinal)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE gifts (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID    REFERENCES users(id),
  coins_amount    INTEGER NOT NULL,
  funding_method  TEXT    NOT NULL,   -- 'balance' | 'razorpay'
  processor_tx_id TEXT,
  consent_version TEXT,
  consented_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- FAN SETTINGS (per-user overrides Jinal can set)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE fan_settings (
  user_id           UUID  PRIMARY KEY REFERENCES users(id),
  custom_chat_price INTEGER,
  can_send_media    BOOLEAN DEFAULT FALSE,
  personal_chat_bg  TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- APP CONFIG
-- ─────────────────────────────────────────────────────────────

CREATE TABLE app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_config (key, value) VALUES
  ('default_personal_chat_bg', NULL),
  ('community_chat_bg', NULL);

-- ─────────────────────────────────────────────────────────────
-- ARTIST NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE artist_notifications (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT    NOT NULL,
  fan_id     UUID    REFERENCES users(id),
  payload    JSONB,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX idx_coin_ledger_user       ON coin_ledger(user_id, created_at DESC);
CREATE INDEX idx_access_grants_user     ON access_grants(user_id);
CREATE INDEX idx_monthly_user_month     ON monthly_allotments(user_id, month_key);
CREATE INDEX idx_community_tier         ON community_posts(tier_scope, removed);
CREATE INDEX idx_notifs_unread          ON artist_notifications(read, created_at DESC);
CREATE INDEX idx_sets_visible           ON sets(visible, min_tier);
CREATE INDEX idx_chat_usage_user_day    ON community_chat_usage(user_id, day_key);
CREATE INDEX idx_membership_gifts_email ON membership_gifts(recipient_email);
