// backend/routes/coins.js
// Updated to allow any token amount with bulk discounts

const router = require('express').Router();
const crypto = require('crypto');
const pool   = require('../db/pool');
const authMid = require('../middleware/auth');

const TOKEN_RATE    = parseInt(process.env.TOKEN_RATE_INR || 66, 10);
const CONSENT_VER  = 'voluntary-payment-v1';
const CONSENT_TEXT = 'I am making this payment voluntarily, of my own free will';

// Minimum 1 token, no fixed list — any amount allowed
const MIN_TOKENS = 1;
const MAX_TOKENS = 10000;

// Bulk discount tiers — mirrors data.js
function getDiscount(tokens) {
  if (tokens >= 1000) return 10;
  if (tokens >= 500)  return 5;
  return 0;
}

function calcAmountPaise(tokens) {
  const base     = tokens * TOKEN_RATE * 100; // paise
  const pct      = getDiscount(tokens);
  const discount = pct ? Math.round(base * pct / 100) : 0;
  return base - discount;
}

// ── GET BALANCE ──────────────────────────────

router.get('/balance', authMid, async (req, res) => {
  const { rows: user } = await pool.query(
    'SELECT coin_balance FROM users WHERE id = $1', [req.user.userId]
  );
  const { rows: ledger } = await pool.query(
    'SELECT * FROM coin_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.user.userId]
  );
  res.json({ balance: user[0].coin_balance, ledger });
});

// ── RAZORPAY RECHARGE ────────────────────────

router.post('/recharge/razorpay', authMid, async (req, res) => {
  const { amount } = req.body;
  const tokens = parseInt(amount, 10);

  if (!tokens || tokens < MIN_TOKENS || tokens > MAX_TOKENS) {
    return res.status(400).json({ error: `Amount must be between ${MIN_TOKENS} and ${MAX_TOKENS} tokens.` });
  }

  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const amountPaise = calcAmountPaise(tokens);
  const order = await razorpay.orders.create({
    amount:   amountPaise,
    currency: 'INR',
    notes:    { userId: req.user.userId, wcAmount: String(tokens) },
  });

  res.json({
    orderId:    order.id,
    key:        process.env.RAZORPAY_KEY_ID,
    amountPaise,
    wcAmount:   tokens,
    inrAmount:  amountPaise / 100,
    discountPct: getDiscount(tokens),
  });
});

// ── RAZORPAY WEBHOOK ─────────────────────────

router.post('/webhook/razorpay', express_raw(), async (req, res) => {
  const sig      = req.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (sig !== expected) return res.status(400).json({ error: 'Invalid signature' });

  const event = JSON.parse(req.body.toString());
  if (event.event !== 'payment.captured') return res.sendStatus(200);

  const payment = event.payload.payment.entity;
  const { userId, wcAmount, isGift } = payment.notes;
  const coins         = parseInt(wcAmount, 10);
  const processorTxId = payment.id;

  if (isGift === 'true') {
    await pool.query(
      `INSERT INTO artist_notifications (type, fan_id, payload) VALUES ('gift_received', $1, $2)`,
      [userId, JSON.stringify({ amount: coins, method: 'fresh_payment', processorTxId })]
    );
    await pool.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, funding_rail, processor_tx_id, consent_version, consented_at)
       VALUES ($1, 'gift_sent', 'debit', $2, 'Gift to Jinal Joshi', 'razorpay', $3, $4, NOW())`,
      [userId, coins, processorTxId, CONSENT_VER]
    );
    return res.sendStatus(200);
  }

  await creditCoins(userId, coins, 'razorpay', processorTxId);
  res.sendStatus(200);
});

// ── GIFT FROM BALANCE ────────────────────────

router.post('/gift/balance', authMid, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid gift amount' });

  const { rows } = await pool.query('SELECT coin_balance FROM users WHERE id = $1', [req.user.userId]);
  if (rows[0].coin_balance < amount) {
    return res.status(402).json({ error: 'Insufficient balance', shortBy: amount - rows[0].coin_balance });
  }

  await pool.query('UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2', [amount, req.user.userId]);
  await pool.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label) VALUES ($1, 'gift_sent', 'debit', $2, 'Gift to Jinal Joshi')`,
    [req.user.userId, amount]
  );
  await pool.query(
    `INSERT INTO artist_notifications (type, fan_id, payload) VALUES ('gift_received', $1, $2)`,
    [req.user.userId, JSON.stringify({ amount, method: 'balance' })]
  );
  res.json({ ok: true });
});

// ── WEBHOOKS (stubs) ─────────────────────────

router.post('/webhook/segpay', async (req, res) => res.sendStatus(200));
router.post('/webhook/verotel', async (req, res) => res.sendStatus(200));

// ── CREDIT HELPER ────────────────────────────

async function creditCoins(userId, coins, rail, processorTxId) {
  await pool.query('UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2', [coins, userId]);
  await pool.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, funding_rail, processor_tx_id, consent_version, consented_at)
     VALUES ($1, 'recharge', 'credit', $2, 'J Token recharge', $3, $4, $5, NOW())`,
    [userId, coins, rail, processorTxId, CONSENT_VER]
  );
  await pool.query(
    `INSERT INTO artist_notifications (type, fan_id, payload) VALUES ('recharge', $1, $2)`,
    [userId, JSON.stringify({ amount: coins, rail })]
  );
}

function express_raw() {
  return require('express').raw({ type: 'application/json' });
}

module.exports = router;