-- collections-bar-run-first.sql
--
-- A bar on the private collection that outranks every way in.
--
-- ── Why a new column rather than clearing what is there ─────────────
--
-- There are three ways into the collection: a Supreme membership carries it,
-- money spent earns it in tranches, and Jinal grants it by hand. The first of
-- those is not stored as a grant at all — it is read off the tier — so there
-- is nothing to delete. The existing revoke clears collections_until and says
-- so honestly in its own response: a Supreme member keeps the collection
-- afterwards, because the membership is what carries it.
--
-- Downgrading somebody's tier to take the collection away would also take the
-- rest of what they paid for, which is a different and much larger punishment.
-- So this is a separate flag, read before anything else: it removes the
-- collection and touches nothing else about the membership.
--
-- Held time is deliberately NOT cleared by the bar itself. The two are
-- separate actions, and keeping them separate is what lets the bar be undone:
-- lift it and a Supreme member has the collection again because they are still
-- paying for it. Studio's control does both at once where that is what she
-- wants, and that is a choice at the call site rather than a rule here.
--
-- No expiry, no ladder. Like the integrity block, this ends when she ends it.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS collections_barred_at     timestamptz,
  ADD COLUMN IF NOT EXISTS collections_barred_reason text;

-- Partial: the rows that matter are the few that are set.
CREATE INDEX IF NOT EXISTS users_collections_barred_idx
  ON users (collections_barred_at DESC)
  WHERE collections_barred_at IS NOT NULL;

COMMIT;

-- ── Check it took ───────────────────────────────────────────────────
-- Expect two rows, and 0 barred.

SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name IN ('collections_barred_at', 'collections_barred_reason')
 ORDER BY column_name;

SELECT COUNT(*) AS barred_now FROM users WHERE collections_barred_at IS NOT NULL;
