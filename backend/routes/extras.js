// backend/routes/extras.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { getGuestMultiplier } = require('../lib/config');
const { roundTokensUp } = require('../lib/pricing');
const { postSystemMessage } = require('./community');
const { assertNotBlocked } = require('../lib/moderation');
const integrity = require('../lib/integrity');
const { spendTokens, refundByRelated } = require('../lib/tokens');
const { depositFor, checkPayment, recordPayment, outstanding, limits } = require('../lib/requestPayments');

// ─────────────────────────────────────────────
// GET /api/extras/options
// The catalog of request types Jinal has listed — shown to every fan as inspiration/menu
// ─────────────────────────────────────────────

router.get('/options', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT coin_balance, tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest = !isActive;

    const { rows: items } = await pool.query(
      `SELECT id, title, price_coins FROM extras_items WHERE visible = TRUE ORDER BY created_at ASC`
    );
    res.json({ options: items, coinBalance: user.coin_balance, isGuest });
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
      `SELECT id, type, topic, details, reference_url, reference_image_key,
              expected_delivery_date, offered_price_coins, coins_charged,
              counter_price_coins, counter_note, status, rejection_reason, created_at
       FROM custom_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
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
// Fan submits a request with their OWN offered price — a genuine negotiation starting point,
// not an auto-computed catalog price. Jinal can approve, decline, or counter it afterward.
// ─────────────────────────────────────────────

router.post('/request', authMid, async (req, res) => {
  const {
    extraItemId, topic, details, referenceUrl, referenceImageUrl, expectedDeliveryDate, offeredPrice, consentAgreed,
    deliveryChannel, deliveryEmail, deliveryWhatsapp,
  } = req.body;

  // extraItemId is now optional — a fan can pick one of Jinal's listed options, or submit
  // a fully open-ended custom request that isn't tied to any pre-set catalog item at all.
  if (!topic?.trim())       return res.status(400).json({ error: 'Please give your request a short topic' });
  if (!details?.trim())     return res.status(400).json({ error: 'Please describe your request' });
  if (!offeredPrice || offeredPrice < 1) return res.status(400).json({ error: 'Please offer a token amount' });
  if (!consentAgreed)       return res.status(400).json({ error: 'Please confirm all agreements before sending' });
  // Chat needs no address of any kind.
  //
  // The other two ask a fan to hand over an email or a phone number for
  // something that could just as easily arrive where they already talk to her —
  // and for anything private, sending it to a personal inbox is the part they
  // are most likely to hesitate over.
  if (!['email', 'whatsapp', 'chat'].includes(deliveryChannel)) return res.status(400).json({ error: 'Please choose how you\'d like this delivered' });
  if (deliveryChannel === 'email' && !deliveryEmail?.trim())       return res.status(400).json({ error: 'Please provide an email address for delivery' });
  if (deliveryChannel === 'whatsapp' && !deliveryWhatsapp?.trim()) return res.status(400).json({ error: 'Please provide a WhatsApp number for delivery' });

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  // A reference URL is shown to Jinal in Studio as a link she is meant to
  // click — that is the whole point of the field. So it has to actually be a
  // web address. Without this check a member could submit
  // javascript:...localStorage.getItem('jwt')... and the link in Studio would
  // hand over her session the moment she opened it. Clicking a member's
  // reference is the normal workflow, so she would.
  //
  // An allow-list of two schemes, not a search for bad ones: there is no
  // cleverness here to get around.
  for (const [field, value] of [['reference link', referenceUrl], ['reference image', referenceImageUrl]]) {
    const v = value?.trim();
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) {
      return res.status(400).json({ error: `Please give the ${field} as a web address starting with http:// or https://` });
    }
  }

  const screened = await integrity.screen(req, { topic, details });
  if (screened) return res.status(screened.status).json(screened.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT coin_balance, display_name, tier, membership_expires_at FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = userRows[0];
    const fanLabel = user.display_name || 'A member';

    let itemTitle = 'Custom Request';
    if (extraItemId) {
      const { rows: itemRows } = await client.query(
        `SELECT * FROM extras_items WHERE id = $1 AND visible = TRUE FOR UPDATE`,
        [extraItemId]
      );
      if (!itemRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'This request type is not available' });
      }
      itemTitle = itemRows[0].title;
    }
    // No tier discount here — a custom request is Jinal's own time and the fan
    // names the amount themselves, so there is nothing to discount from. Guests
    // still pay the guest rate, as they do everywhere else.
    const memberActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const offered      = Math.ceil(offeredPrice);
    const price        = memberActive
      ? offered
      : roundTokensUp(offered * (await getGuestMultiplier()));

    const { rows: requestRows } = await client.query(
      `INSERT INTO custom_requests
         (user_id, type, topic, details, reference_url, reference_image_key, expected_delivery_date,
          offered_price_coins, coins_charged, extra_item_id, consent_agreed,
          delivery_channel, delivery_email, delivery_whatsapp, agreed_price_coins)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, TRUE, $10, $11, $12, $8) RETURNING *`,
      [req.user.userId, itemTitle, topic.trim(), details.trim(), referenceUrl?.trim() || null,
       referenceImageUrl || null, expectedDeliveryDate || null, price, extraItemId || null,
       deliveryChannel, deliveryEmail?.trim() || null, deliveryWhatsapp?.trim() || null]
    );

    // A tenth to place it, not the whole thing.
    //
    // The full price used to go at once, so anything expensive had to be
    // affordable in one payment or not asked for at all.
    //
    // The deposit reserves her time. Nothing is made until it is settled.
    const deposit = depositFor(price);

    const allowed = await checkPayment(client, req.user.userId, deposit);
    if (!allowed.ok) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: allowed.code, message: allowed.message, maxCoins: allowed.maxCoins });
    }

    // A personalised request is Jinal's own work, so it takes purchased tokens.
    let spend;
    try {
      spend = await spendTokens(client, {
        userId:      req.user.userId,
        amount:      deposit,
        type:        'custom_request',
        label:       `${itemTitle}: ${topic.trim()} (deposit)`,
        relatedId:   requestRows[0].id,
        allowGifted: false,
      });
      // Logged as the first instalment, so what is owed is always the agreed
      // price less what these add up to, with no separate counter to drift.
      await recordPayment(client, {
        requestId: requestRows[0].id,
        userId: req.user.userId,
        coins: deposit,
        valueInr: allowed.valueInr,
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
       VALUES ('custom_request', $1, $2)`,
      [req.user.userId, JSON.stringify({ title: itemTitle, topic: topic.trim(), price, requestId: requestRows[0].id })]
    );

    await client.query('COMMIT');

    notifyArtist({
      title: 'New personalised request 🌟',
      body:  `${itemTitle} — "${topic.trim()}" · ${price} tokens offered`,
      // requestRows[0].id — `request` is not a name that exists in this
      // handler, and optional chaining does not rescue an undeclared binding,
      // it throws on it. This line ran after COMMIT, so every personalised
      // request charged its deposit, kept it, and then answered the fan with
      // `500 Failed to submit request`. The feature has been taking money and
      // reporting failure.
      url:   `/requests?request=${requestRows[0].id}`,
    });

    postSystemMessage(`🌟 ${fanLabel} just requested a ${itemTitle}!`, { kind: 'activity', name: fanLabel });

    res.json({
      ok:         true,
      requestId:  requestRows[0].id,
      coinsSpent: price,
      // Read back from the spend rather than subtracted from what was loaded
      // earlier. A spend can draw on bonus tokens, which do not sit in
      // coin_balance, so subtracting the whole cost from it reported a balance
      // lower than the fan actually holds until something forced a refresh.
      newBalance: spend.newPurchased,
      message:    `Your request has been sent to Jinal for review.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('extras/request error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/extras/requests/:id/respond-to-counter
// Fan accepts (pays the additional difference) or declines a higher counter-offer from Jinal.
// Lower counters never reach here — they auto-apply server-side the moment Jinal sets them.
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// GET  /api/extras/requests/:id/balance
// POST /api/extras/requests/:id/pay
// ─────────────────────────────────────────────
//
// Paying off a commission.
//
// A tenth placed it; this is the rest, in whatever amounts suit, until it is
// settled. Nothing is made before then — the deposit reserved her time, not the
// work.
router.get('/requests/:id/balance', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, topic, type, agreed_price_coins, offered_price_coins,
              coins_charged, paid_in_full_at, status
         FROM custom_requests WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'No such request' });
    const r = rows[0];
    const { perDayInr, perPaymentInr, tokenRate } = await limits();

    // Only worth asking when there is a daily ceiling to measure against.
    const dayCapped = Number.isFinite(perDayInr) && perDayInr > 0;
    const today = dayCapped
      ? (await pool.query(
          `SELECT COALESCE(SUM(inr_value), 0) AS spent FROM request_payments
            WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
          [req.user.userId]
        )).rows
      : [{ spent: 0 }];
    const { rows: history } = await pool.query(
      `SELECT coins, inr_value, created_at FROM request_payments
        WHERE request_id = $1 ORDER BY created_at`,
      [req.params.id]
    );

    const owed = outstanding(r);
    const leftToday = dayCapped
      ? Math.max(0, perDayInr - Number(today[0].spent))
      : null;

    res.json({
      agreed: Number(r.agreed_price_coins ?? r.offered_price_coins ?? 0),
      paid: Number(r.coins_charged || 0),
      outstanding: owed,
      settled: owed === 0,
      payments: history.map((h) => ({ coins: h.coins, at: h.created_at })),
      // What can go in right now, so the screen can offer a sensible maximum
      // rather than letting somebody type a number that will be refused.
      //
      // Only the ceilings that are switched on get a say. Taking the minimum
      // across all of them unconditionally would read an uncapped 0 as a limit
      // of zero tokens and offer the member nothing at all.
      maxNow: Math.max(0, Math.min(...[
        owed,
        ...(Number.isFinite(perPaymentInr) && perPaymentInr > 0 ? [Math.floor(perPaymentInr / tokenRate)] : []),
        ...(dayCapped ? [Math.floor(leftToday / tokenRate)] : []),
      ])),
      // null, not 0, when nothing is capping the day — so the screen can tell
      // "no limit" from "nothing left".
      dailyLeftInr: leftToday,
    });
  } catch (err) {
    console.error('extras/balance error:', err);
    res.status(500).json({ error: 'Could not work out the balance' });
  }
});

router.post('/requests/:id/pay', authMid, async (req, res) => {
  const coins = parseInt(req.body.coins, 10);
  if (!coins || coins <= 0) return res.status(400).json({ error: 'How many tokens?' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, topic, agreed_price_coins, offered_price_coins, coins_charged, status
         FROM custom_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No such request' }); }
    const r = rows[0];

    if (['cancelled', 'declined'].includes(r.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request is closed. Nothing more is owed on it.' });
    }

    const owed = outstanding(r);
    if (owed === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This one is already paid in full.' });
    }
    // Never more than is owed. Somebody typing a large number should not end up
    // with a credit against a commission they cannot spend anywhere else.
    const amount = Math.min(coins, owed);

    const allowed = await checkPayment(client, req.user.userId, amount);
    if (!allowed.ok) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: allowed.code, message: allowed.message, maxCoins: allowed.maxCoins });
    }

    try {
      await spendTokens(client, {
        userId:      req.user.userId,
        amount,
        type:        'custom_request',
        label:       `${r.topic}: instalment`,
        relatedId:   r.id,
        allowGifted: false,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === 'INSUFFICIENT_TOKENS') return res.status(402).json(err.httpBody);
      throw err;
    }

    const out = await recordPayment(client, {
      requestId: r.id, userId: req.user.userId, coins: amount, valueInr: allowed.valueInr,
    });
    await client.query('COMMIT');

    if (out.settled) {
      notifyArtist({
        title: 'A request is paid in full',
        body:  `${r.topic} has been settled and is ready to make.`,
        url:   '/requests',
        tag:   'request-settled',
      }).catch(() => {});
    }

    res.json({ ok: true, paid: amount, ...out });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('extras/pay error:', err);
    res.status(500).json({ error: 'Could not take that payment' });
  } finally {
    client.release();
  }
});

router.post('/requests/:id/respond-to-counter', authMid, async (req, res) => {
  const { action } = req.body;
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT cr.*, u.display_name, u.email
         FROM custom_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.id = $1 AND cr.user_id = $2 FOR UPDATE OF cr`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const request = rows[0];
    // Named, so a notification says who without needing to be looked up.
    const who = request.display_name || request.email || 'A member';

    if (request.status !== 'countered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This request is not awaiting your response' });
    }

    if (action === 'decline') {
      await refundByRelated(client, {
        userId:     req.user.userId,
        type:       'custom_request',
        relatedId:  request.id,
        label:      `Declined counter-offer: ${request.topic}`,
        refundType: 'request_refund',
      });
      await client.query(`UPDATE custom_requests SET status = 'cancelled' WHERE id = $1`, [request.id]);
      await client.query('COMMIT');
      notifyArtist({ title: 'Counter-offer declined', body: `${who} declined the counter for "${request.topic}". Tokens refunded.`, url: '/requests' });
      return res.json({ ok: true, message: 'Declined — your tokens have been refunded as credit.' });
    }

    // Accept — charge the difference between what's already held and the counter price
    // Accepting a counter changes what is owed, not what must be paid today.
    //
    // The difference used to be taken there and then, which put the whole
    // point of instalments back where it started: agree a higher price and be
    // asked for all of it at once. The agreed price moves; the balance follows;
    // it is paid off the same way as the rest.
    const additionalDue = 0;
    const newAgreed = request.counter_price_coins;
    const { rows: userRows } = await client.query(`SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`, [req.user.userId]);
    const user = userRows[0];

    if (additionalDue > 0) {
      try {
        await spendTokens(client, {
          userId:      req.user.userId,
          amount:      additionalDue,
          type:        'custom_request',
          label:       `Accepted counter-offer: ${request.topic}`,
          relatedId:   request.id,
          allowGifted: false,
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_TOKENS') {
          await client.query('ROLLBACK');
          return res.status(402).json(err.httpBody);
        }
        throw err;
      }
    }

    await client.query(
      // The agreed price is what changed. coins_charged is what has actually
      // been taken and is left alone, so the two together still say what is
      // owed.
      `UPDATE custom_requests
          SET status = 'confirmed', agreed_price_coins = $1,
              paid_in_full_at = CASE WHEN COALESCE(coins_charged, 0) >= $1 THEN COALESCE(paid_in_full_at, NOW()) ELSE NULL END
        WHERE id = $2`,
      [newAgreed, request.id]
    );

    await client.query('COMMIT');
    notifyArtist({ title: 'Counter-offer accepted ✓', body: `${who} accepted the counter for "${request.topic}".`, url: '/requests' });
    res.json({ ok: true, message: 'Accepted — your request is confirmed.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('extras/respond-to-counter error:', err);
    res.status(500).json({ error: 'Failed to respond' });
  } finally {
    client.release();
  }
});

module.exports = router;