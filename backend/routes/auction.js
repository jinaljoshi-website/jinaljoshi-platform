// backend/routes/auction.js
// The "Shoot Wardrobe" auction system — a dedicated section inside Merchandise.
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { pushToUser } = require('./push');
const { postSystemMessage } = require('./community');
const { getDiscountForTier, getGuestMultiplier, getConfigNumber } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');

const SHIPPING_FEE = 5; // "Handling & Packaging Fee" — Buy Now only, not auction wins

const CHARITIES = {
  cry:                    'CRY — Child Rights and You',
  akshaya_patra:          'Akshaya Patra Foundation',
  smile_foundation:       'Smile Foundation',
  pmnrf:                  "Prime Minister's National Relief Fund",
  national_defence_fund:  'National Defence Fund',
};

function buyNowPrice(item, discountEnabled, discountPct) {
  const base = item.current_highest_bid
    ? Math.ceil(item.current_highest_bid * 1.75)
    : Math.ceil(item.price_coins * 1.5);
  // The blanket promotional discount only ever applies to queued items, never the
  // currently-active auction item, whose Buy Now price is already live-computed from real bids.
  if (item.auction_status !== 'active' && discountEnabled && discountPct > 0) {
    return Math.ceil(base * (1 - discountPct / 100));
  }
  return base;
}

// ─────────────────────────────────────────────
// GET /api/shop/auction
// ─────────────────────────────────────────────

