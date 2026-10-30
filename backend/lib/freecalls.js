// backend/lib/freecalls.js
//
// The free call that comes with a Supreme membership, and the two more that
// come with renewing it.
//
// ── Why this could not simply be a call priced at zero ──────────────
//
// Call length is not stored on the row. It is worked back out of the price, as
// coins_charged divided by coins_per_min, and the watchdog that force-ends
// overrunning calls uses that sum every fifteen seconds. A call charged
// nothing divides out to a length of nothing, so a free call built the obvious
// way would have been ended the instant it connected.
//
// So batch two stores the length, and this module decides who may have one.

// Three minutes, hard. The countdown and the cutoff already behave this way for
// paid calls; this just fixes the number.
const FREE_CALL_MINUTES = 3;

// One a month, and two more in the month after renewing.
const FREE_CALLS_PER_PERIOD = 1;
const RENEWAL_GIFT_CALLS    = 2;

// The tier it belongs to. Deliberately the paid tier rather than a trial one:
// a trial is a taste of Supreme, and a free call that a trial unlocked would
// be a free call every time somebody started one.
const FREE_CALL_TIER = 'supreme';

const { getAllotmentPeriodKey } = require('./time');

// Which period a key belongs to, as a number.
//
// A key looks like "2026-03-05#7" — the join date, then how many whole months
// have passed. The number is the only part that moves, so comparing two keys
// means comparing those.
function periodIndex(key) {
  const n = Number(String(key || '').split('#')[1]);
  return Number.isFinite(n) ? n : null;
}

// How many free calls this member is owed for the period they are in.
//
// Derived rather than stored, like the allowance bonus, so nothing has to be
// written at the turn of a period and no job has to run to grant anything.
//
// The renewal gift lands in the period *after* the renewal, which is what "two
// additional calls in the subsequent month" means. A quarterly or annual
// Supreme renews once per term rather than once a month, so the gift arrives
// once per renewal; the standing one a month continues throughout.
function grantedFreeCalls(user, now = new Date()) {
  if (!user) return 0;

  const active = user.membership_expires_at && new Date(user.membership_expires_at) > now;
  if (!active || user.tier !== FREE_CALL_TIER) return 0;

  let granted = FREE_CALLS_PER_PERIOD;

  if (user.last_renewed_at && user.membership_started_at) {
    const here   = periodIndex(getAllotmentPeriodKey(user.membership_started_at, now));
    const atRenewal = periodIndex(getAllotmentPeriodKey(user.membership_started_at, new Date(user.last_renewed_at)));
    if (here !== null && atRenewal !== null && atRenewal === here - 1) {
      granted += RENEWAL_GIFT_CALLS;
    }
  }

  return granted;
}

// What the member has, what they have spent and what is left.
//
// Takes a db handle rather than importing the pool, so it works inside the
// booking transaction as well as from a plain read.
async function freeCallState(db, user, now = new Date()) {
  const granted = grantedFreeCalls(user, now);
  if (!granted) return { granted: 0, used: 0, remaining: 0, minutes: FREE_CALL_MINUTES };

  const monthKey = getAllotmentPeriodKey(user.membership_started_at, now);
  const { rows } = await db.query(
    `SELECT free_calls_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
    [user.id, monthKey]
  );
  const used = rows[0]?.free_calls_used || 0;

  return {
    granted,
    used,
    remaining: Math.max(0, granted - used),
    minutes: FREE_CALL_MINUTES,
    monthKey,
  };
}

// Spend one, inside the caller's transaction.
//
// The row may not exist yet — a member who has opened nothing and messaged
// nobody this period has no allotment row — so this upserts the same way the
// gallery and DM counters do.
async function consumeFreeCall(db, userId, monthKey) {
  await db.query(
    `INSERT INTO monthly_allotments (user_id, month_key, free_calls_used)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month_key)
     DO UPDATE SET free_calls_used = COALESCE(monthly_allotments.free_calls_used, 0) + 1`,
    [userId, monthKey]
  );
}

// Give it back.
//
// Every path that refunds a call reverses the original token charge. A free
// call has no charge to reverse, so without this a member who was stood up by
// an artist no-show would simply lose their call — the worst possible version
// of a gift.
//
// The period is worked out from the member's own record rather than passed in,
// because the refund paths do not all have it to hand. Clamped at zero: a
// double restore must never hand out a call that was never spent.
async function restoreFreeCall(db, userId, now = new Date()) {
  const { rows } = await db.query(
    `SELECT membership_started_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) return;

  const monthKey = getAllotmentPeriodKey(rows[0].membership_started_at, now);
  await db.query(
    `UPDATE monthly_allotments
        SET free_calls_used = GREATEST(0, COALESCE(free_calls_used, 0) - 1)
      WHERE user_id = $1 AND month_key = $2`,
    [userId, monthKey]
  );
}

// Undo a call, whichever kind it was.
//
// Five paths cancel a call — the fan declines a proposed time, either side
// declines while it is ringing, the artist rejects it, the artist does not
// show, or the ring window closes unanswered — and every one of them reversed
// a token charge. A free call has no charge, so each of those would have
// silently done nothing and the member would have lost their included call.
//
// One function so the rule lives in one place. Five copies of an if would be
// five chances for the fifth to be forgotten.
async function refundCall(db, call, { label, refundType = 'call_refund' } = {}) {
  if (call.is_free_call) {
    await restoreFreeCall(db, call.user_id);
    return { free: true };
  }
  const { refundByRelated } = require('./tokens');
  await refundByRelated(db, {
    userId:    call.user_id,
    type:      'call_charge',
    relatedId: call.id,
    label,
    refundType,
  });
  return { free: false };
}

module.exports = {
  FREE_CALL_MINUTES,
  FREE_CALLS_PER_PERIOD,
  RENEWAL_GIFT_CALLS,
  FREE_CALL_TIER,
  grantedFreeCalls,
  freeCallState,
  consumeFreeCall,
  restoreFreeCall,
  refundCall,
};