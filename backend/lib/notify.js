// backend/lib/notify.js
// Helper to push a notification to the artist (Jinal)

const pool    = require('../db/pool');
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:support@jinaljoshi.in',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

async function notifyArtist({ title, body, url = '/' }) {
  try {
    const artistId = process.env.ARTIST_USER_ID;
    if (!artistId) return;

    const { rows: subs } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [artistId]
    );
    if (!subs.length) return;

    const payload = JSON.stringify({
      title, body, url,
      icon:  '/wonder-coin-192.png',
      badge: '/wonder-coin-192.png',
    });

    const expired = [];
    await Promise.allSettled(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 410) expired.push(sub.endpoint);
      }
    }));

    if (expired.length) {
      await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`, [expired]);
    }
  } catch (err) {
    // Never throw — push is best-effort
    console.error('notifyArtist error:', err.message);
  }
}

module.exports = { notifyArtist };