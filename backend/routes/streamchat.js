// backend/routes/streamchat.js
// Stream Chat token generation for real-time messaging

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');

function getStreamClient() {
  const { StreamClient } = require('@stream-io/node-sdk');
  return new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET);
}

// POST /api/stream-chat/token
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
      artistId: process.env.ARTIST_USER_ID,
      apiKey:   process.env.STREAM_API_KEY,
    });
  } catch (err) {
    console.error('stream-chat/token error:', err);
    res.status(500).json({ error: 'Failed to generate chat token: ' + err.message });
  }
});

module.exports = router;