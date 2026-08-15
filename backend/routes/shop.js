// backend/routes/shop.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { postSystemMessage } = require('./community');
const { getDiscountForTier, getGuestMultiplier } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');
const { spendTokens, getBalances } = require('../lib/tokens');

// ─────────────────────────────────────────────
// GET /api/shop/items
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// THE DROP
// ─────────────────────────────────────────────

router.get('/drop', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM platform_config WHERE key LIKE 'merch_drop%'`
    );
    const cfg = {};
    rows.forEach((r) => { cfg[r.key] = r.value; });
    const dropKey = cfg.merch_drop_key || '';

    const [mine, total] = await Promise.all([
      pool.query(`SELECT 1 FROM merch_drop_interest WHERE user_id = $1 AND drop_key = $2`,
                 [req.user.userId, dropKey]),
      pool.query(`SELECT count(*)::int AS n FROM merch_drop_interest WHERE drop_key = $1`, [dropKey]),
    ]);

    res.json({
      active:    cfg.merch_drop_active === 'true',
      dropKey,
      label:     cfg.merch_drop_label   || 'The next edition',
      opensOn:   cfg.merch_drop_opens_on || null,
      onList:    mine.rows.length > 0,
      // Shown only once enough people are waiting for it to read as interest
      // rather than as an empty room.
      waiting:   total.rows[0].n >= 5 ? total.rows[0].n : null,
    });
  } catch (err) {
    console.error('shop/drop error:', err);
    res.status(500).json({ error: 'Could not load the drop' });
  }
});

router.post('/drop/notify', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'merch_drop_key'`);
    const dropKey = rows[0]?.value;
    if (!dropKey) return res.status(503).json({ error: 'No drop is scheduled' });

    const { leave } = req.body;
    if (leave) {
      await pool.query(`DELETE FROM merch_drop_interest WHERE user_id = $1 AND drop_key = $2`,
                       [req.user.userId, dropKey]);
      return res.json({ ok: true, onList: false });
    }

    await pool.query(
      `INSERT INTO merch_drop_interest (user_id, drop_key) VALUES ($1, $2)
       ON CONFLICT (user_id, drop_key) DO NOTHING`,
      [req.user.userId, dropKey]
    );
    res.json({ ok: true, onList: true });
  } catch (err) {
    console.error('shop/drop/notify error:', err);
    res.status(500).json({ error: 'Could not add you to the list' });
  }
});

// ─────────────────────────────────────────────
// SHOP
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
      `SELECT m.id, m.title, m.description, m.price_coins, m.remaining, m.img_key,
              COALESCE(
                (SELECT json_agg(mi.url ORDER BY mi.position)
                 FROM merchandise_images mi WHERE mi.merch_id = m.id),
                CASE WHEN m.img_key IS NULL THEN '[]'::json ELSE json_build_array(m.img_key) END
              ) AS images
       FROM merchandise m
       WHERE m.visible = TRUE AND m.remaining > 0 AND m.is_auction_item = FALSE
       ORDER BY m.created_at DESC`
    );

    const bal = await getBalances(pool, req.user.userId);

    res.json({
      items,
      discountPct,
      isGuest:     userTier === 'guest',
      // Merchandise takes purchased tokens only, so coinBalance stays the purchased
      // figure. The gifted balance is sent alongside purely so the shop can explain
      // why a fan holding gifted credit still cannot buy anything here.
      coinBalance:   user.coin_balance,
      giftedBalance: bal.gifted,
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
    let spend;
    try {
      spend = await spendTokens(client, {
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

    postSystemMessage(`🛍️ ${fanLabel} just ordered "${item.title}"!`, { kind: 'activity', name: fanLabel });

    res.json({
      ok:         true,
      orderId:    orderRows[0].id,
      coinsSpent: price,
      // Read back from the spend rather than subtracted from what was loaded
      // earlier. A spend can draw on bonus tokens, which do not sit in
      // coin_balance, so subtracting the whole cost from it reported a balance
      // lower than the fan actually holds until something forced a refresh.
      newBalance: spend.newPurchased,
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