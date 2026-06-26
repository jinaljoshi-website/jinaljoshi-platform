// backend/routes/coins.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');

const TOKEN_RATE_INR = parseInt(process.env.TOKEN_RATE_INR || '66');

function calcDiscount(tokens) {
  if (tokens >= 1000) return 10;
  if (tokens >= 500)  return 5;
  return 0;
}

function calcPrice(tokens) {
  const pct  = calcDiscount(tokens);
  const base = tokens * TOKEN_RATE_INR;
  return Math.round(base * (1 - pct / 100));
}

// ─────────────────────────────────────────────
// GET /api/coins/balance
// ─────────────────────────────────────────────

router.get('/balance', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const { rows: ledger } = await pool.query(
      `SELECT id, type, direction, amount, label, created_at
       FROM coin_ledger WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [req.user.userId]
    );
    res.json({ balance: userRows[0]?.coin_balance || 0, ledger });
  } catch (err) {
    console.error('coins/balance error:', err);
    res.status(500).json({ error: 'Failed to load balance' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/initiate
// Creates a Razorpay order
// Body: { tokens }
// ─────────────────────────────────────────────

router.post('/recharge/initiate', authMid, async (req, res) => {
  const { tokens } = req.body;
  const amount     = parseInt(tokens);

  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Token amount is required' });
  }
  if (amount > 10000) {
    return res.status(400).json({ error: 'Maximum 10,000 tokens per transaction' });
  }

  const priceINR   = calcPrice(amount);
  const discountPct = calcDiscount(amount);

  try {
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount:   priceINR * 100, // paise
      currency: 'INR',
      notes: {
        user_id:    req.user.userId,
        tokens:     String(amount),
        discount:   String(discountPct),
      },
    });

    res.json({
      orderId:     order.id,
      amount:      priceINR,
      tokens:      amount,
      discountPct,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('coins/recharge/initiate error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/verify
// Verifies Razorpay payment and credits tokens
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, tokens }
// ─────────────────────────────────────────────

router.post('/recharge/verify', authMid, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, tokens } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !tokens) {
    return res.status(400).json({ error: 'Payment verification data is incomplete' });
  }

  const amount = parseInt(tokens);
  if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid token amount' });

  try {
    // Verify signature
    const crypto    = require('crypto');
    const body      = razorpay_order_id + '|' + razorpay_payment_id;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // Check not already processed
    const { rows: existing } = await pool.query(
      `SELECT id FROM coin_ledger WHERE payment_id = $1`,
      [razorpay_payment_id]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Payment already processed' });
    }

    const priceINR    = calcPrice(amount);
    const discountPct = calcDiscount(amount);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [amount, req.user.userId]
      );

      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
         VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)`,
        [req.user.userId, amount, `Recharge ${amount} tokens${discountPct > 0 ? ` (${discountPct}% off)` : ''}`, razorpay_payment_id, priceINR]
      );

      const { rows: userRows } = await client.query(
        `SELECT coin_balance FROM users WHERE id = $1`,
        [req.user.userId]
      );

      await client.query('COMMIT');

      // System message to community
      postSystemMessage('🪙 Someone just recharged their J Tokens!');

      res.json({
        ok:         true,
        tokens:     amount,
        priceINR,
        discountPct,
        newBalance: userRows[0].coin_balance,
        message:    `${amount} tokens added to your balance!`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('coins/recharge/verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/webhook
// Razorpay webhook (backup in case verify is missed)
// ─────────────────────────────────────────────

router.post('/recharge/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const crypto    = require('crypto');
  const expected  = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (expected !== signature) return res.status(400).json({ error: 'Invalid webhook signature' });

  const event   = req.body;
  const payment = event?.payload?.payment?.entity;

  if (event.event !== 'payment.captured' || !payment) {
    return res.json({ ok: true });
  }

  const userId     = payment.notes?.user_id;
  const tokens     = parseInt(payment.notes?.tokens);
  const paymentId  = payment.id;

  if (!userId || !tokens) return res.json({ ok: true });

  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM coin_ledger WHERE payment_id = $1`, [paymentId]
    );
    if (existing.length) return res.json({ ok: true });

    const priceINR = Math.round(payment.amount / 100);
    await pool.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
      [tokens, userId]
    );
    await pool.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
       VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)`,
      [userId, tokens, `Recharge via webhook — ${tokens} tokens`, paymentId, priceINR]
    );

    postSystemMessage('🪙 Someone just recharged their J Tokens!');
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;