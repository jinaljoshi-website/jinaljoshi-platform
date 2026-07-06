// backend/routes/calls.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { postSystemMessage } = require('./community');
const { getConfigNumber, getDiscountForTier, getGuestMultiplier } = require('../lib/config');

const MAX_NEGOTIATION_ROUND = 4;

async function getCallRate(type) {
  const keyMap = {
    audio:            'call_audio_per_min',
    video:            'call_video_per_min',
    'priority-video': 'call_priority_per_min',
  };
  const key = keyMap[type];
  if (!key) return 8;
  return getConfigNumber(key);
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

    const { rows: userRows } = await pool.query(
      `SELECT coin_balance, tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;
    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(user.tier),
      isGuest ? getGuestMultiplier() : 1,
    ]);

    const applyPricing = (base) => {
      if (isGuest) return base * guestMultiplier;
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
  const { callType, durationMinutes, proposedTime } = req.body;

  if (!callType || !durationMinutes || durationMinutes < 1) {
    return res.status(400).json({ error: 'callType and durationMinutes are required' });
  }
  if (!['audio', 'video', 'priority-video'].includes(callType)) {
    return res.status(400).json({ error: 'Invalid call type' });
  }
  if (!proposedTime) {
    return res.status(400).json({ error: 'Please propose a time for the call' });
  }
  const proposedDate = new Date(proposedTime);
  if (isNaN(proposedDate.getTime()) || proposedDate <= new Date()) {
    return res.status(400).json({ error: 'Proposed time must be a valid time in the future' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const baseRate = await getCallRate(callType);

    const { rows: userRows } = await client.query(
      `SELECT coin_balance, tier, membership_expires_at, display_name FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;
    const fanLabel = user.display_name || 'A member';
    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(user.tier),
      isGuest ? getGuestMultiplier() : 1,
    ]);

    let perMin = isGuest ? baseRate * guestMultiplier : (discountPct ? (() => {
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
      `INSERT INTO call_requests (user_id, call_type, coins_per_min, coins_charged, proposed_time, proposed_by, negotiation_round)
       VALUES ($1, $2, $3, $4, $5, 'fan', 1) RETURNING *`,
      [req.user.userId, callType, perMin, totalCost, proposedDate]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('call_request', $1, $2)`,
      [req.user.userId, JSON.stringify({ callType, durationMinutes, totalCost, proposedTime: proposedDate })]
    );

    await client.query('COMMIT');

    if (callType === 'priority-video') {
      notifyArtist({
        title: '🔴 PRIORITY call request!',
        body:  `${fanLabel} wants a priority call — proposed ${proposedDate.toLocaleString()}`,
        url:   '/calls',
        vibrate: [100, 50, 100, 50, 100, 50, 300],
        requireInteraction: true,
        tag: `priority-call-${callRows[0].id}`,
      });
    } else {
      notifyArtist({
        title: 'New call request 📞',
        body:  `${callType} call requested for ${durationMinutes} min · proposed ${proposedDate.toLocaleString()}`,
        url:   '/calls',
      });
    }

    postSystemMessage(`📞 ${fanLabel} just booked a call with Jinal!`);

    res.json({
      ok:         true,
      call:       callRows[0],
      totalCost,
      newBalance: user.coin_balance - totalCost,
      message:    `Your call request has been sent to Jinal for confirmation.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('calls/book error:', err);
    res.status(500).json({ error: 'Failed to book call' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/calls/:id/respond  [FAN]
// ─────────────────────────────────────────────

router.post('/:id/respond', authMid, async (req, res) => {
  const { action, proposedTime, reason } = req.body;
  if (!['accept', 'counter', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];

    if (call.proposed_by !== 'jinal') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are not awaiting a response on this call' });
    }

    if (action === 'accept') {
      await client.query(
        `UPDATE call_requests SET status = 'scheduled', scheduled_at = $1 WHERE id = $2`,
        [call.proposed_time, call.id]
      );
      await client.query('COMMIT');
      notifyArtist({ title: 'Call confirmed ✓', body: `Time confirmed for ${new Date(call.proposed_time).toLocaleString()}`, url: '/calls' });
      return res.json({ ok: true, message: 'Call time confirmed!' });
    }

    if (action === 'reject') {
      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [call.coins_charged, call.user_id]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'call_refund', 'credit', $2, $3, $4)`,
        [call.user_id, call.coins_charged, `Refund: proposed call time declined`, call.id]
      );
      await client.query(
        `UPDATE call_requests SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
        ['Fan declined the proposed time.', call.id]
      );
      await client.query('COMMIT');
      notifyArtist({ title: 'Call declined', body: `The fan declined the proposed time. Tokens refunded.`, url: '/calls' });
      return res.json({ ok: true, message: 'Call declined and your tokens have been refunded.' });
    }

    if (call.negotiation_round >= MAX_NEGOTIATION_ROUND) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No more counter-proposals are available. Please accept or decline.' });
    }
    if (!proposedTime) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Please propose a new time' });
    }
    const newDate = new Date(proposedTime);
    if (isNaN(newDate.getTime()) || newDate <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Proposed time must be a valid time in the future' });
    }

    await client.query(
      `UPDATE call_requests SET proposed_time = $1, proposed_by = 'fan', negotiation_round = negotiation_round + 1 WHERE id = $2`,
      [newDate, call.id]
    );
    await client.query('COMMIT');

    notifyArtist({ title: 'New time proposed', body: `Fan proposed a different time: ${newDate.toLocaleString()}`, url: '/calls' });

    res.json({ ok: true, message: 'Your new proposed time has been sent to Jinal.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('calls/respond error:', err);
    res.status(500).json({ error: 'Failed to respond' });
  } finally {
    client.release();
  }
});

module.exports = router;