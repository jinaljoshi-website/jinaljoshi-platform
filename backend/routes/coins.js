const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const authMid = require('../middleware/auth');

const VALID_AMOUNTS = [10, 25, 50, 100];
const TOKEN_RATE = parseInt(process.env.TOKEN_RATE_INR || 66, 10);
const CONSENT_VER = 'voluntary-payment-v1';
const CONSENT_TEXT = 'I am making this payment voluntarily, of my own free will';

// -- GET BALANCE
router.get('/balance', authMid, async (req, res) => {
  const { rows: user } = await pool.query(
    'SELECT coin_balance FROM users WHERE id = $1',
    [req.user.userId]
  );

  const { rows: ledger } = await pool.query(
    'SELECT * FROM coin_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.user.userId]
  );

  res.json({ balance: user[0].coin_balance, ledger });
});

// -- RAZORPAY RECHARGE
router.post('/recharge/razorpay', authMid, async (req, res) => {
  const { amount } = req.body;

  if (!VALID_AMOUNTS.includes(amount)) {
    return res.status(400).json({ error: 'Invalid amount. Must be 10, 25, 50, or 100.' });
  }

  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const amountPaise = amount * TOKEN_RATE * 100;
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    notes: { userId: req.user.userId, wcAmount: String(amount) },
  });

  res.json({
    orderId: order.id,
    key: process.env.RAZORPAY_KEY_ID,
    amountPaise,
    wcAmount: amount,
    inrAmount: amount * TOKEN_RATE,
  });
});

// -- RAZORPAY WEBHOOK
router.post('/webhook/razorpay', express_raw(), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (sig !== expected) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(req.body.toString());
  if (event.event !== 'payment.captured') {
    return res.sendStatus(200);
  }

  const payment = event.payload.payment.entity;
  const { userId, wcAmount, isGift } = payment.notes;
  const coins = parseInt(wcAmount, 10);
  const processorTxId = payment.id;

  if (isGift === 'true') {
    await pool.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('gift_received', $1, $2)`,
      [userId, JSON.stringify({ amount: coins, method: 'fresh_payment', processorTxId })]
    );

    await pool.query(
      `INSERT INTO coin_ledger
       (user_id, type, amount, label, funding_rail, processor_tx_id, consent_version, consent_text_snapshot, consented_at)
       VALUES ($1, 'gift_sent', $2, 'Gift to Jinal Joshi', 'razorpay', $3, $4, $5, NOW())`,
      [userId, coins, processorTxId, CONSENT_VER, CONSENT_TEXT]
    );

    return res.sendStatus(200);
  }

  await creditCoins(userId, coins, 'razorpay', processorTxId);
  res.sendStatus(200);
});

// -- SEGPAY WEBHOOK
router.post('/webhook/segpay', async (req, res) => {
  res.sendStatus(200);
});

// -- VEROTEL WEBHOOK
router.post('/webhook/verotel', async (req, res) => {
  res.sendStatus(200);
});

// -- GIFT FROM BALANCE
router.post('/gift/balance', authMid, async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Invalid gift amount' });
  }

  const { rows } = await pool.query(
    'SELECT coin_balance FROM users WHERE id = $1',
    [req.user.userId]
  );

  if (rows[0].coin_balance < amount) {
    return res.status(402).json({
      error: 'Insufficient balance',
      shortBy: amount - rows[0].coin_balance,
    });
  }

  await pool.query(
    'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2',
    [amount, req.user.userId]
  );

  await pool.query(
    `INSERT INTO coin_ledger (user_id, type, amount, label)
     VALUES ($1, 'gift_sent', $2, 'Gift to Jinal Joshi')`,
    [req.user.userId, amount]
  );

  await pool.query(
    `INSERT INTO artist_notifications (type, fan_id, payload)
     VALUES ('gift_received', $1, $2)`,
    [req.user.userId, JSON.stringify({ amount, method: 'balance' })]
  );

  res.json({ ok: true });
});

// -- GIFT VIA FRESH PAYMENT
router.post('/gift/fresh', authMid, async (req, res) => {
  const { amount } = req.body;

  if (!VALID_AMOUNTS.includes(amount)) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const order = await razorpay.orders.create({
    amount: amount * TOKEN_RATE * 100,
    currency: 'INR',
    notes: { userId: req.user.userId, wcAmount: String(amount), isGift: 'true' },
  });

  res.json({
    orderId: order.id,
    key: process.env.RAZORPAY_KEY_ID,
    amountPaise: amount * TOKEN_RATE * 100,
  });
});

async function creditCoins(userId, coins, rail, processorTxId) {
  await pool.query(
    'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
    [coins, userId]
  );

  await pool.query(
    `INSERT INTO coin_ledger
     (user_id, type, amount, label, funding_rail, processor_tx_id, consent_version, consent_text_snapshot, consented_at)
     VALUES ($1, 'recharge', $2, 'Wonder Coins recharge', $3, $4, $5, $6, NOW())`,
    [userId, coins, rail, processorTxId, CONSENT_VER, CONSENT_TEXT]
  );

  await pool.query(
    `INSERT INTO artist_notifications (type, fan_id, payload)
     VALUES ('recharge', $1, $2)`,
    [userId, JSON.stringify({ amount: coins, rail })]
  );

  const { rows } = await pool.query(
    "SELECT COUNT(*) FROM coin_ledger WHERE user_id = $1 AND type = 'recharge'",
    [userId]
  );

  return { coins, isFirstRecharge: parseInt(rows[0].count, 10) === 1 };
}

function express_raw() {
  return require('express').raw({ type: 'application/json' });
}

module.exports = router;