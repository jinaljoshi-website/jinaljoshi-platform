// backend/routes/push.js
const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');

// VAPID is configured once, in lib/notify.js.
// Sending lives in lib/notify.js so there is one implementation and one
// definition of a dead subscription. Re-exported here because several routes
// already import pushToUser from this module.
const { pushToUser, sendToSubscriptions } = require('../lib/notify');
module.exports.pushToUser = pushToUser;

// ─────────────────────────────────────────────
// POST /api/push/subscribe
// Fan subscribes to push notifications
// ─────────────────────────────────────────────

router.post('/subscribe', authMid, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
      [req.user.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('push/subscribe error:', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// ─────────────────────────────────────────────
// POST /api/push/subscribe-artist
// Jinal subscribes from the Studio
// ─────────────────────────────────────────────

router.post('/subscribe-artist', authMid, artistOnly, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
      [req.user.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('push/subscribe-artist error:', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// ─────────────────────────────────────────────
// POST /api/push/unsubscribe
// ─────────────────────────────────────────────

router.post('/unsubscribe', authMid, async (req, res) => {
  const { endpoint } = req.body;
  try {
    await pool.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [req.user.userId, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

// ─────────────────────────────────────────────
// POST /api/push/send  [ARTIST ONLY]
// Send a push notification to all or one user
// ─────────────────────────────────────────────

router.post('/send', authMid, artistOnly, async (req, res) => {
  const { title, body, url, userId } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  try {
    const { rows: subs } = userId
      ? await pool.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [userId])
      : await pool.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions`);

    if (!subs.length) return res.json({ ok: true, sent: 0, message: 'No subscribers found' });

    const { sent, failed, removed } = await sendToSubscriptions(subs, {
      title, body, url: url || '/',
      icon: '/wonder-coin-192.png', badge: '/wonder-coin-192.png',
    });

    res.json({ ok: true, sent, failed, expiredRemoved: removed });
  } catch (err) {
    console.error('push/send error:', err);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// ─────────────────────────────────────────────
// GET /api/push/vapid-public
// ─────────────────────────────────────────────

router.get('/vapid-public', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC });
});

module.exports = router;
module.exports.pushToUser = pushToUser;