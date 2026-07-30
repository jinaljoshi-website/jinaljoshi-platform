// backend/routes/coins.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { getClientIp, lookupIpCountry } = require('../lib/geoip');
const { issueInvoiceForPurchase } = require('../lib/invoice');
const payments = require('../lib/payments');
const { getConfigNumber } = require('../lib/config');
const { getBalances } = require('../lib/tokens');


async function getDiscountConfig() {
  const [tier1Threshold, tier1Pct, tier2Threshold, tier2Pct] = await Promise.all([
    getConfigNumber('recharge_discount_tier1_threshold'),
    getConfigNumber('recharge_discount_tier1_pct'),
    getConfigNumber('recharge_discount_tier2_threshold'),
    getConfigNumber('recharge_discount_tier2_pct'),
  ]);
  return {
    tier1Threshold: tier1Threshold || 500,
    tier1Pct:       tier1Pct ?? 5,
    tier2Threshold: tier2Threshold || 1000,
    tier2Pct:       tier2Pct ?? 10,
  };
}

async function calcDiscount(tokens) {
  const cfg = await getDiscountConfig();
  if (tokens >= cfg.tier2Threshold) return cfg.tier2Pct;
  if (tokens >= cfg.tier1Threshold) return cfg.tier1Pct;
  return 0;
}

async function calcPrice(tokens) {
  const pct  = await calcDiscount(tokens);
  const rate = await getConfigNumber('token_rate_inr');
  const base = tokens * rate;
  return Math.round(base * (1 - pct / 100));
}

// ─────────────────────────────────────────────
// GET /api/coins/balance
// ─────────────────────────────────────────────

