// backend/routes/shop.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { postSystemMessage } = require('./community');
const { getDiscountForTier, getGuestMultiplier } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');
const { spendTokens } = require('../lib/tokens');

// ─────────────────────────────────────────────
// GET /api/shop/items
// ─────────────────────────────────────────────

router.get('/items', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance,
              shipping_name, shipping_phone, shipping_line1,
              shipping_city, shipping_state, shipping_pincode
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const discountPct = isActive ? await getDiscountForTier(userTier) : 0;

    const { rows: items } = await pool.query(
      `SELECT id, title, description, price_coins, remaining, img_key
       FROM merchandise WHERE visible = TRUE AND remaining > 0 AND is_auction_item = FALSE
       ORDER BY created_at DESC`
    );

    res.json({
      items,
      discountPct,
      isGuest:     userTier === 'guest',
      coinBalance: user.coin_balance,
      savedAddress: user.shipping_name ? {
        name:    user.shipping_name,
        phone:   user.shipping_phone,
        line1:   user.shipping_line1,
        city:    user.shipping_city,
        state:   user.shipping_state,
        pincode: user.shipping_pincode,
      } : null,
    });
  } catch (err) {
    console.error('shop/items error:', err);
    res.status(500).json({ error: 'Failed to load shop items' });
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/buy
// ─────────────────────────────────────────────

router.post('/buy', authMid, async (req, res) => {
  const { merchId, shipping, saveAddress } = req.body;

  if (!merchId) return res.status(400).json({ error: 'merchId is required' });
  if (!shipping?.name || !shipping?.phone || !shipping?.line1 || !shipping?.city || !shipping?.state || !shipping?.pincode) {
    return res.status(400).json({ error: 'Complete shipping address is required' });
  }

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
    const isGuest  = userTier === 'guest';
    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
    ]);

    const { rows: itemRows } = await client.query(
      `SELECT * FROM merchandise WHERE id = $1 FOR UPDATE`,
      [merchId]
    );
    if (!itemRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = itemRows[0];

    if (!item.visible) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item is no longer available' });
    }
    if (item.remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This item is out of stock' });
    }

    let price = item.price_coins;
    if (isGuest) {
      price = roundTokensUp(price * guestMultiplier);
    } else if (discountPct) {
      price = roundTokensUp(price * (1 - discountPct / 100));
    }

    await client.query(
      `UPDATE merchandise SET remaining = remaining - 1 WHERE id = $1`,
      [merchId]
    );

    if (saveAddress) {
      await client.query(
        `UPDATE users SET
           shipping_name    = $1, shipping_phone   = $2,
           shipping_line1   = $3, shipping_city    = $4,
           shipping_state   = $5, shipping_pincode = $6
         WHERE id = $7`,
        [shipping.name, shipping.phone, shipping.line1, shipping.city, shipping.state, shipping.pincode, req.user.userId]
      );
    }

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, merch_id, coins_charged, shipping_address)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.userId, merchId, price, JSON.stringify(shipping)]
    );

    // Physical goods carry a real cost, so gifted credit cannot be used here.
    try {
      await spendTokens(client, {
        userId:      req.user.userId,
        amount:      price,
        type:        'merch_purchase',
        label:       `Merchandise: ${item.title}`,
        relatedId:   orderRows[0].id,
        allowGifted: false,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        await client.query('ROLLBACK');
        return res.status(402).json(err.httpBody);
      }
      throw err;
    }

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('merch_order', $1, $2)`,
      [req.user.userId, JSON.stringify({ item: item.title, price, shipping, orderId: orderRows[0].id })]
    );

    await client.query('COMMIT');

    notifyArtist({
      title: 'New order 🛍️',
      body:  `${item.title} purchased · ${price} tokens · Ship to ${shipping.city}`,
      url:   '/merch',
    });

    postSystemMessage(`🛍️ ${fanLabel} just ordered "${item.title}"!`);

    res.json({
      ok:         true,
      orderId:    orderRows[0].id,
      coinsSpent: price,
      newBalance: user.coin_balance - price,
      message:    `Order placed for "${item.title}". Jinal will be in touch for delivery.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('shop/buy error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

module.exports = router;