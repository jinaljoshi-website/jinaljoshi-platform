// backend/routes/calls.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist, ringArtist } = require('../lib/notify');
const { pushToUser } = require('./push');
const { postSystemMessage } = require('./community');
const { getConfigNumber, getDiscountForTier, getGuestMultiplier, getCallMinLeadHours, getCallRingWindowSeconds, getDndEnabled } = require('../lib/config');
const { assertNotBlocked, assertNotMuted } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');
const { spendTokens, refundByRelated } = require('../lib/tokens');

const MAX_NEGOTIATION_ROUND = 4;

// Four rates: a call is instant or scheduled, and audio or video.
//
// call_priority_per_min keeps its name rather than gaining a -video suffix.
// Renaming a live config key means a window where the old name is gone and the
// new one is not yet set, and every call in that window is unpriced. The name
// is only slightly wrong; a missing price is not.
// Audio is not offered. Stream defaults every call to video on, so an audio
// call opened the camera anyway — somebody who chose audio and paid the audio
// rate appeared on video, which is worse than charging them wrongly. Rather
// than carry a second media path for a feature nobody had asked for, calls are
// video only.
//
// The audio keys stay here so a rate lookup on a call booked before this does
// not throw, and so the choice can come back without a migration if it is ever
// worth making work properly.
const CALL_RATE_KEYS = {
  audio:            'call_audio_per_min',
  video:            'call_video_per_min',
  'priority-audio': 'call_priority_audio_per_min',
  'priority-video': 'call_priority_per_min',
};

// What a fan may actually book now.
const BOOKABLE_TYPES = ['video', 'priority-video'];

async function getCallRate(type) {
  const key = CALL_RATE_KEYS[type];
  // No fallback. This used to return 8 for anything unrecognised, which is a
  // hardcoded price — the one thing config.js exists to prevent. A call type
  // nobody has priced should fail loudly, not quietly cost eight tokens.
  if (!key) throw new Error(`No rate configured for call type: ${type}`);
  return getConfigNumber(key);
}

function getStreamClient() {
  const { StreamClient } = require('@stream-io/node-sdk');
  return new StreamClient(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
  );
}

// ─────────────────────────────────────────────
// GET /api/calls/options
// ─────────────────────────────────────────────

