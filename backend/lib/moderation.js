// backend/lib/moderation.js
// Shared enforcement for Mute (chat + calls only) and Block (all actions), with escalating,
// auto-expiring restrictions. No cron job needed — expiry is just a live timestamp comparison.

const pool = require('../db/pool');

const HOUR = 60 * 60 * 1000;
const ESCALATION_LADDER = [
  { hours: 24,      label: '24 hours' },
  { hours: 24 * 7,  label: '7 days'   },
  { hours: 24 * 30, label: '30 days'  }, // caps here — every offense from the 3rd onward gets 30 days
];

function tierForCount(priorBlockCount) {
  const index = Math.min(priorBlockCount, ESCALATION_LADDER.length - 1);
  return ESCALATION_LADDER[index];
}

function formatRemaining(blockedUntil) {
  const msLeft = new Date(blockedUntil).getTime() - Date.now();
  if (msLeft <= 0) return null;
  const hoursLeft = msLeft / HOUR;
  if (hoursLeft < 1) return `${Math.ceil(msLeft / 60000)} minutes`;
  if (hoursLeft < 48) return `${Math.ceil(hoursLeft)} hours`;
  return `${Math.ceil(hoursLeft / 24)} days`;
}

// Throws a fully-formed, ready-to-display message if the user is currently blocked.
// Safe to call from any action route — does nothing if the user isn't blocked or the block has expired.
async function assertNotBlocked(userId) {
  const { rows } = await pool.query(
    `SELECT blocked_until, block_reason FROM users WHERE id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user?.blocked_until) return;
  if (new Date(user.blocked_until) <= new Date()) return; // expired — no action needed, just proceed

  const remaining = formatRemaining(user.blocked_until);
  const err = new Error(
    `Your account has been temporarily restricted${user.block_reason ? ` (${user.block_reason})` : ''}. ` +
    `This lifts in ${remaining}.`
  );
  err.code = 'BLOCKED';
  throw err;
}

// Throws if the user is muted — only chat and calls should call this
async function assertNotMuted(userId) {
  const { rows } = await pool.query(`SELECT is_muted FROM users WHERE id = $1`, [userId]);
  if (rows[0]?.is_muted) {
    const err = new Error('Direct messaging and calls are currently unavailable for your account. Everything else on the platform works as normal.');
    err.code = 'MUTED';
    throw err;
  }
}

// Applies a new block, escalating based on how many times this account has been blocked before.
// Returns the applied duration and the next-tier warning, for Studio's own confirmation UI.
async function applyBlock(userId, reason) {
  const { rows } = await pool.query(`SELECT block_count FROM users WHERE id = $1`, [userId]);
  const priorCount = rows[0]?.block_count || 0;

  const tier = tierForCount(priorCount);
  const nextTier = tierForCount(priorCount + 1);
  const blockedUntil = new Date(Date.now() + tier.hours * HOUR);

  await pool.query(
    `UPDATE users SET blocked_until = $1, block_count = block_count + 1, block_reason = $2 WHERE id = $3`,
    [blockedUntil, reason || null, userId]
  );

  return {
    appliedDuration: tier.label,
    nextTierWarning: nextTier.label,
    blockedUntil,
  };
}

async function liftBlock(userId) {
  await pool.query(`UPDATE users SET blocked_until = NULL WHERE id = $1`, [userId]);
}

async function setMuted(userId, muted) {
  await pool.query(`UPDATE users SET is_muted = $1 WHERE id = $2`, [muted, userId]);
}

module.exports = { assertNotBlocked, assertNotMuted, applyBlock, liftBlock, setMuted, tierForCount };