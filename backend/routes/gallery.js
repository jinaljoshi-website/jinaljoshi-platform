// backend/routes/gallery.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { getGalleryUnlocksForTier, getGuestMultiplier, getDiscountForTier } = require('../lib/config');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

function meetsCategory(userTier, minTier) {
  if (!minTier || minTier === 'none') return true;
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(minTier);
}

function applyDiscount(price, discountPct) {
  if (!discountPct) return Math.round(price);
  const raw = price * (1 - discountPct / 100);
  return raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
}

// Grants made with a monthly unlock credit are tied to an active membership —
// if it lapses, this content re-locks. Token purchases and free grants are always permanent.
function isEffectivelyUnlocked(grantType, membershipCurrentlyActive) {
  if (!grantType) return false;
  if (grantType === 'unlock_credit') return membershipCurrentlyActive;
  return true; // 'token_purchase' and 'membership_free' are always permanent
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
    const isGuest   = userTier === 'guest';
    const [guestMultiplier, discountPct, supremeDiscountPct] = await Promise.all([
      isGuest ? getGuestMultiplier() : 1,
      isGuest ? 0 : getDiscountForTier(userTier),
      getDiscountForTier('supreme'),
    ]);

    const monthKey    = now.toISOString().slice(0, 7);
    const maxUnlocks  = await getGalleryUnlocksForTier(userTier);
    let creditsUsed   = 0;
    if (maxUnlocks > 0) {
      const { rows: allotRows } = await pool.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      creditsUsed = allotRows[0]?.unlocks_used || 0;
    }
    const creditsRemaining = Math.max(0, maxUnlocks - creditsUsed);

    const { rows: sets } = await pool.query(
      `SELECT s.id, s.title, s.description, s.type, s.price_coins, s.min_tier, s.use_unlock_credit, s.cover_key,
              ag.id AS grant_id, ag.grant_type
       FROM sets s
       LEFT JOIN access_grants ag ON ag.set_id = s.id AND ag.user_id = $1
       WHERE s.visible = TRUE
       ORDER BY s.created_at DESC`,
      [req.user.userId]
    );

    const { rows: itemCounts } = await pool.query(
      `SELECT set_id, media_type, COUNT(*) AS count
       FROM set_items
       GROUP BY set_id, media_type`
    );
    const countsBySet = {};
    itemCounts.forEach((row) => {
      if (!countsBySet[row.set_id]) countsBySet[row.set_id] = { photos: 0, videos: 0 };
      if (row.media_type === 'video') countsBySet[row.set_id].videos += parseInt(row.count);
      else countsBySet[row.set_id].photos += parseInt(row.count);
    });

    const setsWithUrls = sets.map((s) => {
      // A grant existing doesn't automatically mean it's currently viewable —
      // credit-based unlocks require the membership that earned them to still be active
      const hasEverUnlocked = !!s.grant_id;
      const currentlyUnlocked = hasEverUnlocked && isEffectivelyUnlocked(s.grant_type, isActive);
      const lapsedCreditUnlock = hasEverUnlocked && s.grant_type === 'unlock_credit' && !isActive;

      const qualifiesForCategory = meetsCategory(userTier, s.min_tier);
      const isPurchaseOnly = !s.use_unlock_credit && s.price_coins > 0;
      const creditEligible = !currentlyUnlocked
        && s.price_coins > 0
        && s.use_unlock_credit
        && qualifiesForCategory
        && creditsRemaining > 0;

      const displayPrice = isGuest
        ? Math.round(s.price_coins * guestMultiplier)
        : applyDiscount(s.price_coins, discountPct);
      const bestMemberPrice = applyDiscount(s.price_coins, supremeDiscountPct);

      const counts = countsBySet[s.id] || { photos: 0, videos: 0 };

      return {
        ...s,
        cover_url: toUrl(s.cover_key),
        already_unlocked: currentlyUnlocked ? s.grant_id : null,
        lapsedCreditUnlock, // lets the frontend show "renew to restore access" instead of the generic locked state
        creditEligible,
        displayPrice,
        bestMemberPrice,
        photoCount: counts.photos,
        videoCount: counts.videos,
        isFreeForAll: s.price_coins === 0 && (s.min_tier === 'none' || s.min_tier === null),
        coverBlurred: !currentlyUnlocked && (!qualifiesForCategory || isPurchaseOnly || lapsedCreditUnlock),
        unlocksFreeAtHigherTier: !isPurchaseOnly && !qualifiesForCategory && s.min_tier && s.min_tier !== 'none',
      };
    });

    const freeForAll = setsWithUrls.filter((s) => s.isFreeForAll);
    const unlockable  = setsWithUrls.filter((s) => !s.isFreeForAll);

    res.json({
      freeForAll,
      unlockable,
      userTier,
      isGuest,
      discountPct,
      coinBalance:     user.coin_balance,
      creditsRemaining,
      creditsMax:      maxUnlocks,
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance, display_name FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const isGuest   = userTier === 'guest';
    const fanLabel  = user.display_name || 'A member';
    const [guestMultiplier, discountPct] = await Promise.all([
      isGuest ? getGuestMultiplier() : 1,
      isGuest ? 0 : getDiscountForTier(userTier),
    ]);

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
      `SELECT id, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    // A previous credit-based unlock that's since lapsed is allowed to be re-unlocked
    // (e.g. paid for outright, or covered by a fresh credit) rather than staying stuck
    const hasPermanentGrant = existing.length && isEffectivelyUnlocked(existing[0].grant_type, true) && existing[0].grant_type !== 'unlock_credit';
    if (hasPermanentGrant) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }
    const hasActiveCreditGrant = existing.length && existing[0].grant_type === 'unlock_credit' && isActive;
    if (hasActiveCreditGrant) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }

    if (set.price_coins === 0 && (set.min_tier === 'none' || meetsCategory(userTier, set.min_tier))) {
      if (!existing.length) {
        await client.query(
          `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid)
           VALUES ($1, $2, 'membership_free', 0)`,
          [req.user.userId, setId]
        );
      }
      await client.query('COMMIT');
      postSystemMessage(`🔓 ${fanLabel} unlocked "${set.title}"!`);
      return res.json({ ok: true, coinsSpent: 0, grantType: 'membership_free' });
    }

    let useUnlockCredit = false;
    if (set.price_coins > 0 && set.use_unlock_credit && meetsCategory(userTier, set.min_tier)) {
      const monthKey   = now.toISOString().slice(0, 7);
      const maxUnlocks = await getGalleryUnlocksForTier(userTier);
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
      }
    }

    const basePrice = isGuest
      ? Math.round(set.price_coins * guestMultiplier)
      : applyDiscount(set.price_coins, discountPct);
    const price = useUnlockCredit ? 0 : basePrice;

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

    const newGrantType = useUnlockCredit ? 'unlock_credit' : 'token_purchase';

    if (existing.length) {
      // Upgrading a lapsed credit-based grant to a permanent one (e.g. bought outright) —
      // update in place rather than violate the one-grant-per-set-per-user constraint
      await client.query(
        `UPDATE access_grants SET grant_type = $1, coins_paid = $2, granted_at = NOW() WHERE id = $3`,
        [newGrantType, price, existing[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, setId, newGrantType, price]
      );
    }

    await client.query('COMMIT');

    postSystemMessage(`🔓 ${fanLabel} unlocked "${set.title}"!`);

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
    const { rows: userRows } = await pool.query(
      `SELECT membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const isActive = userRows[0]?.membership_expires_at && new Date(userRows[0].membership_expires_at) > new Date();

    const { rows: accessRows } = await pool.query(
      `SELECT id, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );

    if (!accessRows.length || !isEffectivelyUnlocked(accessRows[0].grant_type, isActive)) {
      return res.status(403).json({
        error: !accessRows.length ? 'Access not granted' : 'LAPSED_MEMBERSHIP',
        message: accessRows.length ? 'This was unlocked with your membership credit — renew your membership to view it again.' : undefined,
      });
    }

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
// ─────────────────────────────────────────────

router.delete('/sets/:setId', authMid, async (req, res) => {
  if (req.user.email !== process.env.ARTIST_EMAIL) {
    return res.status(403).json({ error: 'Not authorised' });
  }

  const { setId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query(
      `SELECT r2_key FROM set_items WHERE set_id = $1`, [setId]
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