router.get('/', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const isGuest  = userTier === 'guest';
    const [discountPct, guestMultiplier, discountEnabled, discountToggleValue] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
      getConfigNumber('merch_discount_enabled'),
      getConfigNumber('merch_discount_pct'),
    ]);

    const { rows: items } = await pool.query(
      `SELECT id, title, description, img_key, price_coins, csr_pct, auction_status,
              current_highest_bid, current_highest_bidder_id, auction_started_at,
              winner_id, won_at
       FROM merchandise
       WHERE is_auction_item = TRUE AND visible = TRUE AND auction_status != 'sold'
       ORDER BY (auction_status = 'active') DESC, had_auction_turn ASC, COALESCE(went_unsold_at, created_at) ASC`
    );

    const applyGuestOrDiscount = (price) => {
      if (isGuest) return Math.ceil(price * guestMultiplier);
      if (discountPct) return Math.ceil(price * (1 - discountPct / 100));
      return price;
    };

    const shaped = items.map((item) => {
      const rawBuyNow = buyNowPrice(item, !!discountEnabled, discountToggleValue || 0);
      const isMine    = item.current_highest_bidder_id === req.user.userId;
      return {
        id: item.id, title: item.title, description: item.description, img_key: item.img_key,
        csrPct: item.csr_pct, status: item.auction_status,
        currentBid: item.current_highest_bid,
        isHighBidder: isMine,
        buyNowPrice: applyGuestOrDiscount(rawBuyNow),
        secondsRemaining: item.auction_status === 'active' && item.auction_started_at
          ? Math.max(0, 259200 - Math.floor((now - new Date(item.auction_started_at)) / 1000)) // 72h
          : null,
        isMyWin: item.winner_id === req.user.userId,
        wonAt: item.won_at,
      };
    });

    res.json({
      items: shaped, isGuest, coinBalance: user.coin_balance,
      charities: Object.entries(CHARITIES).map(([key, name]) => ({ key, name })),
    });
  } catch (err) {
    console.error('auction/get error:', err);
    res.status(500).json({ error: 'Failed to load auction' });
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/bid
// ─────────────────────────────────────────────

router.post('/bid', authMid, async (req, res) => {
  const { itemId, amount } = req.body;
  if (!itemId || !amount) return res.status(400).json({ error: 'itemId and amount are required' });

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

    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'MEMBERSHIP_REQUIRED', message: 'Bidding is a membership benefit — join a plan to place a bid.' });
    }

    const { rows: itemRows } = await client.query(
      `SELECT * FROM merchandise WHERE id = $1 AND is_auction_item = TRUE FOR UPDATE`,
      [itemId]
    );
    if (!itemRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
    const item = itemRows[0];

    if (item.auction_status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This item is not currently open for bidding' });
    }

    const startingBid = Math.ceil(item.price_coins * 0.8);
    const minBid = item.current_highest_bid ? item.current_highest_bid + 1 : startingBid;

    if (amount < minBid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Bid must be at least ${minBid} tokens` });
    }
    if (user.coin_balance < amount) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'INSUFFICIENT_TOKENS', message: `This bid requires ${amount} tokens. You have ${user.coin_balance}.`, required: amount, available: user.coin_balance });
    }

    await client.query(
      `INSERT INTO merch_bids (merch_id, user_id, amount) VALUES ($1, $2, $3)`,
      [itemId, req.user.userId, amount]
    );
    await client.query(
      `UPDATE merchandise SET current_highest_bid = $1, current_highest_bidder_id = $2 WHERE id = $3`,
      [amount, req.user.userId, itemId]
    );

    await client.query('COMMIT');

    postSystemMessage(`💫 A new bid just came in on this week's Shoot Wardrobe item!`);
    notifyArtist({ title: 'New auction bid', body: `${user.display_name || 'A member'} bid ${amount} tokens on "${item.title}"`, url: '/merch' });

    res.json({ ok: true, currentBid: amount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('auction/bid error:', err);
    res.status(500).json({ error: 'Failed to place bid' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/buy-now
// ─────────────────────────────────────────────

router.post('/buy-now', authMid, async (req, res) => {
  const { itemId, shipping, saveAddress } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId is required' });
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
    const isGuest  = userTier === 'guest';
    const [discountPct, guestMultiplier, discountEnabled, discountToggleValue] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
      getConfigNumber('merch_discount_enabled'),
      getConfigNumber('merch_discount_pct'),
    ]);

    const { rows: itemRows } = await client.query(
      `SELECT * FROM merchandise WHERE id = $1 AND is_auction_item = TRUE FOR UPDATE`,
      [itemId]
    );
    if (!itemRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
    const item = itemRows[0];

    if (!['queued', 'active'].includes(item.auction_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This item is no longer available' });
    }

    const rawPrice  = buyNowPrice(item, !!discountEnabled, discountToggleValue || 0);
    const withGuest = isGuest ? Math.ceil(rawPrice * guestMultiplier) : (discountPct ? Math.ceil(rawPrice * (1 - discountPct / 100)) : rawPrice);
    const finalPrice = withGuest + SHIPPING_FEE;

    if (user.coin_balance < finalPrice) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'INSUFFICIENT_TOKENS', message: `This costs ${finalPrice} tokens (incl. handling & packaging). You have ${user.coin_balance}.`, required: finalPrice, available: user.coin_balance });
    }

    const wasActive = item.auction_status === 'active';

    await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [finalPrice, req.user.userId]);
    await client.query(
      `UPDATE merchandise SET auction_status = 'sold', sold_price_coins = $1, sold_via = 'buy_now',
              winner_id = $2, had_auction_turn = TRUE WHERE id = $3`,
      [withGuest, req.user.userId, itemId]
    );

    if (saveAddress) {
      await client.query(
        `UPDATE users SET shipping_name=$1, shipping_phone=$2, shipping_line1=$3, shipping_city=$4, shipping_state=$5, shipping_pincode=$6 WHERE id=$7`,
        [shipping.name, shipping.phone, shipping.line1, shipping.city, shipping.state, shipping.pincode, req.user.userId]
      );
    }

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, merch_id, coins_charged, shipping_address) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.userId, itemId, finalPrice, JSON.stringify(shipping)]
    );
    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id) VALUES ($1, 'merch_purchase', 'debit', $2, $3, $4)`,
      [req.user.userId, finalPrice, `Shoot Wardrobe (Buy Now): ${item.title}`, orderRows[0].id]
    );

    await client.query('COMMIT');

    notifyArtist({ title: 'Shoot Wardrobe — Buy Now', body: `"${item.title}" bought instantly for ${withGuest} tokens`, url: '/merch' });

    // If this was the active auction slot, it's now empty — promote the next item immediately.
    if (wasActive) await promoteNextItem();

    res.json({ ok: true, orderId: orderRows[0].id, price: withGuest, newBalance: user.coin_balance - finalPrice, message: `You bought "${item.title}"! Choose a charity below to complete your contribution.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('auction/buy-now error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/claim  (winner pays for their won bid)
// ─────────────────────────────────────────────

router.post('/claim', authMid, async (req, res) => {
  const { itemId } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query(`SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`, [req.user.userId]);
    const user = userRows[0];

    const { rows: itemRows } = await client.query(`SELECT * FROM merchandise WHERE id = $1 FOR UPDATE`, [itemId]);
    if (!itemRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
    const item = itemRows[0];

    if (item.auction_status !== 'awaiting_payment' || item.winner_id !== req.user.userId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You do not have a pending win to claim on this item' });
    }

    const price = item.current_highest_bid;
    if (user.coin_balance < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'INSUFFICIENT_TOKENS', message: `Claiming this costs ${price} tokens. You have ${user.coin_balance}.`, required: price, available: user.coin_balance });
    }

    await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [price, req.user.userId]);
    await client.query(`UPDATE merchandise SET auction_status = 'sold', sold_price_coins = $1, sold_via = 'bid' WHERE id = $2`, [price, itemId]);

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (user_id, merch_id, coins_charged, shipping_address) VALUES ($1, $2, $3, '{}') RETURNING id`,
      [req.user.userId, itemId, price]
    );
    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id) VALUES ($1, 'merch_purchase', 'debit', $2, $3, $4)`,
      [req.user.userId, price, `Shoot Wardrobe (winning bid): ${item.title}`, orderRows[0].id]
    );

    await client.query('COMMIT');
    await promoteNextItem();

    res.json({ ok: true, message: 'Claimed! Choose a charity below, then confirm your shipping details.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('auction/claim error:', err);
    res.status(500).json({ error: 'Failed to claim item' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/finalize  (charity choice + shipping, after buy-now or claim)
// ─────────────────────────────────────────────

router.post('/finalize', authMid, async (req, res) => {
  const { itemId, charityKey, displayName, shipping, saveAddress } = req.body;
  if (!CHARITIES[charityKey]) return res.status(400).json({ error: 'Please choose a valid charity' });
  if (!shipping?.name || !shipping?.phone || !shipping?.line1 || !shipping?.city || !shipping?.state || !shipping?.pincode) {
    return res.status(400).json({ error: 'Complete shipping address is required' });
  }

  try {
    const { rows: itemRows } = await pool.query(`SELECT * FROM merchandise WHERE id = $1`, [itemId]);
    if (!itemRows.length) return res.status(404).json({ error: 'Item not found' });
    const item = itemRows[0];
    if (item.auction_status !== 'sold' || item.winner_id !== req.user.userId) {
      return res.status(400).json({ error: 'This item is not awaiting finalization from you' });
    }

    await pool.query(
      `UPDATE merchandise SET charity_key = $1, display_winner_name = $2 WHERE id = $3`,
      [charityKey, !!displayName, itemId]
    );

    if (saveAddress) {
      await pool.query(
        `UPDATE users SET shipping_name=$1, shipping_phone=$2, shipping_line1=$3, shipping_city=$4, shipping_state=$5, shipping_pincode=$6 WHERE id=$7`,
        [shipping.name, shipping.phone, shipping.line1, shipping.city, shipping.state, shipping.pincode, req.user.userId]
      );
    }
    await pool.query(`UPDATE orders SET shipping_address = $1 WHERE merch_id = $2 AND user_id = $3`, [JSON.stringify(shipping), itemId, req.user.userId]);

    notifyArtist({ title: 'Charity selected 💛', body: `Winner of "${item.title}" chose ${CHARITIES[charityKey]}`, url: '/merch' });

    res.json({ ok: true, message: 'All set! Jinal will confirm your donation soon.' });
  } catch (err) {
    console.error('auction/finalize error:', err);
    res.status(500).json({ error: 'Failed to save your choice' });
  }
});

// ─────────────────────────────────────────────
// Queue promotion — exported so both the scheduler and the routes above can call it
// ─────────────────────────────────────────────

async function promoteNextItem() {
  try {
    const { rows: activeCheck } = await pool.query(
      `SELECT id FROM merchandise WHERE is_auction_item = TRUE AND visible = TRUE AND auction_status = 'active'`
    );
    if (activeCheck.length) return; // a slot is already active — nothing to do

    const { rows } = await pool.query(
      `SELECT id, title FROM merchandise
       WHERE is_auction_item = TRUE AND visible = TRUE AND auction_status = 'queued'
       ORDER BY had_auction_turn ASC, COALESCE(went_unsold_at, created_at) ASC
       LIMIT 1`
    );
    if (!rows.length) return;

    await pool.query(
      `UPDATE merchandise SET auction_status = 'active', had_auction_turn = TRUE,
              auction_started_at = NOW(), current_highest_bid = NULL, current_highest_bidder_id = NULL
       WHERE id = $1`,
      [rows[0].id]
    );
    postSystemMessage(`✨ This week's Shoot Wardrobe auction is live: "${rows[0].title}"! Members can bid, everyone can Buy Now.`);
  } catch (err) {
    console.error('auction/promoteNextItem error:', err.message);
  }
}

module.exports = { router, promoteNextItem, CHARITIES };