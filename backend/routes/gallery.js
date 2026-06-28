// backend/routes/gallery.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

// ─────────────────────────────────────────────
// GET /api/gallery/sets
// ─────────────────────────────────────────────

router.get('/sets', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const discountMap = { community: 5, insider: 10, premium: 15, supreme: 20 };
    const discountPct = discountMap[userTier] || 0;

    const { rows: sets } = await pool.query(
      `SELECT s.id, s.title, s.type, s.price_coins, s.min_tier, s.use_unlock_credit, s.cover_key,
              ag.id AS already_unlocked
       FROM sets s
       LEFT JOIN access_grants ag ON ag.set_id = s.id AND ag.user_id = $1
       WHERE s.visible = TRUE
       ORDER BY s.created_at DESC`,
      [req.user.userId]
    );

    // Convert cover_key to full URL
    const setsWithUrls = sets.map((s) => ({
      ...s,
      cover_url: toUrl(s.cover_key),
    }));

    res.json({
      sets: setsWithUrls,
      userTier,
      discountPct,
      isGuest:     userTier === 'guest',
      coinBalance: user.coin_balance,
    });
  } catch (err) {
    console.error('gallery/sets error:', err);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/unlock
// ─────────────────────────────────────────────

router.post('/unlock', authMid, async (req, res) => {
  const { setId } = req.body;
  if (!setId) return res.status(400).json({ error: 'setId is required' });

  const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';

    const { rows: setRows } = await client.query(
      `SELECT * FROM sets WHERE id = $1 AND visible = TRUE`,
      [setId]
    );
    if (!setRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }
    const set = setRows[0];

    const { rows: existing } = await client.query(
      `SELECT id FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }

    const minTierIdx  = TIER_ORDER.indexOf(set.min_tier === 'none' ? 'guest' : set.min_tier);
    const userTierIdx = TIER_ORDER.indexOf(userTier);
    if (userTierIdx < minTierIdx) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error:   'TIER_REQUIRED',
        message: `This content requires a ${set.min_tier} membership or higher.`,
      });
    }

    // Free for members or free for all
    if (set.price_coins === 0 && (userTier !== 'guest' || set.min_tier === 'none')) {
      await client.query(
        `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid)
         VALUES ($1, $2, 'membership_free', 0)`,
        [req.user.userId, setId]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, coinsSpent: 0, grantType: 'membership_free' });
    }

    const discountMap = { community: 5, insider: 10, premium: 15, supreme: 20 };
    const discountPct = discountMap[userTier] || 0;
    let price = set.price_coins;

    if (userTier === 'guest') {
      price = price === 0 ? 5 : price * 2;
    } else if (discountPct && price > 0) {
      const raw = price * (1 - discountPct / 100);
      price = raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
    }

    let useUnlockCredit = false;
    if (userTier !== 'guest' && set.use_unlock_credit && price > 0) {
      const monthKey = now.toISOString().slice(0, 7);
      const tierUnlocks = { community: 1, insider: 4, premium: 7, supreme: 10 };
      const maxUnlocks  = tierUnlocks[userTier] || 0;
      const { rows: allotRows } = await client.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      const used = allotRows[0]?.unlocks_used || 0;
      if (used < maxUnlocks) {
        useUnlockCredit = true;
        await client.query(
          `INSERT INTO monthly_allotments (user_id, month_key, unlocks_used)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, month_key)
           DO UPDATE SET unlocks_used = monthly_allotments.unlocks_used + 1`,
          [req.user.userId, monthKey]
        );
        price = 0;
      }
    }

    if (price > 0 && user.coin_balance < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `Unlocking this costs ${price} tokens. You have ${user.coin_balance}.`,
        required:  price,
        available: user.coin_balance,
        shortBy:   price - user.coin_balance,
      });
    }

    if (price > 0) {
      await client.query(
        `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
        [price, req.user.userId]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'content_unlock', 'debit', $2, $3, $4)`,
        [req.user.userId, price, `Content unlock: ${set.title}`, setId]
      );
    }

    await client.query(
      `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid)
       VALUES ($1, $2, $3, $4)`,
      [req.user.userId, setId, useUnlockCredit ? 'unlock_credit' : 'token_purchase', price]
    );

    await client.query('COMMIT');

    res.json({
      ok:         true,
      coinsSpent: price,
      usedCredit: useUnlockCredit,
      newBalance: user.coin_balance - price,
      grantType:  useUnlockCredit ? 'unlock_credit' : price === 0 ? 'membership_free' : 'token_purchase',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gallery/unlock error:', err);
    res.status(500).json({ error: 'Unlock failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// GET /api/gallery/sets/:setId/items
// ─────────────────────────────────────────────

router.get('/sets/:setId/items', authMid, async (req, res) => {
  const { setId } = req.params;
  try {
    // Check access grant
    const { rows: accessRows } = await pool.query(
      `SELECT id FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );

    if (!accessRows.length) {
      // Check if set is free for this user
      const { rows: setRows } = await pool.query(
        `SELECT price_coins, min_tier FROM sets WHERE id = $1 AND visible = TRUE`,
        [setId]
      );
      if (!setRows.length) return res.status(404).json({ error: 'Set not found' });

      const set = setRows[0];
      const { rows: userRows } = await pool.query(
        `SELECT tier, membership_expires_at FROM users WHERE id = $1`,
        [req.user.userId]
      );
      const user     = userRows[0];
      const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
      const userTier = isActive ? user.tier : 'guest';

      const isFreeForAll    = set.price_coins === 0 && set.min_tier === 'none';
      const isFreeForMember = set.price_coins === 0 && userTier !== 'guest';

      if (!isFreeForAll && !isFreeForMember) {
        return res.status(403).json({ error: 'Access not granted' });
      }
    }

    // Fetch items — use r2_key and convert to URL
    const { rows: items } = await pool.query(
      `SELECT id, r2_key, media_type, position
       FROM set_items WHERE set_id = $1
       ORDER BY position ASC, created_at ASC`,
      [setId]
    );

    const itemsWithUrls = items.map((item) => ({
      ...item,
      media_url: toUrl(item.r2_key),
    }));

    res.json({ items: itemsWithUrls });
  } catch (err) {
    console.error('gallery/items error:', err);
    res.status(500).json({ error: 'Failed to load set items' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/gallery/sets/:setId
// Artist only — delete a set and all its items
// ─────────────────────────────────────────────

router.delete('/sets/:setId', authMid, async (req, res) => {
  // Only artist can delete
  if (req.user.email !== process.env.ARTIST_EMAIL) {
    return res.status(403).json({ error: 'Not authorised' });
  }

  const { setId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get all item r2_keys for deletion reference (R2 deletion handled by Studio frontend)
    const { rows: items } = await client.query(
      `SELECT r2_key FROM set_items WHERE set_id = $1`,
      [setId]
    );

    await client.query(`DELETE FROM set_items WHERE set_id = $1`, [setId]);
    await client.query(`DELETE FROM access_grants WHERE set_id = $1`, [setId]);
    await client.query(`DELETE FROM sets WHERE id = $1`, [setId]);

    await client.query('COMMIT');

    res.json({ ok: true, deletedItems: items.length, r2Keys: items.map((i) => i.r2_key) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gallery/delete error:', err);
    res.status(500).json({ error: 'Failed to delete set' });
  } finally {
    client.release();
  }
});

module.exports = router;