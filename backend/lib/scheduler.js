// backend/lib/scheduler.js
// Background jobs: call reminders, no-show refunds, and hard duration cutoff enforcement

const cron    = require('node-cron');
const pool    = require('../db/pool');
const { notifyArtist } = require('./notify');
const { pushToUser } = require('../routes/push');

function getStreamClient() {
  const { StreamClient } = require('@stream-io/node-sdk');
  return new StreamClient(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
  );
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
        // Still mark as completed so we don't retry forever if Stream's API call fails
        await pool.query(`UPDATE call_requests SET status = 'completed' WHERE id = $1`, [call.id]);
      }
    }
  } catch (err) {
    console.error('scheduler/checkDurationCutoffs error:', err.message);
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

  // Every 15 seconds: hard duration cutoff enforcement
  setInterval(() => {
    checkDurationCutoffs();
  }, 15000);

  console.log('Scheduler started: reminders + no-show checks every minute, duration cutoff every 15s');
}

module.exports = { startScheduler };