// backend/routes/gallery.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { getGuestMultiplier, getDiscountForTier } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];
const TIER_CATEGORIES_IN_ORDER = ['free', 'community', 'insider', 'premium', 'supreme']; // purchase_only excluded — never tier-reachable

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

function meetsCategory(userTier, category) {
  if (category === 'free') return true;
  if (category === 'purchase_only') return false; // never reachable by tier, ever
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(category);
}

function applyDiscount(price, discountPct) {
  if (!discountPct) return Math.round(price);
  const raw = price * (1 - discountPct / 100);
  return raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
}

function isEffectivelyUnlocked(grantType, membershipCurrentlyActive) {
  if (!grantType) return false;
  if (grantType === 'unlock_credit') return membershipCurrentlyActive;
  return true; // 'token_purchase' and 'membership_free' are always permanent
}

// Given a set's items and a fan's tier, splits items into three buckets and computes
// proportional pricing for the tier-reachable portion and the upsell (higher-tier + purchase-only).
function computeSegments(items, userTier, basePrice, discountPct, isGuest, guestMultiplier) {
  const total = items.length || 1;

  const freeItems         = items.filter((i) => i.tier_category === 'free');
  const tierEligibleItems  = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && meetsCategory(userTier, i.tier_category));
  const higherTierItems    = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && !meetsCategory(userTier, i.tier_category));
  const purchaseOnlyItems  = items.filter((i) => i.tier_category === 'purchase_only');

  const tierPortionCount   = tierEligibleItems.length;
  const upsellPortionCount = higherTierItems.length + purchaseOnlyItems.length;

  const rawTierPrice   = basePrice * (tierPortionCount / total);
  const rawUpsellPrice = basePrice * (upsellPortionCount / total);

  const tierPrice   = isGuest ? Math.round(rawTierPrice * guestMultiplier)   : applyDiscount(rawTierPrice, discountPct);
  const upsellPrice = isGuest ? Math.round(rawUpsellPrice * guestMultiplier) : applyDiscount(rawUpsellPrice, discountPct);

  return {
    freeCount: freeItems.length,
    tierPortionCount,
    upsellPortionCount,
    hasUpsell: upsellPortionCount > 0,
    tierPrice,
    upsellPrice,
  };
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
    const [guestMultiplier, discountPct] = await Promise.all([
      isGuest ? getGuestMultiplier() : 1,
      isGuest ? 0 : getDiscountForTier(userTier),
    ]);

    const { rows: sets } = await pool.query(
      `SELECT id, title, description, type, price_coins, cover_key, created_at
       FROM sets WHERE visible = TRUE ORDER BY created_at DESC`
    );

    const { rows: allItems } = await pool.query(
      `SELECT set_id, media_type, tier_category FROM set_items`
    );
    const itemsBySet = {};
    allItems.forEach((item) => {
      if (!itemsBySet[item.set_id]) itemsBySet[item.set_id] = [];
      itemsBySet[item.set_id].push(item);
    });

    const { rows: grants } = await pool.query(
      `SELECT set_id, scope, grant_type FROM access_grants WHERE user_id = $1`,
      [req.user.userId]
    );
    const grantsBySet = {};
    grants.forEach((g) => {
      if (!grantsBySet[g.set_id]) grantsBySet[g.set_id] = {};
      grantsBySet[g.set_id][g.scope] = g.grant_type;
    });

    const setsWithData = sets.map((s) => {
      const items = itemsBySet[s.id] || [];
      const counts = { photos: 0, videos: 0 };
      items.forEach((i) => { if (i.media_type === 'video') counts.videos++; else counts.photos++; });

      const segments = computeSegments(items, userTier, s.price_coins, discountPct, isGuest, guestMultiplier);

      const tierGrant   = grantsBySet[s.id]?.tier;
      const upsellGrant = grantsBySet[s.id]?.upsell;

      const tierUnlocked   = tierGrant && isEffectivelyUnlocked(tierGrant, isActive);
      const tierLapsed     = tierGrant === 'unlock_credit' && !isActive;
      const upsellUnlocked = upsellGrant && isEffectivelyUnlocked(upsellGrant, true); // upsell is always permanent once granted

      const guestBuyout = Math.round(s.price_coins * guestMultiplier);

      return {
        id: s.id,
        title: s.title,
        description: s.description,
        type: s.type,
        cover_url: toUrl(s.cover_key),
        photoCount: counts.photos,
        videoCount: counts.videos,
        isFreeForAll: items.length > 0 && items.every((i) => i.tier_category === 'free'),

        freeCount: segments.freeCount,
        tierPortionCount: segments.tierPortionCount,
        hasUpsell: segments.hasUpsell,
        upsellPortionCount: segments.upsellPortionCount,

        tierUnlocked: !!tierUnlocked,
        tierLapsed: !!tierLapsed,
        upsellUnlocked: !!upsellUnlocked,

        tierPrice: segments.tierPrice,
        upsellPrice: segments.upsellPrice,
        guestBuyout,

        coverBlurred: !tierUnlocked && segments.freeCount === 0,
      };
    });

    const freeForAll  = setsWithData.filter((s) => s.isFreeForAll);
    const unlockable   = setsWithData.filter((s) => !s.isFreeForAll);

    res.json({
      freeForAll,
      unlockable,
      userTier,
      isGuest,
      discountPct,
      coinBalance: user.coin_balance,
    });
  } catch (err) {
    console.error('gallery/sets error:', err);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/unlock
// Body: { setId, scope: 'tier' | 'upsell' }
// ─────────────────────────────────────────────

router.post('/unlock', authMid, async (req, res) => {
  const { setId, scope } = req.body;
  if (!setId) return res.status(400).json({ error: 'setId is required' });
  if (!['tier', 'upsell'].includes(scope)) return res.status(400).json({ error: 'scope must be "tier" or "upsell"' });

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

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

    const { rows: setRows } = await client.query(`SELECT * FROM sets WHERE id = $1 AND visible = TRUE`, [setId]);
    if (!setRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }
    const set = setRows[0];

    const { rows: itemRows } = await client.query(`SELECT media_type, tier_category FROM set_items WHERE set_id = $1`, [setId]);
    const segments = computeSegments(itemRows, userTier, set.price_coins, discountPct, isGuest, guestMultiplier);

    if (scope === 'upsell' && !segments.hasUpsell) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'There is nothing further to unlock in this set' });
    }

    const { rows: existingGrants } = await client.query(
      `SELECT id, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2 AND scope = $3`,
      [req.user.userId, setId, scope]
    );
    const existing = existingGrants[0];

    // Already permanently unlocked for this scope — nothing to do
    if (existing && isEffectivelyUnlocked(existing.grant_type, scope === 'upsell' ? true : isActive) && existing.grant_type !== 'unlock_credit') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }
    if (existing && existing.grant_type === 'unlock_credit' && isActive) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }

    let useCredit = false;
    let price = scope === 'tier' ? segments.tierPrice : segments.upsellPrice;

    // Credit is only ever applicable to the 'tier' scope — upsell is always a genuine purchase
    if (scope === 'tier' && segments.tierPortionCount > 0) {
      const { getGalleryUnlocksForTier } = require('../lib/config');
      const monthKey   = now.toISOString().slice(0, 7);
      const maxUnlocks = await getGalleryUnlocksForTier(userTier);
      const { rows: allotRows } = await client.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      const used = allotRows[0]?.unlocks_used || 0;
      if (used < maxUnlocks) {
        useCredit = true;
        price = 0;
        await client.query(
          `INSERT INTO monthly_allotments (user_id, month_key, unlocks_used)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, month_key)
           DO UPDATE SET unlocks_used = monthly_allotments.unlocks_used + 1`,
          [req.user.userId, monthKey]
        );
      }
    }

    if (price > 0 && user.coin_balance < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `Unlocking this costs ${price} tokens. You have ${user.coin_balance}.`,
        required: price, available: user.coin_balance,
      });
    }

    if (price > 0) {
      await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [price, req.user.userId]);
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'content_unlock', 'debit', $2, $3, $4)`,
        [req.user.userId, price, `Content unlock: ${set.title} (${scope})`, setId]
      );
    }

    const grantType = useCredit ? 'unlock_credit' : 'token_purchase';

    if (existing) {
      await client.query(
        `UPDATE access_grants SET grant_type = $1, coins_paid = $2, granted_at = NOW() WHERE id = $3`,
        [grantType, price, existing.id]
      );
    } else {
      await client.query(
        `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid, scope)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, setId, grantType, price, scope]
      );
    }

    await client.query('COMMIT');

    postSystemMessage(`🔓 ${fanLabel} unlocked "${set.title}"!`);

    res.json({ ok: true, coinsSpent: price, usedCredit: useCredit, newBalance: user.coin_balance - price, scope });
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
// Returns only items the fan currently has legitimate access to
// ─────────────────────────────────────────────

