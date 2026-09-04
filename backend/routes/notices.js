// backend/routes/notices.js
//
// Reading back everything the platform has said.

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');

router.use(authMid);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, title, body, url, delivered, created_at, read_at
         FROM notices WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 200`,
      [req.user.userId]
    );
    const { rows: unread } = await pool.query(
      `SELECT count(*)::int AS n FROM notices WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.userId]
    );
    res.json({ notices: rows, unread: unread[0].n });
  } catch (err) {
    console.error('notices error:', err);
    res.status(500).json({ error: 'Could not load your notices' });
  }
});

// Marked read all at once rather than one by one.
//
// Opening the page is the act of reading them; making somebody tap each one to
// clear a badge is a chore invented by the badge.
router.post('/read', async (req, res) => {
  try {
    await pool.query(
      `UPDATE notices SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('notices/read error:', err);
    res.status(500).json({ error: 'Could not mark them read' });
  }
});

module.exports = router;