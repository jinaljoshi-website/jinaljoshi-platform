// backend/routes/streamcalls.js

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');

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

    // Upsert both users first
    await client.upsertUsers([
      { id: req.user.userId,  name: 'Jinal Joshi', role: 'admin'  },
      { id: callReq.fan_id,   name: callReq.display_name || callReq.email, role: 'user' },
    ]);

    const call = client.video.call('default', callId);
    await call.getOrCreate({
      data: {
        created_by_id: req.user.userId,
        members: [
          { user_id: req.user.userId, role: 'admin'  },
          { user_id: callReq.fan_id,  role: 'member' },
        ],
        custom: { callRequestId, callType: callReq.call_type },
      },
    });

    await pool.query(
      `UPDATE call_requests SET stream_call_id = $1, status = 'confirmed' WHERE id = $2`,
      [callId, callRequestId]
    );

    await pool.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('call_confirmed', $1, $2)`,
      [callReq.fan_id, JSON.stringify({ callId, callType: callReq.call_type })]
    );

    res.json({ ok: true, callId, callType: callReq.call_type });
  } catch (err) {
    console.error('stream-calls/create error:', err);
    res.status(500).json({ error: 'Failed to create call: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/stream-calls/my-calls
// ─────────────────────────────────────────────

router.get('/my-calls', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, call_type, status, stream_call_id, coins_charged, coins_per_min, created_at
       FROM call_requests
       WHERE user_id = $1
       AND status IN ('confirmed', 'completed', 'pending')
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

module.exports = router;