router.get('/balance', authMid, async (req, res) => {
  try {
    const balances = await getBalances(pool, req.user.userId);
    const { rows: ledger } = await pool.query(
      `SELECT id, type, direction, amount, label, created_at, from_gifted, from_purchased
       FROM coin_ledger WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [req.user.userId]
    );
    const discountConfig = await getDiscountConfig();
    res.json({
      // `balance` stays as the purchased pot so nothing that already reads it breaks;
      // the two pots and the expiry countdown are additional.
      balance:             balances.purchased,
      purchasedBalance:    balances.purchased,
      giftedBalance:       balances.gifted,
      totalBalance:        balances.total,
      giftedExpiresInDays: balances.giftedExpiresInDays,
      ledger,
      discountConfig,
    });
  } catch (err) {
    console.error('coins/balance error:', err);
    res.status(500).json({ error: 'Failed to load balance' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/initiate
// Creates an order through whichever payment provider the dispatcher selects
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

  const priceINR    = await calcPrice(amount);
  const discountPct = await calcDiscount(amount);

  try {
    const order = await payments.createOrder({
      amountInr:   priceINR,
      tokens:      amount,
      discountPct,
      userId:      req.user.userId,
    });

    res.json({
      orderId:     order.orderId,
      amount:      priceINR,
      tokens:      amount,
      discountPct,
      razorpayKey: order.providerKey, // field name kept for frontend compatibility; represents whichever provider is active
    });
  } catch (err) {
    console.error('coins/recharge/initiate error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/verify
// Verifies payment through the dispatcher, credits tokens, and issues a tax invoice
// (only when the active provider is one where we remain the seller of record)
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
    const result = await payments.verifyPayment({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!result.verified) {
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // The webhook reliably arrives before this client-side call in practice (it's a direct
    // server-to-server request, with no browser round-trip to wait on). That's expected,
    // not an error — if the payment's already credited, confirm success using the existing
    // result instead of treating the fan's own successful payment as a failure.
    const { rows: existing } = await pool.query(
      `SELECT amount FROM coin_ledger WHERE payment_id = $1`,
      [razorpay_payment_id]
    );
    if (existing.length) {
      const { rows: userRows } = await pool.query(`SELECT coin_balance FROM users WHERE id = $1`, [req.user.userId]);
      return res.json({
        ok: true,
        tokens: existing[0].amount,
        newBalance: userRows[0].coin_balance,
        message: `${existing[0].amount} tokens added to your balance!`,
      });
    }

    const priceINR    = await calcPrice(amount);
    const discountPct = await calcDiscount(amount);
    const paymentMethodDisplay = payments.describePaymentMethod('razorpay', result.paymentRaw);
    const invoicingOwner = payments.invoicingOwnerFor('razorpay');

    const clientIp = getClientIp(req);
    const { country: userCountry } = await lookupIpCountry(clientIp);

    const { rows: userRows0 } = await pool.query(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
    const userEmail = userRows0[0]?.email;

    const client = await pool.connect();
    let coinLedgerId, newBalance;
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [amount, req.user.userId]
      );

      const { rows: ledgerRows } = await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
         VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)
         RETURNING id`,
        [req.user.userId, amount, `Recharge ${amount} tokens${discountPct > 0 ? ` (${discountPct}% off)` : ''}`, razorpay_payment_id, priceINR]
      );
      coinLedgerId = ledgerRows[0].id;

      const { rows: userRows } = await client.query(`SELECT coin_balance FROM users WHERE id = $1`, [req.user.userId]);
      newBalance = userRows[0].coin_balance;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    postSystemMessage('🪙 Someone just recharged their J Tokens!');

    // Only run our own GST invoice logic if we're the seller of record for this provider.
    // A future Merchant-of-Record gateway (e.g. FastSpring) would skip this entirely —
    // their own invoice is the real one, we'd just log the net payout instead.
    let invoiceNumber = null;
    if (invoicingOwner === 'us') {
      const invoice = await issueInvoiceForPurchase({
        userId: req.user.userId,
        userEmail,
        userCountry,
        coinLedgerId,
        tokensPurchased: amount,
        amountInrEquivalent: priceINR,
        currency: result.currency,
        amountInCurrency: result.amountInCurrency,
        exchangeRateUsed: null,
        paymentMethodDisplay,
      });
      invoiceNumber = invoice?.invoice_number || null;
    }

    res.json({
      ok:         true,
      tokens:     amount,
      priceINR,
      discountPct,
      newBalance,
      invoiceNumber,
      message:    `${amount} tokens added to your balance!`,
    });
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
  const { verifyWebhookSignature } = payments.providers.razorpay;

  if (!verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature)) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event   = req.body;
  const payment = event?.payload?.payment?.entity;
  console.log(`Razorpay webhook OK: ${event?.event} · payment ${payment?.id}`);

  if (event.event !== 'payment.captured' || !payment) {
    return res.json({ ok: true });
  }

  const userId    = payment.notes?.user_id;
  const tokens    = parseInt(payment.notes?.tokens);
  const paymentId = payment.id;

  if (!userId || !tokens) return res.json({ ok: true });

  try {
    const { rows: existing } = await pool.query(`SELECT id FROM coin_ledger WHERE payment_id = $1`, [paymentId]);
    if (existing.length) return res.json({ ok: true });

    const priceINR = Math.round(payment.amount / 100);

    await pool.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [tokens, userId]);
    const { rows: ledgerRows } = await pool.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
       VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)
       RETURNING id`,
      [userId, tokens, `Recharge via webhook — ${tokens} tokens`, paymentId, priceINR]
    );

    postSystemMessage('🪙 Someone just recharged their J Tokens!');

    try {
      const { rows: userRows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      const paymentMethodDisplay = payments.describePaymentMethod('razorpay', payment);
      await issueInvoiceForPurchase({
        userId,
        userEmail: userRows[0]?.email,
        userCountry: null,
        coinLedgerId: ledgerRows[0].id,
        tokensPurchased: tokens,
        amountInrEquivalent: priceINR,
        currency: 'INR',
        amountInCurrency: priceINR,
        exchangeRateUsed: null,
        paymentMethodDisplay,
      });
    } catch (err) {
      console.error('webhook invoice error:', err.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;