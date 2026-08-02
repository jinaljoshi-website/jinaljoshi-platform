// backend/lib/notify.js
// One place that sends a web push, and one place that decides when a
// subscription is dead. This used to exist twice — here and in routes/push.js —
// with the same VAPID setup and near-identical cleanup, which is exactly the
// kind of duplication that drifts apart silently.

const pool    = require('../db/pool');
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:support@jinaljoshi.in',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// A subscription is gone for good on 410 (unsubscribed) and on 404 (the endpoint
// no longer exists). 403 usually means the VAPID keys do not match the ones the
// subscription was created with — a server misconfiguration, not a dead client —
// so those are kept and logged loudly instead. Deleting on 403 after a key
// rotation would silently wipe every subscription on the platform.
function subscriptionIsDead(statusCode) {
  return statusCode === 410 || statusCode === 404;
}

async function sendToSubscriptions(subs, payload) {
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };

  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0, failed = 0;
  const misconfigured = new Set();

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      if (subscriptionIsDead(err.statusCode)) {
        dead.push(sub.endpoint);
      } else {
        if (err.statusCode === 403) misconfigured.add('403 — VAPID keys may not match');
        console.error('push failed:', {
          endpoint: String(sub.endpoint).slice(0, 60) + '…',
          statusCode: err.statusCode,
          message: err.message,
        });
      }
    }
  }));

  if (misconfigured.size) {
    console.error(`push: ${[...misconfigured].join('; ')} — subscriptions kept, not deleted`);
  }
  if (dead.length) {
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`, [dead]);
  }
  return { sent, failed, removed: dead.length };
}

async function pushToUser(userId, payload) {
  try {
    if (!userId) return { sent: 0, failed: 0, removed: 0 };
    const { rows } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    return await sendToSubscriptions(rows, {
      icon: '/wonder-coin-192.png', badge: '/wonder-coin-192.png', ...payload,
    });
  } catch (err) {
    // Push is best effort. A notification failing must never break the thing
    // that triggered it.
    console.error('pushToUser error:', err.message);
    return { sent: 0, failed: 0, removed: 0 };
  }
}

async function notifyArtist({ title, body, url = '/', ...rest }) {
  const artistId = process.env.ARTIST_USER_ID;
  if (!artistId) {
    console.error('notifyArtist: ARTIST_USER_ID is not set');
    return { sent: 0, failed: 0, removed: 0 };
  }
  return pushToUser(artistId, { title, body, url, ...rest });
}

// A single push makes one notification sound and is easy to sleep through. A
// ringing call needs to keep asking, so the same notification is re-sent a few
// times a couple of seconds apart. Each send re-alerts because renotify is set
// with a stable tag, so it stays ONE notification in the tray that chimes again
// rather than a pile of them to dismiss.
//
// Worth being clear about the limit: a web push cannot play a chosen ringtone.
// The Notification API's sound property was dropped and no browser honours it;
// a custom sound needs a real installed app with its own notification channel.
// What is available is the system notification sound, repetition, and vibration.
async function ringArtist(payload, { times = 5, gapMs = 2000 } = {}) {
  const artistId = process.env.ARTIST_USER_ID;
  if (!artistId) return { sent: 0 };

  const ring = {
    ...payload,
    tag: payload.tag || 'incoming-call',
    renotify: true,
    requireInteraction: true,
    vibrate: payload.vibrate || [400, 200, 400, 200, 400],
  };

  const first = await pushToUser(artistId, ring);

  // The rest are fired without holding up the caller — the fan is waiting on a
  // response, and a ring that is still repeating must not delay it.
  (async () => {
    for (let i = 1; i < times; i++) {
      await new Promise((r) => setTimeout(r, gapMs));
      // Stop if the call is no longer ringing, so answering quickly does not
      // leave the phone chiming for another ten seconds.
      if (typeof payload.stillRinging === 'function') {
        try { if (!(await payload.stillRinging())) return; } catch { /* keep ringing */ }
      }
      await pushToUser(artistId, { ...ring, body: `${ring.body} · still ringing` });
    }
  })().catch((e) => console.error('ringArtist repeat failed:', e.message));

  return first;
}

module.exports = { notifyArtist, pushToUser, ringArtist, sendToSubscriptions, subscriptionIsDead };