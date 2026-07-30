// backend/routes/auth.js
const router   = require('express').Router();
const argon2   = require('argon2');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool     = require('../db/pool');
const authMid  = require('../middleware/auth');
const { sendSignupVerificationEmail, sendPasswordResetEmail, consumeToken } = require('../lib/email');
const { lookupIpCountry, getClientIp } = require('../lib/geoip');
const { getBalances } = require('../lib/tokens');

async function logAccessEvent(userId, req, eventType) {
  try {
    const ip = getClientIp(req);
    const { country, countryCode } = await lookupIpCountry(ip);
    await pool.query(
      `INSERT INTO user_access_log (user_id, ip_address, country, country_code, event_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, ip, country, countryCode, eventType]
    );
    return { country, countryCode };
  } catch (err) {
    console.error('logAccessEvent error:', err.message);
    return { country: null, countryCode: null };
  }
}

async function createSessionAndRespond(user, req, res, timezone) {
  let streamToken = null;
  try {
    const { StreamClient } = require('@stream-io/node-sdk');
    const streamClient = new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET);
    await streamClient.upsertUsers([{ id: user.id, name: user.display_name || user.email }]);
    streamToken = streamClient.generateUserToken({ user_id: user.id });
  } catch {}

  const sessionId = uuidv4();
  const token = jwt.sign(
    { userId: user.id, sessionId, isArtist: user.is_artist || false },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );

  if (user.is_artist) {
    // Jinal's account supports multiple concurrent sessions (phone + laptop at once) —
    // each login simply adds a new session row rather than replacing the existing one.
    await pool.query(
      `INSERT INTO active_sessions (user_id, session_id, device_hint) VALUES ($1, $2, $3)`,
      [user.id, sessionId, req.headers['user-agent']?.slice(0, 100) || null]
    );
  } else {
    // Fans keep single-session enforcement — a new login replaces any existing session,
    // which also serves as a mild deterrent against sharing a paid membership login.
    await pool.query('DELETE FROM active_sessions WHERE user_id = $1', [user.id]);
    await pool.query(
      `INSERT INTO active_sessions (user_id, session_id, device_hint) VALUES ($1, $2, $3)`,
      [user.id, sessionId, req.headers['user-agent']?.slice(0, 100) || null]
    );
  }

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  if (timezone) {
    await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, user.id]);
  }

  await logAccessEvent(user.id, req, 'login');

  res.json({
    jwt: token,
    streamToken,
    user: {
      id:            user.id,
      email:         user.email,
      tier:          user.tier,
      coinBalance:   user.coin_balance,
      displayName:   user.display_name,
      phoneVerified: user.phone_verified,
      isArtist:      user.is_artist || false,
    },
  });
}

// ── SIGNUP ────────────────────────────────────

router.post('/signup', async (req, res) => {
  const { email, password, dob, displayName, consentTerms, consentNoRefund, timezone } = req.body;

  if (!email || !password || !dob) {
    return res.status(400).json({ error: 'Email, password and date of birth are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const birthDate = new Date(dob);
  const today     = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  if (age < 18) return res.status(400).json({ error: 'You must be 18 or older' });

  if (!consentTerms || !consentNoRefund) {
    return res.status(400).json({ error: 'You must accept both agreements to create an account' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hash = await argon2.hash(password);

  const { rows } = await pool.query(
    `INSERT INTO users
       (email, password_hash, dob, display_name, consent_terms, consent_no_refund, consented_at, email_verified, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), FALSE, $7)
     RETURNING id, email, tier, coin_balance, display_name`,
    [normalizedEmail, hash, dob, displayName?.trim() || null, true, true, timezone || null]
  );
  const user = rows[0];

  const { country, countryCode } = await logAccessEvent(user.id, req, 'signup');
  if (country) {
    await pool.query(
      'UPDATE users SET signup_country = $1, signup_country_code = $2 WHERE id = $3',
      [country, countryCode, user.id]
    );
  }

  try {
    await sendSignupVerificationEmail(user);
  } catch (err) {
    console.error('signup verification email error:', err.message);
  }

  res.json({
    ok: true,
    requiresVerification: true,
    message: `We've sent a verification link to ${user.email}. Please check your inbox to activate your account.`,
  });
});

