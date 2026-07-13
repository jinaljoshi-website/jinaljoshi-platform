// backend/lib/email.js
// Sends transactional emails (signup verification, password reset) via Resend.
// Fully separate from the existing Gmail-based billing/support email system,
// so a burst of signups can never affect invoice delivery or vice versa.

const crypto = require('crypto');
const pool   = require('../db/pool');

const FROM_ADDRESS   = 'Personal Space <noreply@jinaljoshi.in>';
const APP_BASE_URL   = process.env.PS_APP_BASE_URL || 'https://ps.jinaljoshi.in';
const TOKEN_EXPIRY_HOURS      = { signup: 24, password_reset: 1 };
const RATE_LIMIT_WINDOW_MINS  = 5;
const DAILY_CAP                = 5;

async function sendViaResend({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${errText}`);
  }
  return res.json();
}

// Protects against email-bombing abuse (repeatedly triggering signup/reset against
// someone else's real address) and keeps us comfortably inside Resend's own limits.
async function assertNotRateLimited(userId, purpose) {
  const { rows: recentRows } = await pool.query(
    `SELECT created_at FROM verification_tokens
     WHERE user_id = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose]
  );
  if (recentRows.length) {
    const msSinceLast = Date.now() - new Date(recentRows[0].created_at).getTime();
    if (msSinceLast < RATE_LIMIT_WINDOW_MINS * 60 * 1000) {
      const waitMin = Math.ceil((RATE_LIMIT_WINDOW_MINS * 60 * 1000 - msSinceLast) / 60000);
      throw new Error(`Please wait ${waitMin} minute${waitMin === 1 ? '' : 's'} before requesting another email.`);
    }
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM verification_tokens
     WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId, purpose]
  );
  if (parseInt(countRows[0].count, 10) >= DAILY_CAP) {
    throw new Error('Too many requests today. Please try again tomorrow or contact support.');
  }
}

async function createToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS[purpose] * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO verification_tokens (user_id, token, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, token, purpose, expiresAt]
  );
  return token;
}

async function sendSignupVerificationEmail(user) {
  await assertNotRateLimited(user.id, 'signup');
  const token = await createToken(user.id, 'signup');
  const link = `${APP_BASE_URL}/auth?mode=verify-email&token=${token}`;
  await sendViaResend({
    to: user.email,
    subject: 'Verify your email — Personal Space',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1A1714;">Welcome to Personal Space</h2>
        <p>Confirm your email to activate your account.</p>
        <p><a href="${link}" style="display:inline-block; background:#C17D4A; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;">Verify my email</a></p>
        <p style="color:#888; font-size:13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
      </div>`,
  });
}

async function sendPasswordResetEmail(user) {
  await assertNotRateLimited(user.id, 'password_reset');
  const token = await createToken(user.id, 'password_reset');
  const link = `${APP_BASE_URL}/auth?mode=reset-password&token=${token}`;
  await sendViaResend({
    to: user.email,
    subject: 'Reset your password — Personal Space',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1A1714;">Reset your password</h2>
        <p>Click below to set a new password. This link expires in 1 hour.</p>
        <p><a href="${link}" style="display:inline-block; background:#C17D4A; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;">Reset password</a></p>
        <p style="color:#888; font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
}

async function consumeToken(token, purpose) {
  const { rows } = await pool.query(
    `SELECT * FROM verification_tokens WHERE token = $1 AND purpose = $2`,
    [token, purpose]
  );
  if (!rows.length) throw new Error('Invalid or expired link.');
  const record = rows[0];
  if (record.used_at) throw new Error('This link has already been used.');
  if (new Date(record.expires_at) < new Date()) throw new Error('This link has expired.');

  await pool.query(`UPDATE verification_tokens SET used_at = NOW() WHERE id = $1`, [record.id]);
  return record.user_id;
}

module.exports = { sendSignupVerificationEmail, sendPasswordResetEmail, consumeToken };