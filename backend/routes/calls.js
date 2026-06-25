// backend/routes/calls.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');

const DEFAULT_RATES = { audio: 8, video: 15, 'priority-video': 22 };

async function getCallRate(type) {
  const keyMap = {
    audio:            'call_audio_per_min',
    video:            'call_video_per_min',
    'priority-video': 'call_priority_per_min',
  };
  const key = keyMap[type];
  if (!key) return DEFAULT_RATES[type] || 8;
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = $1`, [key]);
    return rows[0] ? parseInt(rows[0].value) : (DEFAULT_RATES[type] || 8);
  } catch { return DEFAULT_RATES[type] || 8; }
}

async function getMemberDiscount(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at FROM users WHERE id = $1`, [userId]
    );
    const user = rows[0];
    if (!user || !user.membership_expires_at || new Date(user.membership_expires_at) <= new Date()) return 0;
    const discounts = { community: 5, insider: 10, premium: 15, supreme: 20 };
    return discounts[user.tier] || 0;
  } catch { return 0; }
}

// ─────────────────────────────────────────────
// GET /api/calls/options
// ─────────────────────────────────────────────

router.get('/options', authMid, async (req, res) => {
  try {
    const [audioRate, videoRate, priorityRate] = await Promise.all([
      getCallRate('audio'),
      getCallRate('video'),
      getCallRate('priority-video'),
    ]);

    const discountPct = await getMemberDiscount(req.user.userId);
    const { rows: userRows } = await pool.query(
      `SELECT coin_balance, tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;

    const applyPricing = (base) => {
      if (isGuest) return base * 2;
      if (!discountPct) return base;
      const raw = base * (1 - discountPct / 100);
      return raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
    };

    const today = new Date().toISOString().slice(0, 10);
    const { rows: slots } = await pool.query(
      `SELECT type, multiplier FROM call_availability WHERE start_date <= $1 AND end_date >= $1`,
      [today]
    );
    const isUnavailable = slots.some((s) => s.type === 'unavailable');
    const primetime     = slots.find((s) => s.type === 'primetime');
    const multiplier    = primetime ? parseFloat(primetime.multiplier) : 1;

    res.json({
      isUnavailable,
      unavailableMessage: isUnavailable ? 'Jinal is unavailable for calls on this date.' : null,
      multiplier,
      isPrimetime:  !!primetime,
      coinBalance:  user.coin_balance,
      discountPct,
      isGuest,
      options: [
        { id: 'audio',          title: 'Audio Call',     description: 'A private audio session.',                          coinsPerMin: Math.round(applyPricing(audioRate)    * multiplier) },
        { id: 'video',          title: 'Video Call',     description: 'A private face-to-face video session.',              coinsPerMin: Math.round(applyPricing(videoRate)    * multiplier) },
        { id: 'priority-video', title: 'Priority Video', description: 'Longer-form video with scheduling priority.',        coinsPerMin: Math.round(applyPricing(priorityRate) * multiplier) },
      ],
    });
  } catch (err) {
    console.error('calls/options error:', err);
    res.status(500).json({ error: 'Failed to load call options' });
  }
});

// ─────────────────────────────────────────────
// POST /api/calls/book
// ─────────────────────────────────────────────

router.post('/book', authMid, async (req, res) => {
  const { callType, durationMinutes } = req.body;

  if (!callType || !durationMinutes || durationMinutes < 1) {
    return res.status(400).json({ error: 'callType and durationMinutes are required' });
  }
  if (!['audio', 'video', 'priority-video'].includes(callType)) {
    return res.status(400).json({ error: 'Invalid call type' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check availability
    const today = new Date().toISOString().slice(0, 10);
    const { rows: slots } = await client.query(
      `SELECT type, multiplier FROM call_availability WHERE start_date <= $1 AND end_date >= $1`,
      [today]
    );
    if (slots.some((s) => s.type === 'unavailable')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'UNAVAILABLE', message: 'Jinal is unavailable for calls on this date.' });
    }

    const primetime  = slots.find((s) => s.type === 'primetime');
    const multiplier = primetime ? parseFloat(primetime.multiplier) : 1;

    const baseRate    = await getCallRate(callType);
    const discountPct = await getMemberDiscount(req.user.userId);

    const { rows: userRows } = await client.query(
      `SELECT coin_balance, tier, membership_expires_at FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;

    let perMin = isGuest ? baseRate * 2 : (discountPct ? (() => {
      const raw = baseRate * (1 - discountPct / 100);
      return raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
    })() : baseRate);
    perMin = Math.round(perMin * multiplier);

    const totalCost = perMin * durationMinutes;

    if (user.coin_balance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `This call costs ${totalCost} tokens. You have ${user.coin_balance}.`,
        required:  totalCost,
        available: user.coin_balance,
        shortBy:   totalCost - user.coin_balance,
      });
    }

    await client.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
      [totalCost, req.user.userId]
    );
    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'call_charge', 'debit', $2, $3)`,
      [req.user.userId, totalCost, `${callType} call — ${durationMinutes} min`]
    );

    const { rows: callRows } = await client.query(
      `INSERT INTO call_requests (user_id, call_type, coins_per_min, coins_charged)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.userId, callType, perMin, totalCost]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('call_request', $1, $2)`,
      [req.user.userId, JSON.stringify({ callType, durationMinutes, totalCost })]
    );

    await client.query('COMMIT');

    // Notify Jinal via push (best-effort, after commit)
    notifyArtist({
      title: 'New call request 📞',
      body:  `${callType} call booked for ${durationMinutes} min · ${totalCost} tokens`,
      url:   '/calls',
    });

    res.json({
      ok:         true,
      call:       callRows[0],
      totalCost,
      newBalance: user.coin_balance - totalCost,
      message:    `${callType} call booked for ${durationMinutes} minutes. Jinal will confirm shortly.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('calls/book error:', err);
    res.status(500).json({ error: 'Failed to book call' });
  } finally {
    client.release();
  }
});

module.exports = router;