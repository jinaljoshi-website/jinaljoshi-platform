// backend/routes/streamchat.js
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
    const artistId = process.env.ARTIST_USER_ID;

    // Get both fan and artist details
    const { rows } = await pool.query(
      `SELECT id, email, display_name, is_artist FROM users WHERE id = ANY($1)`,
      [[req.user.userId, artistId]]
    );

    const fan    = rows.find((u) => u.id === req.user.userId);
    const artist = rows.find((u) => u.id === artistId);

    if (!fan) return res.status(404).json({ error: 'User not found' });

    const client = getStreamClient();

    // Upsert BOTH users in Stream before token is used
    const usersToUpsert = [
      {
        id:   fan.id,
        name: fan.display_name || fan.email,
        role: 'user',
      },
    ];

    if (artist) {
      usersToUpsert.push({
        id:   artist.id,
        name: artist.display_name || artist.email || 'Jinal Joshi',
        role: 'admin',
      });
    }

    await client.upsertUsers(usersToUpsert);

    const token = client.generateUserToken({ user_id: fan.id });

    res.json({
      token,
      userId:   fan.id,
      userName: fan.display_name || fan.email,
      artistId,
      apiKey:   process.env.STREAM_API_KEY,
    });
  } catch (err) {
    console.error('stream-chat/token error:', err);
    res.status(500).json({ error: 'Failed to generate chat token: ' + err.message });
  }
});

module.exports = router;