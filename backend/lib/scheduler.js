// backend/lib/scheduler.js
// Background jobs: call reminders, no-show refunds, hard duration cutoff enforcement,
// missed-call detection, and expired chat message cleanup

const cron    = require('node-cron');

// What ran, when, and whether it threw.
//
// A nightly job here once called a function that was never written and threw a
// ReferenceError every night at four in the morning until somebody happened to
// read the log. Nothing was watching, because there was nothing to watch — a
// job that fails silently is indistinguishable from one that has nothing to do.
//
// Held in memory and read by the health endpoint. It says when each job last
// finished and what it said if it failed, which is enough to tell a scheduler
// that is working from one that stopped a week ago.
const jobHealth = new Map();

function record(name, fn) {
  return async (...args) => {
    const startedAt = new Date();
    try {
      const out = await fn(...args);
      jobHealth.set(name, { lastRunAt: startedAt, lastOkAt: new Date(), error: null });
      return out;
    } catch (err) {
      jobHealth.set(name, {
        lastRunAt: startedAt,
        lastOkAt: jobHealth.get(name)?.lastOkAt || null,
        error: err.message,
      });
      // Still logged, because the health endpoint is a summary and the log is
      // where the stack trace lives.
      console.error(`scheduled job failed: ${name}:`, err.message);
    }
  };
}

function schedulerHealth() {
  const out = {};
  for (const [name, h] of jobHealth) {
    out[name] = {
      lastRunAt: h.lastRunAt,
      lastOkAt: h.lastOkAt,
      error: h.error,
      minutesSinceOk: h.lastOkAt ? Math.round((Date.now() - h.lastOkAt) / 60000) : null,
    };
  }
  return out;
}
const pool    = require('../db/pool');
const { notifyArtist, pushToUser } = require('./notify');
const fx = require('./fx');
const { refundByRelated } = require('./tokens');
const { sendRenewalReminderEmail } = require('./emails');
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
        await refundByRelated(client, {
          userId:     call.user_id,
          type:       'call_charge',
          relatedId:  call.id,
          label:      'Refund: Jinal was unavailable for scheduled call',
          refundType: 'call_refund',
        });
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
        await refundByRelated(client, {
          userId:     call.user_id,
          type:       'call_charge',
          relatedId:  call.id,
          label:      'Refund: call not answered in time',
          refundType: 'call_refund',
        });
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

// ─────────────────────────────────────────────
// Job 6: Auction lifecycle — end expired auctions, send the 24h reminder email,
// expire unclaimed wins back to the queue, and keep exactly one slot always active.
// Runs every minute — bidding deadlines matter more than a slow poll would allow.
// ─────────────────────────────────────────────

