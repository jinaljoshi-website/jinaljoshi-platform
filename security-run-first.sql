-- security-run-first.sql
--
-- An integrity block, kept deliberately apart from the behavioural one.
--
-- ── Why this is not block_count ─────────────────────────────────────
--
-- The existing block in lib/moderation.js is built for behaviour: a member who
-- is rude, or spamming, or needs a few days away. It escalates 24 hours, then
-- 7 days, then 30, and it lifts itself. That is the correct shape for conduct,
-- where the person is a member who went too far and the point is to cool things
-- down, not to end the relationship.
--
-- Probing the platform for a way in is not that. It should not consume the
-- first rung of a ladder meant for members, it should not be a day long, and it
-- should not end because a clock ran out. So it gets its own two columns, with
-- no duration and no escalation: set, and lifted only by hand from Studio.
--
-- ── No CHECK constraints on the text columns, on purpose ────────────
--
-- A collection preview broke for eight days this month because a column carried
-- CHECK (level = ANY (ARRAY[1, 2])) while the code had moved on to offering
-- more. Nothing compared the two, so the drift surfaced as a member seeing an
-- error. These columns hold values the detector names (its signal keys, its
-- severities), and that list will grow. Pinning it here would recreate exactly
-- that trap, so the shape is enforced in lib/integrity.js, in one place, where
-- the values are defined.

BEGIN;

-- ── The block itself ────────────────────────────────────────────────
--
-- integrity_blocked_at is both the flag and the record of when. Null means not
-- blocked; any timestamp means blocked, with no expiry read from it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS integrity_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_reason     text;

-- Partial, because the rows that matter are the few that are set. Keeps the
-- index tiny on 628 members of whom none, normally, are blocked.
CREATE INDEX IF NOT EXISTS users_integrity_blocked_idx
  ON users (integrity_blocked_at DESC)
  WHERE integrity_blocked_at IS NOT NULL;

-- ── What was seen ───────────────────────────────────────────────────
--
-- Separate from moderation_log, which records actions taken against a member.
-- This records observations, most of which end in no action at all, and keeping
-- them apart means the moderation history stays readable as a list of
-- decisions rather than filling with scanner noise.

CREATE TABLE IF NOT EXISTS security_events (
  id         uuid        DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamptz DEFAULT now()            NOT NULL,

  -- Null once an account is deleted; email keeps the trail legible after that,
  -- which is the whole point of a security log.
  user_id    uuid,
  email      text,

  signal     text NOT NULL,   -- which detector fired, e.g. 'script_tag'
  severity   text NOT NULL,   -- 'critical' | 'suspicious'
  action     text NOT NULL,   -- 'blocked' | 'alerted' | 'logged'

  method     text,
  path       text,
  ip         text,

  -- Truncated by the caller before it gets here. Storing an attacker's input
  -- unbounded would be its own small denial of service.
  sample     text,

  CONSTRAINT security_events_pkey PRIMARY KEY (id),
  CONSTRAINT security_events_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- The panel reads newest-first, and the detector counts a single account's
-- recent events to decide whether it is looking at a pattern.
CREATE INDEX IF NOT EXISTS security_events_at_idx
  ON security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS security_events_user_at_idx
  ON security_events (user_id, created_at DESC);

COMMIT;

-- ── Check it took ───────────────────────────────────────────────────
-- Expect two rows for the columns, and 0 for the count.

SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name IN ('integrity_blocked_at', 'integrity_reason')
 ORDER BY column_name;

SELECT COUNT(*) AS events_so_far FROM security_events;
