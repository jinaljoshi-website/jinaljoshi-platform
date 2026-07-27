// backend/routes/auction.js
// The "Shoot Wardrobe" auction system — a dedicated section inside Merchandise.
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { pushToUser } = require('./push');
const { postSystemMessage } = require('./community');
const { getDiscountForTier, getGuestMultiplier, getConfigNumber, getConfigValue } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');

// Smallest of the 5 / 10 / 20 / 50 increments the fan chooses from in the UI.
// Not a price, so it stays here rather than in Studio.
const MIN_BID_INCREMENT = 5;

const CHARITIES = {
  cry:                    'CRY — Child Rights and You',
  akshaya_patra:          'Akshaya Patra Foundation',
  smile_foundation:       'Smile Foundation',
  pmnrf:                  "Prime Minister's National Relief Fund",
  national_defence_fund:  'National Defence Fund',
};

// Every monetary value comes from Studio. If any is missing we refuse to price
// rather than invent a number — the caller turns this into a 503.
async function auctionConfig() {
  const [bidMult, baseMult, fee, startPct, cooldownDays, merchDiscountPct, discountFlag] =
    await Promise.all([
      getConfigNumber('auction_buynow_bid_multiplier'),
      getConfigNumber('auction_buynow_base_multiplier'),
      getConfigNumber('auction_handling_fee'),
      getConfigNumber('auction_starting_bid_pct'),
      getConfigNumber('auction_cooldown_days'),
      getConfigNumber('merch_discount_pct'),
      getConfigValue('merch_discount_enabled'),
    ]);

  const required = { bidMult, baseMult, fee, startPct, cooldownDays };
  const missing  = Object.entries(required)
    .filter(([, v]) => v === undefined || v === null || Number.isNaN(v))
    .map(([k]) => k);
  if (missing.length) {
    const err = new Error(`Auction pricing config missing: ${missing.join(', ')}`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  return {
    bidMult, baseMult, fee, startPct, cooldownDays,
    merchDiscountPct: merchDiscountPct || 0,
    // Booleans are stored as the strings 'true'/'false'. parseFloat would give
    // NaN here, which is why this must not go through getConfigNumber.
    discountEnabled: String(discountFlag) === 'true',
  };
}

function buyNowPrice(item, cfg) {
  const base = item.current_highest_bid
    ? roundTokensUp(item.current_highest_bid * cfg.bidMult)
    : roundTokensUp(item.price_coins * cfg.baseMult);
  // The blanket promotional discount only ever applies to queued items, never the
  // live auction item, whose Buy Now price is already derived from real bids.
  if (item.auction_status !== 'active' && cfg.discountEnabled && cfg.merchDiscountPct > 0) {
    return roundTokensUp(base * (1 - cfg.merchDiscountPct / 100));
  }
  return base;
}

function startingBid(item, cfg) {
  return roundTokensUp(item.price_coins * (cfg.startPct / 100));
}

async function loadBuyer(client, userId) {
  const { rows } = await client.query(
    `SELECT tier, membership_expires_at, coin_balance, display_name FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const user     = rows[0];
  const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
  const userTier = isActive ? user.tier : 'guest';
  return { user, isMember: !!isActive, userTier, isGuest: userTier === 'guest' };
}

// ─────────────────────────────────────────────
// GET /api/shop/auction
// ─────────────────────────────────────────────

router.get('/', authMid, async (req, res) => {
  try {
    const cfg = await auctionConfig();

    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const isGuest  = userTier === 'guest';
    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
    ]);

    // Unsold items serve a cooldown before returning to the Buy Now list, so nobody
    // can let an auction lapse in order to buy the item cheaply straight afterwards.
    const { rows: items } = await pool.query(
      `SELECT id, title, description, img_key, price_coins, csr_pct, auction_status,
              current_highest_bid, current_highest_bidder_id, auction_started_at,
              winner_id, won_at
       FROM merchandise
       WHERE is_auction_item = TRUE AND visible = TRUE AND auction_status <> 'sold'
         AND (
           auction_status IN ('active', 'awaiting_payment')
           OR went_unsold_at IS NULL
           OR went_unsold_at <= NOW() - ($1 || ' days')::interval
         )
       ORDER BY (auction_status = 'active') DESC, had_auction_turn ASC,
                COALESCE(went_unsold_at, created_at) ASC`,
      [String(cfg.cooldownDays)]
    );

    const applyGuestOrDiscount = (price) => {
      if (isGuest) return roundTokensUp(price * guestMultiplier);
      if (discountPct) return roundTokensUp(price * (1 - discountPct / 100));
      return price;
    };

    const shaped = items.map((item) => {
      const isLive = item.auction_status === 'active';
      return {
        id: item.id, title: item.title, description: item.description, img_key: item.img_key,
        csrPct: item.csr_pct, status: item.auction_status,
        currentBid: item.current_highest_bid,
        startingBid: isLive && !item.current_highest_bid ? startingBid(item, cfg) : null,
        minNextBid: isLive
          ? (item.current_highest_bid ? item.current_highest_bid + MIN_BID_INCREMENT : startingBid(item, cfg))
          : null,
        isHighBidder: item.current_highest_bidder_id === req.user.userId,
        buyNowPrice: applyGuestOrDiscount(buyNowPrice(item, cfg)),
        // Buy Now on the LIVE item is a members-only benefit; queued items are open to all.
        buyNowLocked: isLive && isGuest,
        secondsRemaining: isLive && item.auction_started_at
          ? Math.max(0, 259200 - Math.floor((now - new Date(item.auction_started_at)) / 1000))
          : null,
        isMyWin: item.winner_id === req.user.userId,
        wonAt: item.won_at,
        claimPrice: item.winner_id === req.user.userId && item.auction_status === 'awaiting_payment'
          ? item.current_highest_bid + cfg.fee
          : null,
      };
    });

    res.json({
      items: shaped, isGuest, coinBalance: user.coin_balance,
      handlingFee: cfg.fee,
      bidIncrements: [5, 10, 20, 50],
      charities: Object.entries(CHARITIES).map(([key, name]) => ({ key, name })),
    });
  } catch (err) {
    if (err.code === 'CONFIG_MISSING') {
      console.error('auction/get config error:', err.message);
      return res.status(503).json({ error: 'Auction pricing is unavailable right now' });
    }
    console.error('auction/get error:', err);
    res.status(500).json({ error: 'Failed to load auction' });
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/bid
// Charity is chosen here, at bid time — so a winner never has to be chased for it.
// ─────────────────────────────────────────────

router.post('/bid', authMid, async (req, res) => {
  const { itemId, amount, charityKey, displayWinnerName } = req.body;
  if (!itemId || !amount) return res.status(400).json({ error: 'itemId and amount are required' });
  if (!CHARITIES[charityKey]) return res.status(400).json({ error: 'Please choose a charity for your bid' });

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  const client = await pool.connect();
  try {
    const cfg = await auctionConfig();
    await client.query('BEGIN');

    const { user, isMember } = await loadBuyer(client, req.user.userId);
    if (!isMember) {
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

    const minBid = item.current_highest_bid
      ? item.current_highest_bid + MIN_BID_INCREMENT
      : startingBid(item, cfg);

    if (!Number.isInteger(amount) || amount < minBid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Bid must be a whole number of at least ${minBid} tokens` });
    }
    // Tokens are not held at bid time, so we check the bidder could actually
    // honour it. This is why bidding is closed to guests.
    if (user.coin_balance < amount + cfg.fee) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `A ${amount} token bid needs ${amount + cfg.fee} tokens including handling. You have ${user.coin_balance}.`,
        required: amount + cfg.fee, available: user.coin_balance,
      });
    }

    const previousBidderId = item.current_highest_bidder_id;

    await client.query(
      `INSERT INTO merch_bids (merch_id, user_id, amount, charity_key, display_winner_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, req.user.userId, amount, charityKey, !!displayWinnerName]
    );
    await client.query(
      `UPDATE merchandise SET current_highest_bid = $1, current_highest_bidder_id = $2 WHERE id = $3`,
      [amount, req.user.userId, itemId]
    );

    await client.query('COMMIT');

    if (previousBidderId && previousBidderId !== req.user.userId) {
      pushToUser(previousBidderId, {
        title: 'You have been outbid',
        body:  `"${item.title}" is now at ${amount} tokens.`,
        url:   '/platform/shop',
        tag:   'auction',
      }).catch((e) => console.error('outbid push failed:', e.message));
    }

    postSystemMessage(`💫 A new bid just came in on this week's Shoot Wardrobe item!`);
    notifyArtist({ title: 'New auction bid', body: `${user.display_name || 'A member'} bid ${amount} tokens on "${item.title}"`, url: '/merch' });

    res.json({ ok: true, currentBid: amount, minNextBid: amount + MIN_BID_INCREMENT });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'CONFIG_MISSING') {
      console.error('auction/bid config error:', err.message);
      return res.status(503).json({ error: 'Auction pricing is unavailable right now' });
    }
    console.error('auction/bid error:', err);
    res.status(500).json({ error: 'Failed to place bid' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/buy-now
// Shipping and charity are both captured here, so there is no second step.
// ─────────────────────────────────────────────

router.post('/buy-now', authMid, async (req, res) => {
  const { itemId, shipping, saveAddress, charityKey, displayWinnerName } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId is required' });
  if (!CHARITIES[charityKey]) return res.status(400).json({ error: 'Please choose a charity' });
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
    const cfg = await auctionConfig();
    await client.query('BEGIN');

    const { user, isGuest, userTier } = await loadBuyer(client, req.user.userId);
    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
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

    // Buying out a live auction ends it for everyone else, so it is reserved for members.
    if (item.auction_status === 'active' && isGuest) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'MEMBERSHIP_REQUIRED',
        message: 'Buying the live auction item is a membership benefit. Queued items are open to everyone.',
      });
    }

    const rawPrice   = buyNowPrice(item, cfg);
    const itemPrice  = isGuest
      ? roundTokensUp(rawPrice * guestMultiplier)
      : (discountPct ? roundTokensUp(rawPrice * (1 - discountPct / 100)) : rawPrice);
    const finalPrice = itemPrice + cfg.fee;

    if (user.coin_balance < finalPrice) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `This costs ${finalPrice} tokens including handling & packaging. You have ${user.coin_balance}.`,
        required: finalPrice, available: user.coin_balance,
      });
    }

    const wasActive       = item.auction_status === 'active';
    const outbidBidderId  = item.current_highest_bidder_id;

    await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [finalPrice, req.user.userId]);
    await client.query(
      `UPDATE merchandise
       SET auction_status = 'sold', sold_price_coins = $1, sold_via = 'buy_now',
           winner_id = $2, had_auction_turn = TRUE, remaining = 0,
           charity_key = $3, display_winner_name = $4
       WHERE id = $5`,
      [itemPrice, req.user.userId, charityKey, !!displayWinnerName, itemId]
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

    notifyArtist({ title: 'Shoot Wardrobe — Buy Now', body: `"${item.title}" bought instantly for ${itemPrice} tokens`, url: '/merch' });

    // Anyone who had bid on this item just lost it. They were never charged, but
    // they deserve to be told rather than discover it silently.
    if (outbidBidderId && outbidBidderId !== req.user.userId) {
      pushToUser(outbidBidderId, {
        title: 'Auction ended early',
        body:  `"${item.title}" was bought outright. Your bid was not charged.`,
        url:   '/platform/shop',
        tag:   'auction',
      }).catch((e) => console.error('buy-now outbid push failed:', e.message));
    }

    if (wasActive) await promoteNextItem();

    res.json({
      ok: true, orderId: orderRows[0].id,
      itemPrice, handlingFee: cfg.fee, totalCharged: finalPrice,
      newBalance: user.coin_balance - finalPrice,
      message: `You bought "${item.title}". Jinal will be in touch for delivery.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'CONFIG_MISSING') {
      console.error('auction/buy-now config error:', err.message);
      return res.status(503).json({ error: 'Auction pricing is unavailable right now' });
    }
    console.error('auction/buy-now error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/shop/auction/claim
// The winner pays their bid plus handling, and gives shipping. The charity was
// already chosen when they bid, so nothing else is asked of them.
// ─────────────────────────────────────────────

router.post('/claim', authMid, async (req, res) => {
  const { itemId, shipping, saveAddress } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId is required' });
  if (!shipping?.name || !shipping?.phone || !shipping?.line1 || !shipping?.city || !shipping?.state || !shipping?.pincode) {
    return res.status(400).json({ error: 'Complete shipping address is required' });
  }

  const client = await pool.connect();
  try {
    const cfg = await auctionConfig();
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

    // The scheduler expires unclaimed wins, but do not rely on it having run.
    const wonAtMs = item.won_at ? new Date(item.won_at).getTime() : 0;
    if (Date.now() - wonAtMs > 72 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'CLAIM_EXPIRED', message: 'The 72-hour claim window for this item has closed.' });
    }

    const itemPrice  = item.current_highest_bid;
    const finalPrice = itemPrice + cfg.fee;

    if (user.coin_balance < finalPrice) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `Claiming this costs ${finalPrice} tokens including handling & packaging. You have ${user.coin_balance}.`,
        required: finalPrice, available: user.coin_balance,
      });
    }

    // Carry the charity choice across from the bid that won.
    const { rows: bidRows } = await client.query(
      `SELECT charity_key, display_winner_name FROM merch_bids
       WHERE merch_id = $1 AND user_id = $2 ORDER BY amount DESC, created_at DESC LIMIT 1`,
      [itemId, req.user.userId]
    );
    const winningBid = bidRows[0] || {};

    await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [finalPrice, req.user.userId]);
    await client.query(
      `UPDATE merchandise
       SET auction_status = 'sold', sold_price_coins = $1, sold_via = 'bid', remaining = 0,
           charity_key = COALESCE($2, charity_key), display_winner_name = COALESCE($3, display_winner_name)
       WHERE id = $4`,
      [itemPrice, winningBid.charity_key || null, winningBid.display_winner_name ?? null, itemId]
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
      [req.user.userId, finalPrice, `Shoot Wardrobe (winning bid): ${item.title}`, orderRows[0].id]
    );

    await client.query('COMMIT');

    notifyArtist({
      title: 'Auction claimed 🎉',
      body:  `"${item.title}" claimed for ${itemPrice} tokens${winningBid.charity_key ? ` · ${CHARITIES[winningBid.charity_key]}` : ''}`,
      url:   '/merch',
    });

    await promoteNextItem();

    res.json({
      ok: true, orderId: orderRows[0].id,
      itemPrice, handlingFee: cfg.fee, totalCharged: finalPrice,
      newBalance: user.coin_balance - finalPrice,
      message: `Claimed! Jinal will confirm your donation to ${CHARITIES[winningBid.charity_key] || 'your chosen charity'} soon.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'CONFIG_MISSING') {
      console.error('auction/claim config error:', err.message);
      return res.status(503).json({ error: 'Auction pricing is unavailable right now' });
    }
    console.error('auction/claim error:', err);
    res.status(500).json({ error: 'Failed to claim item' });
  } finally {
    client.release();
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