// backend/routes/extras.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { postSystemMessage } = require('./community');
const { getDiscountForTier, getGuestMultiplier } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');

async function pricingFor(basePrice, userTier) {
  if (userTier === 'guest') {
    const multiplier = await getGuestMultiplier();
    return roundTokensUp(basePrice * multiplier);
  }
  const discountPct = await getDiscountForTier(userTier);
  if (!discountPct) return roundTokensUp(basePrice);
  return roundTokensUp(basePrice * (1 - discountPct / 100));
}

// ─────────────────────────────────────────────
// GET /api/extras/options
// ─────────────────────────────────────────────

router.get('/options', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const discountPct = isActive ? await getDiscountForTier(userTier) : 0;

    const { rows: items } = await pool.query(
      `SELECT id, title, price_coins FROM extras_items WHERE visible = TRUE ORDER BY created_at ASC`
    );

    const options = await Promise.all(items.map(async (item) => ({
      id: item.id,
      title: item.title,
      coinsPerRequest: await pricingFor(item.price_coins, userTier),
    })));

    res.json({
      options,
      discountPct,
      isGuest:     userTier === 'guest',
      coinBalance: user.coin_balance,
    });
  } catch (err) {
    console.error('extras/options error:', err);
    res.status(500).json({ error: 'Failed to load extras options' });
  }
});

// ─────────────────────────────────────────────
// GET /api/extras/my-requests
// ─────────────────────────────────────────────

router.get('/my-requests', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, details, reference_url, coins_charged, status, rejection_reason, created_at
       FROM custom_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.userId]
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error('extras/my-requests error:', err);
    res.status(500).json({ error: 'Failed to load your requests' });
  }
});

// ─────────────────────────────────────────────
// POST /api/extras/request
// ─────────────────────────────────────────────

router.post('/request', authMid, async (req, res) => {
  const { extraItemId, details, referenceUrl } = req.body;

  if (!extraItemId)         return res.status(400).json({ error: 'extraItemId is required' });
  if (!details?.trim())     return res.status(400).json({ error: 'Please describe your request' });

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
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const fanLabel = user.display_name || 'A member';

    const { rows: itemRows } = await client.query(
      `SELECT * FROM extras_items WHERE id = $1 AND visible = TRUE FOR UPDATE`,
      [extraItemId]
    );
    if (!itemRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This request type is not available' });
    }
    const item = itemRows[0];
    const price = await pricingFor(item.price_coins, userTier);

    if (user.coin_balance < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `This request costs ${price} tokens. You have ${user.coin_balance}.`,
        required:  price,
        available: user.coin_balance,
        shortBy:   price - user.coin_balance,
      });
    }

    await client.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
      [price, req.user.userId]
    );

    const { rows: requestRows } = await client.query(
      `INSERT INTO custom_requests (user_id, type, details, reference_url, coins_charged, extra_item_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.userId, item.title, details.trim(), referenceUrl?.trim() || null, price, item.id]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
       VALUES ($1, 'custom_request', 'debit', $2, $3, $4)`,
      [req.user.userId, price, item.title, requestRows[0].id]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('custom_request', $1, $2)`,
      [req.user.userId, JSON.stringify({ title: item.title, details: details.trim(), referenceUrl: referenceUrl?.trim() || null, price, requestId: requestRows[0].id })]
    );

    await client.query('COMMIT');

    notifyArtist({
      title: 'New personalised request 🌟',
      body:  `${item.title} · ${price} tokens`,
      url:   '/requests',
    });

    postSystemMessage(`🌟 ${fanLabel} just requested a ${item.title}!`);

    res.json({
      ok:         true,
      requestId:  requestRows[0].id,
      coinsSpent: price,
      newBalance: user.coin_balance - price,
      message:    `Your ${item.title} request has been sent to Jinal.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('extras/request error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  } finally {
    client.release();
  }
});

module.exports = router;