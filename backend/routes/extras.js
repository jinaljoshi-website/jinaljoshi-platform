// backend/routes/extras.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { postSystemMessage } = require('./community');
const { assertNotBlocked } = require('../lib/moderation');

// ─────────────────────────────────────────────
// GET /api/extras/options
// The catalog of request types Jinal has listed — shown to every fan as inspiration/menu
// ─────────────────────────────────────────────

router.get('/options', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(`SELECT coin_balance FROM users WHERE id = $1`, [req.user.userId]);
    const { rows: items } = await pool.query(
      `SELECT id, title, price_coins FROM extras_items WHERE visible = TRUE ORDER BY created_at ASC`
    );
    res.json({ options: items, coinBalance: userRows[0].coin_balance });
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
  const { extraItemId, topic, details, referenceUrl, referenceImageUrl, expectedDeliveryDate, offeredPrice, consentAgreed } = req.body;

  if (!extraItemId)         return res.status(400).json({ error: 'Please choose a request type' });
  if (!topic?.trim())       return res.status(400).json({ error: 'Please give your request a short topic' });
  if (!details?.trim())     return res.status(400).json({ error: 'Please describe your request' });
  if (!offeredPrice || offeredPrice < 1) return res.status(400).json({ error: 'Please offer a token amount' });
  if (!consentAgreed)       return res.status(400).json({ error: 'Please confirm all three agreements before sending' });

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT coin_balance, display_name FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = userRows[0];
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
    const price = Math.ceil(offeredPrice);

    if (user.coin_balance < price) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `You offered ${price} tokens but only have ${user.coin_balance}.`,
        required:  price,
        available: user.coin_balance,
        shortBy:   price - user.coin_balance,
      });
    }

    await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [price, req.user.userId]);

    const { rows: requestRows } = await client.query(
      `INSERT INTO custom_requests
         (user_id, type, topic, details, reference_url, reference_image_key, expected_delivery_date,
          offered_price_coins, coins_charged, extra_item_id, consent_agreed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, TRUE) RETURNING *`,
      [req.user.userId, item.title, topic.trim(), details.trim(), referenceUrl?.trim() || null,
       referenceImageUrl || null, expectedDeliveryDate || null, price, extraItemId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
       VALUES ($1, 'custom_request', 'debit', $2, $3, $4)`,
      [req.user.userId, price, `${item.title}: ${topic.trim()}`, requestRows[0].id]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('custom_request', $1, $2)`,
      [req.user.userId, JSON.stringify({ title: item.title, topic: topic.trim(), price, requestId: requestRows[0].id })]
    );

    await client.query('COMMIT');

    notifyArtist({
      title: 'New personalised request 🌟',
      body:  `${item.title} — "${topic.trim()}" · ${price} tokens offered`,
      url:   '/requests',
    });

    postSystemMessage(`🌟 ${fanLabel} just requested a ${item.title}!`);

    res.json({
      ok:         true,
      requestId:  requestRows[0].id,
      coinsSpent: price,
      newBalance: user.coin_balance - price,
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

router.post('/requests/:id/respond-to-counter', authMid, async (req, res) => {
  const { action } = req.body;
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM custom_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const request = rows[0];

    if (request.status !== 'countered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This request is not awaiting your response' });
    }

    if (action === 'decline') {
      await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [request.coins_charged, req.user.userId]);
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'request_refund', 'credit', $2, $3, $4)`,
        [req.user.userId, request.coins_charged, `Declined counter-offer: ${request.topic}`, request.id]
      );
      await client.query(`UPDATE custom_requests SET status = 'cancelled' WHERE id = $1`, [request.id]);
      await client.query('COMMIT');
      notifyArtist({ title: 'Counter-offer declined', body: `Fan declined the counter for "${request.topic}". Tokens refunded.`, url: '/requests' });
      return res.json({ ok: true, message: 'Declined — your tokens have been refunded as credit.' });
    }

    // Accept — charge the difference between what's already held and the counter price
    const additionalDue = request.counter_price_coins - request.coins_charged;
    const { rows: userRows } = await client.query(`SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`, [req.user.userId]);
    const user = userRows[0];

    if (additionalDue > 0 && user.coin_balance < additionalDue) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `Accepting this costs ${additionalDue} more tokens. You have ${user.coin_balance}.`,
        required: additionalDue, available: user.coin_balance,
      });
    }

    if (additionalDue > 0) {
      await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`, [additionalDue, req.user.userId]);
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'custom_request', 'debit', $2, $3, $4)`,
        [req.user.userId, additionalDue, `Accepted counter-offer: ${request.topic}`, request.id]
      );
    }

    await client.query(
      `UPDATE custom_requests SET status = 'confirmed', coins_charged = $1 WHERE id = $2`,
      [request.counter_price_coins, request.id]
    );

    await client.query('COMMIT');
    notifyArtist({ title: 'Counter-offer accepted ✓', body: `Fan accepted the counter for "${request.topic}".`, url: '/requests' });
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