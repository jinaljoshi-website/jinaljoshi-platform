// backend/routes/streamcalls.js

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { notifyArtist } = require('../lib/notify');
const { pushToUser } = require('./push');
const { getCallRingWindowSeconds } = require('../lib/config');
const { refundByRelated } = require('../lib/tokens');

const MAX_NEGOTIATION_ROUND = 4;

function getStreamClient() {
  const { StreamClient } = require('@stream-io/node-sdk');
  return new StreamClient(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
  );
}

// ─────────────────────────────────────────────
// POST /api/stream-calls/token
// ─────────────────────────────────────────────

router.post('/token', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const client = getStreamClient();

    await client.upsertUsers([{
      id:   req.user.userId,
      name: user.display_name || user.email,
      role: req.user.isArtist ? 'admin' : 'user',
    }]);

    const token = client.generateUserToken({ user_id: req.user.userId });

    res.json({
      token,
      userId:   req.user.userId,
      userName: user.display_name || user.email,
      apiKey:   process.env.STREAM_API_KEY,
    });
  } catch (err) {
    console.error('stream-calls/token error:', err);
    res.status(500).json({ error: 'Failed to generate call token: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/stream-calls/create  [ARTIST ONLY]
// For scheduled calls — Jinal starts it, this rings the fan
// ─────────────────────────────────────────────

router.post('/create', authMid, artistOnly, async (req, res) => {
  const { callRequestId } = req.body;
  if (!callRequestId) return res.status(400).json({ error: 'callRequestId is required' });

  try {
    const { rows } = await pool.query(
      `SELECT cr.*, u.id AS fan_id, u.email, u.display_name
       FROM call_requests cr
       JOIN users u ON u.id = cr.user_id
       WHERE cr.id = $1`,
      [callRequestId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call request not found' });

    const callReq = rows[0];
    const callId  = `ps-call-${callRequestId}`;
    const client  = getStreamClient();

    await client.upsertUsers([
      { id: req.user.userId,  name: 'Jinal Joshi', role: 'admin'  },
      { id: callReq.fan_id,   name: callReq.display_name || callReq.email, role: 'user' },
    ]);

    const call = client.video.call('default', callId);
    await call.getOrCreate({
      data: {
        created_by_id: req.user.userId,
        members: [
          { user_id: req.user.userId, role: 'admin' },
          { user_id: callReq.fan_id,  role: 'user'  },
        ],
        custom: { callRequestId, callType: callReq.call_type },
      },
    });

    const ringWindowSeconds = await getCallRingWindowSeconds();
    const ringExpiresAt = new Date(Date.now() + ringWindowSeconds * 1000);

    await pool.query(
      `UPDATE call_requests SET stream_call_id = $1, status = 'ringing', ring_expires_at = $2 WHERE id = $3`,
      [callId, ringExpiresAt, callRequestId]
    );

    await pool.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('call_confirmed', $1, $2)`,
      [callReq.fan_id, JSON.stringify({ callId, callType: callReq.call_type })]
    );

    pushToUser(callReq.fan_id, {
      title: '📞 Jinal is calling you now!',
      body:  `Tap to answer your ${callReq.call_type} call`,
      url:   '/platform/calls',
      vibrate: [150, 80, 150, 80, 150, 80, 400],
      requireInteraction: true,
      tag: `call-live-${callRequestId}`,
    });

    res.json({ ok: true, callId, callType: callReq.call_type, ringExpiresAt });
  } catch (err) {
    console.error('stream-calls/create error:', err);
    res.status(500).json({ error: 'Failed to create call: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/stream-calls/:id/decline
// Either side can explicitly decline while a call is ringing, rather than letting it time out
// ─────────────────────────────────────────────

router.post('/:id/decline', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT cr.*, u.display_name, u.email
         FROM call_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.id = $1 FOR UPDATE OF cr`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];
    // Named rather than "the fan".
    const who = call.display_name || call.email || 'A member';

    if (!req.user.isArtist && call.user_id !== req.user.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Not authorised' });
    }
    if (call.status !== 'ringing') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This call is not currently ringing' });
    }

    const declinedBy = req.user.isArtist ? 'Jinal' : 'The fan';
    const reason = `${declinedBy} was unable to answer.`;

    await refundByRelated(client, {
      userId:     call.user_id,
      type:       'call_charge',
      relatedId:  call.id,
      label:      'Refund: call declined',
      refundType: 'call_refund',
    });
    await client.query(
      `UPDATE call_requests SET status = 'missed', rejection_reason = $1 WHERE id = $2`,
      [reason, call.id]
    );

    if (call.stream_call_id) {
      try {
        const streamClient = getStreamClient();
        await streamClient.video.call('default', call.stream_call_id).end();
      } catch (e) { console.error('Failed to end declined call room:', e.message); }
    }

    await client.query('COMMIT');

    if (req.user.isArtist) {
      pushToUser(call.user_id, {
        title: 'Call missed',
        body:  'Jinal was unable to answer. Your tokens have been refunded.',
        url:   '/platform/calls',
      });
    } else {
      notifyArtist({ title: 'Call declined', body: `${who} declined the call. Tokens refunded.`, url: '/calls' });
    }

    res.json({ ok: true, message: 'Call ended and tokens refunded.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('stream-calls/decline error:', err);
    res.status(500).json({ error: 'Failed to decline call' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/stream-calls/:id/artist-respond  [ARTIST ONLY]
// Jinal responds to a time the fan proposed during scheduling negotiation
// ─────────────────────────────────────────────

router.post('/:id/artist-respond', authMid, artistOnly, async (req, res) => {
  const { action, proposedTime, reason } = req.body;
  if (!['accept', 'counter', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];

    if (call.proposed_by !== 'fan') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are not awaiting a response on this call' });
    }

    if (action === 'accept') {
      await client.query(
        `UPDATE call_requests SET status = 'scheduled', scheduled_at = $1 WHERE id = $2`,
        [call.proposed_time, call.id]
      );
      await client.query('COMMIT');
      pushToUser(call.user_id, {
        title: 'Call confirmed ✓',
        body:  `Your call is scheduled for ${new Date(call.proposed_time).toLocaleString()}`,
        url:   '/platform/calls',
      });
      return res.json({ ok: true, message: 'Call time confirmed!' });
    }

    if (action === 'reject') {
      await refundByRelated(client, {
        userId:     call.user_id,
        type:       'call_charge',
        relatedId:  call.id,
        label:      'Refund: call declined by Jinal',
        refundType: 'call_refund',
      });
      await client.query(
        `UPDATE call_requests SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
        [reason || 'Declined by Jinal.', call.id]
      );
      await client.query('COMMIT');
      pushToUser(call.user_id, {
        title: 'Call request declined',
        body:  reason || 'Your tokens have been refunded.',
        url:   '/platform/calls',
      });
      return res.json({ ok: true, message: 'Call declined and the fan has been refunded.' });
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

    await client.query(
      `UPDATE call_requests SET proposed_time = $1, proposed_by = 'jinal', negotiation_round = negotiation_round + 1 WHERE id = $2`,
      [newDate, call.id]
    );
    await client.query('COMMIT');

    pushToUser(call.user_id, {
      title: 'New time proposed',
      body:  `Jinal proposed a different time: ${newDate.toLocaleString()}`,
      url:   '/platform/calls',
    });

    res.json({ ok: true, message: 'Your proposed time has been sent to the fan.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('stream-calls/artist-respond error:', err);
    res.status(500).json({ error: 'Failed to respond' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/stream-calls/:id/joined
// ─────────────────────────────────────────────

router.post('/:id/joined', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];
    const field = req.user.isArtist ? 'artist_joined_at' : 'fan_joined_at';

    await client.query(
      `UPDATE call_requests SET ${field} = COALESCE(${field}, NOW()) WHERE id = $1`,
      [call.id]
    );

    const { rows: refreshed } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1`, [call.id]
    );
    const updated = refreshed[0];

    if (updated.fan_joined_at && updated.artist_joined_at && !updated.call_started_at) {
      await client.query(
        `UPDATE call_requests SET call_started_at = NOW(), status = 'in_progress' WHERE id = $1`,
        [call.id]
      );
    }

    await client.query('COMMIT');

    const { rows: finalRows } = await pool.query(`SELECT * FROM call_requests WHERE id = $1`, [call.id]);
    res.json({ ok: true, call: finalRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('stream-calls/joined error:', err);
    res.status(500).json({ error: 'Failed to register join' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// GET /api/stream-calls/my-calls
// IMPORTANT: this literal route MUST be registered before the generic GET /:id
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// POST /api/stream-calls/:id/leave
// ─────────────────────────────────────────────
//
// Hanging up ends the call. For either party — whoever puts the phone down
// first ends it for both, which is how a telephone has always worked.
//
// Nothing did this before. Leaving tore down the local connection and told the
// server nothing, so the row sat at in_progress until the scheduler's duration
// cutoff came round. Studio went on showing the call as live for the whole
// paid duration however many times the red button was pressed, and the room
// stayed open behind it.
//
// Time already spent is not refunded. The minutes were bought and the call
// happened; leaving early is the caller's choice, and it is the same on any
// other platform.
router.post('/:id/leave', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const call = rows[0];

    // Only the two people on it may end it.
    if (!req.user.isArtist && call.user_id !== req.user.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Not your call' });
    }

    // Already over. Answering ok rather than an error means a hangup from both
    // ends — which is the normal case — does not surface an error to whoever
    // was second.
    if (!['in_progress', 'ringing'].includes(call.status)) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, status: call.status, alreadyEnded: true });
    }

    // Status only. call_ended_at is not a column anybody else writes, and
    // inventing one here would make every hangup fail on a database that does
    // not have it.
    await client.query(
      `UPDATE call_requests SET status = 'completed' WHERE id = $1`,
      [call.id]
    );
    await client.query('COMMIT');

    // The room after the record, so a slow Stream call cannot leave the row
    // saying in_progress when it is not.
    if (call.stream_call_id) {
      try {
        await getStreamClient().video.call('default', call.stream_call_id).end();
      } catch (e) {
        // Already ended by the other side or by the cutoff job. Not a failure.
        if (!/already|not found/i.test(e.message || '')) {
          console.error('stream-calls/leave: could not end room:', e.message);
        }
      }
    }

    res.json({ ok: true, status: 'completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('stream-calls/leave error:', err);
    res.status(500).json({ error: 'Could not end the call' });
  } finally {
    client.release();
  }
});

router.get('/my-calls', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, call_type, status, stream_call_id, coins_charged, coins_per_min,
              rejection_reason, proposed_time, proposed_by, negotiation_round,
              scheduled_at, call_started_at, ring_expires_at,
              fan_joined_at, artist_joined_at, created_at
       FROM call_requests
       WHERE user_id = $1
       AND status IN ('confirmed', 'completed', 'pending', 'rejected', 'scheduled', 'in_progress', 'ringing', 'missed')
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.user.userId]
    );
    res.json({ calls: rows });
  } catch (err) {
    console.error('stream-calls/my-calls error:', err);
    res.status(500).json({ error: 'Failed to load calls: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/stream-calls/:id
// Registered LAST — this generic pattern must never come before a literal route like /my-calls
// ─────────────────────────────────────────────

router.get('/:id', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, call_type, status, stream_call_id, coins_charged, coins_per_min,
              fan_joined_at, artist_joined_at, call_started_at, ring_expires_at,
              rejection_reason
       FROM call_requests WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Call not found' });
    const call = rows[0];

    if (!req.user.isArtist && call.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorised' });
    }

    res.json({ call });
  } catch (err) {
    console.error('stream-calls/:id error:', err);
    res.status(500).json({ error: 'Failed to load call status' });
  }
});

module.exports = router;