router.get('/sets/:setId/items', authMid, async (req, res) => {
  const { setId } = req.params;
  try {
    const { rows: userRows } = await pool.query(`SELECT tier, membership_expires_at FROM users WHERE id = $1`, [req.user.userId]);
    const now = new Date();
    const isActive = userRows[0]?.membership_expires_at && new Date(userRows[0].membership_expires_at) > now;
    const userTier = isActive ? userRows[0].tier : 'guest';

    const { rows: grants } = await pool.query(
      `SELECT scope, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    const tierGrant   = grants.find((g) => g.scope === 'tier');
    const upsellGrant = grants.find((g) => g.scope === 'upsell');
    const tierUnlocked   = tierGrant && isEffectivelyUnlocked(tierGrant.grant_type, isActive);
    const upsellUnlocked = upsellGrant && isEffectivelyUnlocked(upsellGrant.grant_type, true);

    const { rows: items } = await pool.query(
      `SELECT id, r2_key, media_type, position, tier_category
       FROM set_items WHERE set_id = $1 ORDER BY position ASC, created_at ASC`,
      [setId]
    );

    const visibleItems = items.filter((item) => {
      if (item.tier_category === 'free') return true;
      if (item.tier_category === 'purchase_only') return upsellUnlocked;
      const isTierReachable = meetsCategory(userTier, item.tier_category);
      if (isTierReachable) return tierUnlocked;
      return upsellUnlocked; // higher-tier item, only visible if the upsell was bought
    });

    if (visibleItems.length === 0 && items.length > 0) {
      return res.status(403).json({ error: 'Access not granted' });
    }

    const itemsWithUrls = visibleItems.map((item) => ({ ...item, media_url: toUrl(item.r2_key) }));
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
    const { rows: items } = await client.query(`SELECT r2_key FROM set_items WHERE set_id = $1`, [setId]);
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