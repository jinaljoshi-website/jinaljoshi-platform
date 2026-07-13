// backend/lib/scheduler.js
// Background jobs: call reminders, no-show refunds, hard duration cutoff enforcement,
// missed-call detection, and expired chat message cleanup

const cron    = require('node-cron');
const pool    = require('../db/pool');
const { notifyArtist } = require('./notify');
const { pushToUser } = require('../routes/push');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function getStreamClient() {
  const { StreamClient } = require('@stream-io/node-sdk');
  return new StreamClient(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
  );
}

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// Reverses the publicUrl construction in upload.js back into the raw R2 object key.
// Returns null if the URL doesn't look like one of ours (defensive — never delete something unexpected).
function extractR2Key(url) {
  if (!url) return null;
  const base = process.env.R2_PUBLIC_URL || (process.env.R2_ENDPOINT || '').replace('https://', 'https://pub-');
  if (!base || !url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\//, '');
}

// ─────────────────────────────────────────────
// Job 1: 5-minutes-before reminder for Jinal
// Runs every minute
// ─────────────────────────────────────────────

async function checkUpcomingReminders() {
  try {
    const { rows } = await pool.query(
      `SELECT cr.*, u.display_name, u.email
       FROM call_requests cr
       JOIN users u ON u.id = cr.user_id
       WHERE cr.status = 'scheduled'
       AND cr.reminder_sent = FALSE
       AND cr.scheduled_at <= NOW() + INTERVAL '5 minutes'
       AND cr.scheduled_at > NOW()`
    );

    for (const call of rows) {
      notifyArtist({
        title: '⏰ Call in 5 minutes',
        body:  `${call.display_name || call.email} · ${call.call_type} call at ${new Date(call.scheduled_at).toLocaleTimeString()}`,
        url:   '/calls',
        vibrate: [80, 40, 80],
        requireInteraction: false,
        tag: `reminder-${call.id}`,
      });
      await pool.query(`UPDATE call_requests SET reminder_sent = TRUE WHERE id = $1`, [call.id]);
    }
  } catch (err) {
    console.error('scheduler/checkUpcomingReminders error:', err.message);
  }
}

// ─────────────────────────────────────────────
// Job 2: No-show auto-refund
// If a call is scheduled and 10+ minutes have passed with no call_started_at, refund it
// Runs every minute
// ─────────────────────────────────────────────

async function checkNoShows() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM call_requests
       WHERE status = 'scheduled'
       AND call_started_at IS NULL
       AND scheduled_at <= NOW() - INTERVAL '10 minutes'`
    );

    for (const call of rows) {
      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
          [call.coins_charged, call.user_id]
        );
        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
           VALUES ($1, 'call_refund', 'credit', $2, $3, $4)`,
          [call.user_id, call.coins_charged, `Refund: Jinal was unavailable for scheduled call`, call.id]
        );
        await client.query(
          `UPDATE call_requests SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
          ['Jinal was unavailable due to unavoidable circumstances. Your tokens have been refunded automatically.', call.id]
        );
        await client.query('COMMIT');

        pushToUser(call.user_id, {
          title: 'Call not started',
          body:  'Jinal was unavailable due to unavoidable circumstances. Your tokens have been refunded automatically.',
          url:   '/platform/calls',
        });
      } catch (innerErr) {
        await client.query('ROLLBACK');
        console.error('scheduler/checkNoShows inner error:', innerErr.message);
      }
    }
  } catch (err) {
    console.error('scheduler/checkNoShows error:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// Job 3: Hard duration cutoff
// Force-ends any in-progress call that has run past its paid duration
// Runs every 15 seconds — this is the real enforcement, not just a UI timer
// ─────────────────────────────────────────────

async function checkDurationCutoffs() {
  try {
    const { rows } = await pool.query(
      `SELECT *,
              (coins_charged / NULLIF(coins_per_min, 0)) AS duration_minutes
       FROM call_requests
       WHERE status = 'in_progress'
       AND call_started_at IS NOT NULL
       AND call_started_at + ((coins_charged / NULLIF(coins_per_min, 0)) || ' minutes')::interval <= NOW()`
    );

    if (!rows.length) return;

    const client = getStreamClient();

    for (const call of rows) {
      try {
        if (call.stream_call_id) {
          const streamCall = client.video.call('default', call.stream_call_id);
          await streamCall.end();
        }
        await pool.query(`UPDATE call_requests SET status = 'completed' WHERE id = $1`, [call.id]);
      } catch (innerErr) {
        console.error(`scheduler/checkDurationCutoffs failed to end call ${call.id}:`, innerErr.message);
        await pool.query(`UPDATE call_requests SET status = 'completed' WHERE id = $1`, [call.id]);
      }
    }
  } catch (err) {
    console.error('scheduler/checkDurationCutoffs error:', err.message);
  }
}

// ─────────────────────────────────────────────
// Job 4: Missed-call detection
// If a call is "ringing" and the ring window has expired with no answer, mark it missed,
// refund the fan, end the room, and notify both sides clearly
// Runs every 15 seconds — ringing needs a fast response, not a once-a-minute check
// ─────────────────────────────────────────────

async function checkMissedCalls() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM call_requests
       WHERE status = 'ringing'
       AND ring_expires_at IS NOT NULL
       AND ring_expires_at <= NOW()`
    );

    for (const call of rows) {
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
          [call.coins_charged, call.user_id]
        );
        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
           VALUES ($1, 'call_refund', 'credit', $2, $3, $4)`,
          [call.user_id, call.coins_charged, 'Refund: call not answered in time', call.id]
        );
        await client.query(
          `UPDATE call_requests SET status = 'missed', rejection_reason = $1 WHERE id = $2`,
          ['No answer — the call was not picked up in time. Your tokens have been refunded automatically.', call.id]
        );
        await client.query('COMMIT');

        if (call.stream_call_id) {
          try {
            const streamClient = getStreamClient();
            await streamClient.video.call('default', call.stream_call_id).end();
          } catch (e) { console.error('scheduler/checkMissedCalls failed to end room:', e.message); }
        }

        pushToUser(call.user_id, {
          title: 'Missed call',
          body:  'No answer — your tokens have been refunded automatically.',
          url:   '/platform/calls',
        });
        notifyArtist({
          title: 'Missed call',
          body:  `A ${call.call_type} call went unanswered and was automatically refunded.`,
          url:   '/calls',
        });
      } catch (innerErr) {
        await client.query('ROLLBACK');
        console.error('scheduler/checkMissedCalls inner error:', innerErr.message);
      }
    }
  } catch (err) {
    console.error('scheduler/checkMissedCalls error:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// Job 5: Expire chat messages older than 30 days
// Deletes both the database rows AND the underlying R2 files (photos/videos, including
// locked-media bundles). No exceptions for paid unlocks — this is a deliberate, blanket policy.
// Runs once a day.
// ─────────────────────────────────────────────

async function expireOldChatMessages() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, media_url, locked_media_urls
       FROM direct_messages
       WHERE created_at <= NOW() - INTERVAL '30 days'`
    );

    if (!rows.length) return;

    const r2 = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME;

    // Collect every R2 key referenced by these messages (single media_url + locked bundles)
    const keysToDelete = [];
    for (const row of rows) {
      const singleKey = extractR2Key(row.media_url);
      if (singleKey) keysToDelete.push(singleKey);

      if (Array.isArray(row.locked_media_urls)) {
        for (const item of row.locked_media_urls) {
          const key = extractR2Key(item.url);
          if (key) keysToDelete.push(key);
        }
      }
    }

    // Best-effort R2 cleanup — a failed file delete should never block clearing the DB rows,
    // otherwise one bad object could stall this job from ever completing
    for (const key of keysToDelete) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        console.error(`scheduler/expireOldChatMessages failed to delete R2 key ${key}:`, err.message);
      }
    }

    const ids = rows.map((r) => r.id);
    await client.query(`DELETE FROM direct_messages WHERE id = ANY($1)`, [ids]);

    console.log(`scheduler/expireOldChatMessages: removed ${rows.length} messages and attempted ${keysToDelete.length} R2 file deletions`);
  } catch (err) {
    console.error('scheduler/expireOldChatMessages error:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// Start all scheduled jobs
// ─────────────────────────────────────────────

function startScheduler() {
  // Every minute: reminders and no-show checks
  cron.schedule('* * * * *', () => {
    checkUpcomingReminders();
    checkNoShows();
  });

  // Every 15 seconds: hard duration cutoff enforcement, plus missed-call detection (ringing needs fast response)
  setInterval(() => {
    checkDurationCutoffs();
    checkMissedCalls();
  }, 15000);

  // Once a day at 4am server time: expired chat message cleanup (low-traffic window)
  cron.schedule('0 4 * * *', () => {
    expireOldChatMessages();
  });

  console.log('Scheduler started: reminders + no-show checks every minute, duration cutoff + missed-call checks every 15s, chat expiry daily at 4am');
}

module.exports = { startScheduler };