// ── VERIFY EMAIL (signup) ─────────────────────

router.post('/verify-email', async (req, res) => {
  const { token, timezone } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const userId = await consumeToken(token, 'signup');
    const { rows } = await pool.query(
      `UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING *`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });

    try {
      const { postSystemMessage } = require('./community');
      const welcomeName = rows[0].display_name || 'A new member';
      postSystemMessage(`🎉 ${welcomeName} just joined Personal Space. Welcome!`);
    } catch {}

    await createSessionAndRespond(rows[0], req, res, timezone);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  if (!rows.length) return res.status(404).json({ error: 'No account found with this email' });

  const user = rows[0];
  if (user.email_verified) return res.status(400).json({ error: 'This email is already verified — try logging in.' });

  try {
    await sendSignupVerificationEmail(user);
    res.json({ ok: true, message: `Verification email resent to ${user.email}.` });
  } catch (err) {
    res.status(429).json({ error: err.message });
  }
});

// ── LOGIN ─────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password, timezone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);

  if (!rows.length) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  const user  = rows[0];
  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  if (!user.email_verified) {
    return res.status(403).json({
      error:   'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before signing in. Check your inbox, or request a new link.',
    });
  }

  await createSessionAndRespond(user, req, res, timezone);
});

// ── LOGOUT ────────────────────────────────────

router.post('/logout', authMid, async (req, res) => {
  // Only this device's session — logging out on one device shouldn't sign out other
  // active sessions on the same account (matters now that Jinal can have several).
  await pool.query('DELETE FROM active_sessions WHERE user_id = $1 AND session_id = $2', [req.user.userId, req.user.sessionId]);
  res.json({ ok: true });
});

// ── PHONE VERIFY (post-first-payment) ──────────

router.post('/verify-phone/send', authMid, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const { rows } = await pool.query(
    "SELECT COUNT(*) FROM coin_ledger WHERE user_id = $1 AND type = 'recharge'",
    [req.user.userId]
  );
  if (parseInt(rows[0].count, 10) === 0) {
    return res.status(403).json({ error: 'Phone verification is available after your first purchase' });
  }

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phone, channel: 'sms' });

  res.json({ sent: true });
});

router.post('/verify-phone/confirm', authMid, async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const check  = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phone, code });

  if (check.status !== 'approved') return res.status(400).json({ error: 'Incorrect code' });

  await pool.query(
    'UPDATE users SET phone = $1, phone_verified = true WHERE id = $2',
    [phone, req.user.userId]
  );
  res.json({ verified: true });
});

// ── FORGOT PASSWORD (email link) ────────────────

router.post('/forgot/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);

  const genericMessage = 'If an account exists for that email, a reset link has been sent.';

  if (!rows.length) {
    return res.json({ ok: true, message: genericMessage });
  }

  try {
    await sendPasswordResetEmail(rows[0]);
  } catch (err) {
    console.error('password reset email error:', err.message);
  }

  res.json({ ok: true, message: genericMessage });
});

router.post('/forgot/confirm', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

  try {
    const userId = await consumeToken(token, 'password_reset');
    const hash = await argon2.hash(newPassword);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await pool.query('DELETE FROM active_sessions WHERE user_id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET PROFILE ────────────────────────────────

router.get('/profile', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, dob, tier, coin_balance, membership_expires_at, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const balances = await getBalances(pool, req.user.userId);
    res.json({
      user: {
        ...rows[0],
        gifted_balance:         balances.gifted,
        total_balance:          balances.total,
        gifted_expires_in_days: balances.giftedExpiresInDays,
      },
    });
  } catch (err) {
    console.error('profile/get error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── UPDATE PROFILE ──────────────────────────────

router.patch('/profile', authMid, async (req, res) => {
  const { displayName, dob } = req.body;

  if (dob) {
    const birthDate = new Date(dob);
    const today     = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    if (age < 18) return res.status(400).json({ error: 'You must be 18 or older' });
    if (isNaN(birthDate.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         display_name = COALESCE($1, display_name),
         dob          = COALESCE($2::date, dob)
       WHERE id = $3
       RETURNING id, email, display_name, dob, tier, coin_balance`,
      [displayName?.trim() || null, dob || null, req.user.userId]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('profile/update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;