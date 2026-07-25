// backend/routes/push.js
const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const webpush    = require('web-push');

webpush.setVapidDetails(
  'mailto:support@jinaljoshi.in',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// ── Helper: send to a specific user's subscriptions ──────────────────────────
async function pushToUser(userId, payload) {
  const { rows: subs } = await pool.query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (!subs.length) return;
  const expired = [];
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      console.error('pushToUser send failed:', {
        endpoint: sub.endpoint.slice(0, 60) + '...',
        statusCode: err.statusCode,
        body: err.body,
        message: err.message,
      });
      if (err.statusCode === 410) expired.push(sub.endpoint);
    }
  }));
  if (expired.length) {
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`, [expired]);
  }
}

// Export for use in other routes
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

    const payload = JSON.stringify({
      title, body, url: url || '/',
      icon: '/wonder-coin-192.png', badge: '/wonder-coin-192.png',
    });

    let sent = 0, failed = 0;
    const expired = [];

    await Promise.allSettled(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err) {
        failed++;
        // Previously silent for anything other than 410 — meaning every real failure
        // reason (bad VAPID keys, malformed subscription, an auth error from the push
        // service) was being discarded with zero trace, which is exactly why nothing
        // ever showed up in the logs despite repeated failed sends.
        console.error('push send failed:', {
          endpoint: sub.endpoint.slice(0, 60) + '...',
          statusCode: err.statusCode,
          body: err.body,
          message: err.message,
        });
        if (err.statusCode === 410) expired.push(sub.endpoint);
      }
    }));

    if (expired.length) {
      await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`, [expired]);
    }

    res.json({ ok: true, sent, failed, expiredRemoved: expired.length });
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