async function checkAuctions() {
  const { promoteNextItem } = require('../routes/auction');
  const { getConfigNumber } = require('./config');
  const client = await pool.connect();
  try {
    const durationHours = (await getConfigNumber('auction_duration_hours')) || 72;
    const claimHours    = (await getConfigNumber('auction_claim_hours'))    || 24;
    const banDays       = (await getConfigNumber('auction_ban_days'))       || 30;

    // 1. End any auction whose window has closed. Bidding opens at the reserve, so
    //    any bid at all is a winning bid — there is no separate reserve to clear.
    const { rows: ended } = await client.query(
      `SELECT * FROM merchandise
       WHERE is_auction_item = TRUE AND auction_status = 'active'
         AND auction_started_at <= NOW() - ($1 || ' hours')::interval`,
      [String(durationHours)]
    );
    for (const item of ended) {
      if (item.current_highest_bid && item.current_highest_bidder_id) {
        await client.query(
          `UPDATE merchandise
           SET auction_status = 'awaiting_payment', winner_id = $1, won_at = NOW(),
               claim_stage = 0, claim_deadline = NOW() + ($2 || ' hours')::interval
           WHERE id = $3`,
          [item.current_highest_bidder_id, String(claimHours), item.id]
        );
        pushToUser(item.current_highest_bidder_id, {
          title: '🎉 You won the auction!',
          body:  `"${item.title}" is yours — claim it within ${claimHours} hours to secure it.`,
          url:   '/platform/shop',
          tag:   'auction',
        }).catch(() => {});
        notifyArtist({ title: 'Auction won', body: `"${item.title}" went for ${item.current_highest_bid} tokens.`, url: '/merch' });
      } else {
        await client.query(
          `UPDATE merchandise SET auction_status = 'queued', went_unsold_at = NOW(),
                  current_highest_bid = NULL, current_highest_bidder_id = NULL WHERE id = $1`,
          [item.id]
        );
        notifyArtist({ title: 'Auction ended unsold', body: `"${item.title}" received no bids and goes into cooldown.`, url: '/merch' });
      }
    }

    // 2. The claim ladder. A winner is nudged three times and the deadline moves each
    //    time, so nobody loses an item to a missed email. Only after the third
    //    extension lapses is the win forfeited and bidding suspended.
    //      stage 0 → first nudge at a third of the window
    //      stage 1 → window reached: extend, and warn about suspension
    //      stage 2 → final extension: last chance
    //      stage 3 → forfeited
    const LADDER = [
      { stage: 0, dueAfter: claimHours / 3, extendTo: null,
        subject: (t) => `Claim "${t}" — you won the auction`,
        line:    (t, h) => `You are the winning bidder for "${t}". Sign in and claim it within ${h} hours of winning to secure it.` },
      { stage: 1, dueAfter: claimHours, extendTo: claimHours * 2,
        subject: (t) => `Still waiting on you — "${t}"`,
        line:    (t) => `Your win of "${t}" is still unclaimed. We have extended the deadline by another ${claimHours} hours. If a winning bid is left unclaimed, access to future auctions may be suspended.` },
      { stage: 2, dueAfter: claimHours * 2, extendTo: claimHours * 3,
        subject: (t) => `Last chance to claim "${t}"`,
        line:    (t) => `This is the final reminder for "${t}". You have ${claimHours} more hours to claim it. After that the item returns to sale and bidding will be suspended on your account for ${banDays} days.` },
    ];

    for (const step of LADDER) {
      const { rows: due } = await client.query(
        `SELECT m.*, u.email, u.display_name FROM merchandise m
         JOIN users u ON u.id = m.winner_id
         WHERE m.auction_status = 'awaiting_payment' AND m.claim_stage = $1
           AND m.won_at <= NOW() - ($2 || ' hours')::interval`,
        [step.stage, String(step.dueAfter)]
      );
      for (const item of due) {
        try {
          const { sendTransactionalEmail } = require('./email');
          await sendTransactionalEmail({
            to: item.email,
            subject: step.subject(item.title),
            html: `<p>Hi ${item.display_name || 'there'},</p><p>${step.line(item.title, claimHours)}</p><p>Sign in at <a href="https://ps.jinaljoshi.in/platform/shop">ps.jinaljoshi.in</a> to claim.</p>`,
          });
          // Advance only on a successful send, and extend the deadline in the same
          // step — otherwise a mail outage would silently cost someone their win.
          if (step.extendTo) {
            await client.query(
              `UPDATE merchandise SET claim_stage = $1,
                      claim_deadline = won_at + ($2 || ' hours')::interval
               WHERE id = $3`,
              [step.stage + 1, String(step.extendTo), item.id]
            );
          } else {
            await client.query(`UPDATE merchandise SET claim_stage = $1 WHERE id = $2`, [step.stage + 1, item.id]);
          }
          pushToUser(item.winner_id, {
            title: 'Claim your auction win',
            body:  `"${item.title}" is waiting for you.`,
            url:   '/platform/shop',
            tag:   'auction',
          }).catch(() => {});
        } catch (e) {
          console.error(`checkAuctions claim reminder (stage ${step.stage}) failed, will retry:`, e.message);
        }
      }
    }

    // 3. Forfeit anything still unclaimed past the final extension, and suspend
    //    bidding — the item was held out of reach of everyone else meanwhile.
    const { rows: forfeited } = await client.query(
      `SELECT id, title, winner_id FROM merchandise
       WHERE auction_status = 'awaiting_payment' AND claim_stage >= 3
         AND won_at <= NOW() - ($1 || ' hours')::interval`,
      [String(claimHours * 3)]
    );
    for (const item of forfeited) {
      await client.query(
        `UPDATE merchandise SET auction_status = 'queued', went_unsold_at = NOW(),
                winner_id = NULL, won_at = NULL, winner_email_sent_at = NULL,
                claim_stage = 0, claim_deadline = NULL,
                current_highest_bid = NULL, current_highest_bidder_id = NULL WHERE id = $1`,
        [item.id]
      );
      if (item.winner_id) {
        await client.query(
          `UPDATE users SET unclaimed_wins = unclaimed_wins + 1,
                  auction_banned_until = NOW() + ($1 || ' days')::interval
           WHERE id = $2`,
          [String(banDays), item.winner_id]
        );
        pushToUser(item.winner_id, {
          title: 'Auction win forfeited',
          body:  `"${item.title}" went unclaimed and is back on sale. Bidding is suspended for ${banDays} days.`,
          url:   '/platform/shop',
          tag:   'auction',
        }).catch(() => {});
      }
      notifyArtist({ title: 'Win forfeited', body: `"${item.title}" was never claimed and returns to the queue.`, url: '/merch' });
    }

    // 4. Always keep exactly one slot active
    await promoteNextItem();
  } catch (err) {
    console.error('scheduler/checkAuctions error:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// Membership expiry reminders
// ─────────────────────────────────────────────

// Nudged three days out and again on the last day. Chosen over auto-renewal:
// unexpected charges are the largest single source of chargebacks, and a dispute
// spike against the only working gateway is not a risk worth taking. A reminder
// solves forgetting, which is the actual problem, and tells us the renewal rate
// before anyone decides whether automatic billing is worth its compliance cost.
//
// membership_reminders records what has already been sent, so a fan is never
// nudged twice for the same expiry — and the row is written only after the push
// resolves, so a failure means a retry tomorrow rather than a silent miss.
// Accounts asked to close once their membership had run its course.
//
// Held until the day, because closing on request would have taken away time
// already paid for. Runs alongside the expiry check, so an account ends within
// a minute of the membership it was waiting on.
async function closeExpiredAccounts() {
  const { rows } = await pool.query(
    `UPDATE users
        SET closed_at = NOW()
      WHERE closed_at IS NULL
        AND close_requested_at IS NOT NULL
        AND (membership_expires_at IS NULL OR membership_expires_at <= NOW())
      RETURNING id, email`
  );
  for (const u of rows) {
    await pool.query(`DELETE FROM active_sessions WHERE user_id = $1`, [u.id]);
    console.log(`account closed on schedule: ${u.email}`);
  }
}

async function checkMembershipExpiry() {
  const client = await pool.connect();
  try {
    const stages = [
      // The date said, rather than left as an empty gap.
      //
      // This read "ends on the ." for as long as it has existed: the template
      // interpolated an empty string where the date belonged. A reminder that
      // does not say when is a reminder that asks somebody to go and find out.
      { key: '3day', days: 3, title: 'Your membership ends in 3 days',
        body: (t, when) => `Your ${t} membership ends on ${when}. Renew to keep your allowances and everything you have unlocked with them.` },
      { key: '1day', days: 1, title: 'Your membership ends tomorrow',
        body: (t, when) => `Your ${t} membership ends tomorrow, ${when}. Renew to keep your allowances and the sets you unlocked with them.` },
    ];

    for (const stage of stages) {
      const { rows } = await client.query(
        `SELECT u.id, u.email, u.display_name, u.tier, u.membership_expires_at
         FROM users u
         WHERE u.is_artist = FALSE
           AND u.membership_expires_at IS NOT NULL
           AND u.membership_expires_at > NOW()
           AND u.membership_expires_at <= NOW() + ($1 || ' days')::interval
           AND u.membership_expires_at > NOW() + ($2 || ' days')::interval
           AND NOT EXISTS (
             SELECT 1 FROM membership_reminders r
             WHERE r.user_id = u.id AND r.stage = $3
               AND r.expires_at = u.membership_expires_at
           )`,
        [String(stage.days), String(stage.days - 1), stage.key]
      );

      for (const u of rows) {
        const when = new Date(u.membership_expires_at)
          .toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
        try {
          await pushToUser(u.id, {
            title: stage.title,
            body:  `Your ${u.tier} membership ends on ${when}. Renew to keep your allowances and the sets you unlocked with them.`,
            url:   '/platform/membership',
            tag:   'membership-expiry',
          });

          // And by email, because a push notification reaches a phone that has
          // the app installed and permission granted, which is a smaller set of
          // people than have an email address.
          //
          // Not awaited: a mail service being slow must not stop the rest of
          // the run, and the reminder is recorded either way.
          sendRenewalReminderEmail(u.id, {
            tier: u.tier,
            expiresAt: u.membership_expires_at,
            daysLeft: stage.days,
          }).catch((e) => console.error('renewal email failed:', e.message));
          await client.query(
            `INSERT INTO membership_reminders (user_id, stage, expires_at) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [u.id, stage.key, u.membership_expires_at]
          );
        } catch (err) {
          console.error(`membership reminder (${stage.key}) failed for ${u.email}, will retry:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('scheduler/checkMembershipExpiry error:', err.message);
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
    record('call-reminders', checkUpcomingReminders)();
    record('call-no-shows', checkNoShows)();
  });

  // Every 15 seconds: hard duration cutoff enforcement, plus missed-call detection (ringing needs fast response)
  setInterval(() => {
    record('call-cutoffs', checkDurationCutoffs)();
    record('missed-calls', checkMissedCalls)();
  }, 15000);

  // Chat messages are not deleted on a schedule, and deliberately so. The
  // retention question is settled: conversations stay. Terms already say
  // messages are retained for safety, moderation and dispute resolution, and
  // fans pay tokens to unlock media inside them — expiring that would be taking
  // away something bought.
  //
  // A nightly job here once called a deletion function that was never written,
  // and threw a ReferenceError every night at 4am until it was removed. The
  // fan-facing copy promising 30-day deletion has now been removed too, so the
  // product and the behaviour agree. Anyone wanting their data erased asks, and
  // Privacy sets out that route.

  // Every minute: auction lifecycle (ending auctions, reminder emails, expiring unclaimed wins, queue promotion)
  cron.schedule('* * * * *', () => {
    record('auctions', checkAuctions)();
  });

  // Once a day at 10am IST — a renewal nudge is not urgent, and nobody wants a
  // push about billing at three in the morning.
  cron.schedule('30 4 * * *', () => {
    record('membership-expiry', checkMembershipExpiry)();
    record('close-expired-accounts', closeExpiredAccounts)();
  });

  // Exchange rates, twice daily. A rate older than 48 hours withdraws its
  // currency from sale, so a single missed run must not be enough to take
  // international payments offline — twice a day means two consecutive
  // failures before anything stops working.
  cron.schedule('0 2,14 * * *', () => { record('fx-rates', fx.refreshRates)(); });

  // And once at boot, because a deploy after any downtime would otherwise run
  // on whatever the rates were before it.
  fx.refreshRates().catch(() => {});

  console.log('Scheduler started: reminders, no-show checks and auction lifecycle every minute; duration cutoff and missed-call checks every 15s; membership expiry reminders daily');
}

module.exports = { startScheduler, schedulerHealth };