router.get('/options', authMid, async (req, res) => {
  try {
    const [audioRate, videoRate, instantAudioRate, instantVideoRate] = await Promise.all([
      getCallRate('audio'),
      getCallRate('video'),
      getCallRate('priority-audio'),
      getCallRate('priority-video'),
    ]);

    const { rows: userRows } = await pool.query(
      `SELECT coin_balance, tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;
    const [discountPct, guestMultiplier, minLeadHours] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(user.tier),
      isGuest ? getGuestMultiplier() : 1,
      getCallMinLeadHours(),
    ]);

    const applyPricing = (base) => {
      if (isGuest) return roundTokensUp(base * guestMultiplier);
      if (!discountPct) return roundTokensUp(base);
      return roundTokensUp(base * (1 - discountPct / 100));
    };

    const today = new Date().toISOString().slice(0, 10);
    const { rows: slots } = await pool.query(
      `SELECT type, multiplier FROM call_availability WHERE start_date <= $1 AND end_date >= $1`,
      [today]
    );
    const isUnavailable = slots.some((s) => s.type === 'unavailable');
    const primetime     = slots.find((s) => s.type === 'primetime');
    const multiplier    = primetime ? parseFloat(primetime.multiplier) : 1;

    const dndActive = await getDndEnabled();

    res.json({
      isUnavailable,
      unavailableMessage: isUnavailable ? 'Jinal is unavailable for calls on this date.' : null,
      multiplier,
      isPrimetime:  !!primetime,
      coinBalance:  user.coin_balance,
      discountPct,
      isGuest,
      minLeadHours,
      dndActive,
      // Grouped by what the fan is deciding, in the order they decide it:
      // now or later first, then audio or video. The page used to list three
      // flat options with the instant one last, which put the thing most people
      // want at the bottom and split audio and video across two groups.
      groups: [
        {
          id: 'instant',
          title: 'Connect now',
          description: 'Rings Jinal and connects if she is free to answer.',
          options: [
            { id: 'priority-video', media: 'video', label: 'Video', coinsPerMin: roundTokensUp(applyPricing(instantVideoRate) * multiplier) },
          ],
        },
        {
          id: 'scheduled',
          title: 'Schedule a call',
          description: 'Pick a time at least a few hours ahead. Jinal can accept it or suggest another.',
          options: [
            { id: 'video', media: 'video', label: 'Video', coinsPerMin: roundTokensUp(applyPricing(videoRate) * multiplier) },
          ],
        },
      ],

      // Kept alongside so an older bundle still served from a cache does not
      // lose its call page the moment this deploys.
      options: [
        { id: 'audio',          title: 'Scheduled audio',   description: 'A voice call, arranged in advance.', coinsPerMin: roundTokensUp(applyPricing(audioRate)         * multiplier) },
        { id: 'video',          title: 'Scheduled video',   description: 'A video call, arranged in advance.', coinsPerMin: roundTokensUp(applyPricing(videoRate)         * multiplier) },
        { id: 'priority-video', title: 'Connect instantly', description: 'Rings Jinal now.',                    coinsPerMin: roundTokensUp(applyPricing(instantVideoRate) * multiplier) },
      ],
    });
  } catch (err) {
    console.error('calls/options error:', err);
    res.status(500).json({ error: 'Failed to load call options' });
  }
});

// ─────────────────────────────────────────────
// POST /api/calls/book
// Priority calls: create the room instantly and ring Jinal — no proposed time needed
// Audio/Video calls: standard scheduling negotiation, minimum lead time enforced
// ─────────────────────────────────────────────

router.post('/book', authMid, async (req, res) => {
  const { callType, durationMinutes, proposedTime } = req.body;

  if (!callType || !durationMinutes || durationMinutes < 1) {
    return res.status(400).json({ error: 'callType and durationMinutes are required' });
  }
  if (!BOOKABLE_TYPES.includes(callType)) {
    return res.status(400).json({ error: 'Invalid call type' });
  }

  try {
    await assertNotBlocked(req.user.userId);
    await assertNotMuted(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }
  // Instant is the prefix, not one specific type. Testing against a single
  // string meant instant audio would have been treated as a scheduled call —
  // booked for a time rather than ringing anybody.
  const isPriority = callType.startsWith('priority-');

  if (isPriority) {
    const dndActive = await getDndEnabled();
    if (dndActive) {
      return res.status(409).json({
        error: 'DND_ACTIVE',
        message: "Jinal isn't available for instant calls right now. Try scheduling a call instead — she'll get back to you.",
      });
    }
  }

  let proposedDate = null;
  if (!isPriority) {
    if (!proposedTime) {
      return res.status(400).json({ error: 'Please propose a time for the call' });
    }
    proposedDate = new Date(proposedTime);
    if (isNaN(proposedDate.getTime())) {
      return res.status(400).json({ error: 'Proposed time must be a valid date' });
    }
    const minLeadHours = await getCallMinLeadHours();
    const earliestAllowed = new Date(Date.now() + minLeadHours * 60 * 60 * 1000);
    if (proposedDate < earliestAllowed) {
      return res.status(400).json({
        error: 'TOO_SOON',
        message: `Scheduled calls need at least ${minLeadHours} hours' notice. For anything sooner, book a Priority Video call instead.`,
      });
    }
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
      `SELECT coin_balance, tier, membership_expires_at, display_name, email FROM users WHERE id = $1 FOR UPDATE`,
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

    let perMin = isGuest ? roundTokensUp(baseRate * guestMultiplier) : (discountPct ? roundTokensUp(baseRate * (1 - discountPct / 100)) : baseRate);
    perMin = roundTokensUp(perMin * multiplier);

    const totalCost = perMin * durationMinutes;

    // Calls are Jinal's time, so they must be paid for with purchased tokens.
    // Gifted credit is for messages and content only.
    let spend;
    try {
      spend = await spendTokens(client, {
        userId:      req.user.userId,
        amount:      totalCost,
        type:        'call_charge',
        label:       `${callType} call — ${durationMinutes} min`,
        allowGifted: false,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        await client.query('ROLLBACK');
        return res.status(402).json(err.httpBody);
      }
      throw err;
    }

    let callRow;

    if (isPriority) {
      // Create the Stream room right now — this call rings Jinal immediately, no scheduling step
      const ringWindowSeconds = await getCallRingWindowSeconds();
      const ringExpiresAt = new Date(Date.now() + ringWindowSeconds * 1000);
      const callId = `ps-call-${req.user.userId}-${Date.now()}`;

      const streamClient = getStreamClient();
      await streamClient.upsertUsers([
        { id: process.env.ARTIST_USER_ID, name: 'Jinal Joshi', role: 'admin' },
        { id: req.user.userId, name: fanLabel, role: 'user' },
      ]);
      const call = streamClient.video.call('default', callId);
      await call.getOrCreate({
        data: {
          created_by_id: req.user.userId,
          members: [
            { user_id: process.env.ARTIST_USER_ID, role: 'admin' },
            { user_id: req.user.userId, role: 'user' },
          ],
          custom: { callType },
        },
      });

      const { rows } = await client.query(
        `INSERT INTO call_requests
           (user_id, call_type, coins_per_min, coins_charged, status, stream_call_id, ring_expires_at, proposed_by, negotiation_round)
         VALUES ($1, $2, $3, $4, 'ringing', $5, $6, 'fan', 1) RETURNING *`,
        [req.user.userId, callType, perMin, totalCost, callId, ringExpiresAt]
      );
      callRow = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO call_requests (user_id, call_type, coins_per_min, coins_charged, proposed_time, proposed_by, negotiation_round)
         VALUES ($1, $2, $3, $4, $5, 'fan', 1) RETURNING *`,
        [req.user.userId, callType, perMin, totalCost, proposedDate]
      );
      callRow = rows[0];
    }

    // The ledger row is written before the call exists, so link it now — refunds
    // look the original spend up by call id.
    await client.query(`UPDATE coin_ledger SET related_id = $1 WHERE id = $2`, [callRow.id, spend.ledgerId]);

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ($1, $2, $3)`,
      [isPriority ? 'priority_call_ringing' : 'call_request', req.user.userId,
       JSON.stringify({ callType, durationMinutes, totalCost, proposedTime: proposedDate })]
    );

    await client.query('COMMIT');

    // Who is calling, what they pay for and what it cost them — enough for Jinal
    // to decide whether to answer without opening anything.
    const tierLabel = isGuest ? 'Guest' : user.tier.charAt(0).toUpperCase() + user.tier.slice(1);

    if (isPriority) {
      ringArtist({
        title: `📞 ${fanLabel} is calling`,
        body:  `${tierLabel} · ${durationMinutes} min · ${totalCost} tokens`,
        url:   '/calls',
        tag:   `priority-ring-${callRow.id}`,
        // Repeats stop the moment the call is answered or times out, so
        // picking up quickly does not leave the phone chiming.
        stillRinging: async () => {
          const { rows } = await pool.query(
            `SELECT status FROM call_requests WHERE id = $1`, [callRow.id]
          );
          return rows[0]?.status === 'ringing';
        },
        // Rings for as long as the call actually rings, read from the same
        // config the fan's countdown uses — so the two can never disagree.
      }, { durationMs: (await getCallRingWindowSeconds()) * 1000 });
      postSystemMessage(`🔴 ${fanLabel} just started a priority call with Jinal!`, { kind: 'activity', name: fanLabel });
    } else {
      notifyArtist({
        title: `📞 Call request from ${fanLabel}`,
        body:  `${tierLabel} · ${callType} · ${durationMinutes} min · ${totalCost} tokens · proposed ${proposedDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        url:   '/calls',
      });
      postSystemMessage(`📞 ${fanLabel} just booked a call with Jinal!`, { kind: 'activity', name: fanLabel });
    }

    res.json({
      ok:         true,
      call:       callRow,
      totalCost,
      // Read back from the spend rather than subtracted from what was loaded
      // earlier. A spend can draw on bonus tokens, which do not sit in
      // coin_balance, so subtracting the whole cost from it reported a balance
      // lower than the fan actually holds until something forced a refresh.
      newBalance: spend.newPurchased,
      isPriority,
      message: isPriority
        ? 'Calling Jinal now — hang tight.'
        : 'Your call request has been sent to Jinal for confirmation.',
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
// Minimum lead time enforced on counter-proposals too
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
      `SELECT cr.*, u.display_name, u.email
         FROM call_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.id = $1 AND cr.user_id = $2 FOR UPDATE OF cr`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];
    // Named, not "the fan". A notification that could be about anybody is one
    // more thing to go and look up before it can be acted on.
    const who = call.display_name || call.email || 'A member';

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
      notifyArtist({ title: 'Call confirmed ✓', body: `${who} confirmed ${new Date(call.proposed_time).toLocaleString('en-IN')}`, url: '/calls' });
      return res.json({ ok: true, message: 'Call time confirmed!' });
    }

    if (action === 'reject') {
      await refundByRelated(client, {
        userId:     call.user_id,
        type:       'call_charge',
        relatedId:  call.id,
        label:      'Refund: proposed call time declined',
        refundType: 'call_refund',
      });
      await client.query(
        `UPDATE call_requests SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
        ['Fan declined the proposed time.', call.id]
      );
      await client.query('COMMIT');
      notifyArtist({ title: 'Call declined', body: `${who} declined the proposed time. Tokens refunded.`, url: '/calls' });
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
    if (isNaN(newDate.getTime())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Proposed time must be a valid date' });
    }
    const minLeadHours = await getCallMinLeadHours();
    const earliestAllowed = new Date(Date.now() + minLeadHours * 60 * 60 * 1000);
    if (newDate < earliestAllowed) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Proposed time must be at least ${minLeadHours} hours from now` });
    }

    await client.query(
      `UPDATE call_requests SET proposed_time = $1, proposed_by = 'fan', negotiation_round = negotiation_round + 1 WHERE id = $2`,
      [newDate, call.id]
    );
    await client.query('COMMIT');

    notifyArtist({ title: 'New time proposed', body: `${who} proposed ${newDate.toLocaleString('en-IN')} instead`, url: '/calls' });

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