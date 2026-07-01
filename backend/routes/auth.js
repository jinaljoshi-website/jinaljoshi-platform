// backend/routes/auth.js
const router   = require('express').Router();
const argon2   = require('argon2');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool     = require('../db/pool');
const authMid  = require('../middleware/auth');

// ── SIGNUP ────────────────────────────────────

router.post('/signup', async (req, res) => {
  const { email, password, dob, displayName, consentTerms, consentNoRefund } = req.body;

  if (!email || !password || !dob) {
    return res.status(400).json({ error: 'Email, password and date of birth are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // Age check
  const birthDate = new Date(dob);
  const today     = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  if (age < 18) return res.status(400).json({ error: 'You must be 18 or older' });

  // Consent check
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
       (email, password_hash, dob, display_name, consent_terms, consent_no_refund, consented_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, email, tier, coin_balance, display_name`,
    [normalizedEmail, hash, dob, displayName?.trim() || null, true, true]
  );
  const user = rows[0];

  const sessionId = uuidv4();
  const token     = jwt.sign(
    { userId: user.id, sessionId, isArtist: false },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  await pool.query(
    'INSERT INTO active_sessions (user_id, session_id) VALUES ($1, $2)',
    [user.id, sessionId]
  );

  // System message to community (fire and forget)
  try {
    const { postSystemMessage } = require('./community');
    postSystemMessage('🎉 A new member just joined Personal Space. Welcome!');
  } catch {}

  res.json({
    jwt: token,
    user: {
      id:          user.id,
      email:       user.email,
      tier:        user.tier,
      coinBalance: user.coin_balance,
      displayName: user.display_name,
    },
  });
});

// ── LOGIN ─────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

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

  let streamToken = null;
  try {
    const { StreamClient } = require('@stream-io/node-sdk');
    const streamClient = new StreamClient(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET);
    await streamClient.upsertUsers([{ id: user.id, name: user.display_name || user.email }]);
    streamToken = streamClient.generateUserToken({ user_id: user.id });
  } catch {}

  const sessionId = uuidv4();
  const token     = jwt.sign(
    { userId: user.id, sessionId, isArtist: user.is_artist },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  await pool.query(
    `INSERT INTO active_sessions (user_id, session_id, device_hint)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET session_id = $2, device_hint = $3, created_at = NOW()`,
    [user.id, sessionId, req.headers['user-agent']?.slice(0, 100)]
  );

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

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
      isArtist:      user.is_artist,
    },
  });
});

// ── LOGOUT ────────────────────────────────────

router.post('/logout', authMid, async (req, res) => {
  await pool.query('DELETE FROM active_sessions WHERE user_id = $1', [req.user.userId]);
  res.json({ ok: true });
});

// ── PHONE VERIFY ──────────────────────────────

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

// ── FORGOT PASSWORD ───────────────────────────

router.post('/forgot/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  if (!rows.length) return res.status(404).json({ error: 'No account found with this email' });

  const user = rows[0];
  if (!user.phone_verified) {
    return res.status(400).json({ error: 'Phone verification required before password reset' });
  }

  const monthKey   = new Date().toISOString().slice(0, 7);
  const { rows: allotRows } = await pool.query(
    'SELECT password_resets_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2',
    [user.id, monthKey]
  );

  const resetsUsed = allotRows[0]?.password_resets_used || 0;
  const freeLimit  = parseInt(process.env.PASSWORD_RESET_FREE_LIMIT || '2', 10);
  const penalty    = parseInt(process.env.PASSWORD_RESET_COIN_PENALTY || '25', 10);

  if (resetsUsed >= freeLimit) {
    if (user.coin_balance < penalty) {
      return res.status(402).json({
        error:   'INSUFFICIENT_COINS',
        message: `You need ${penalty} tokens for an additional password reset this month`,
        shortBy: penalty - user.coin_balance,
      });
    }
    await pool.query('UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2', [penalty, user.id]);
    await pool.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'debit', 'debit', $2, 'Password reset fee')`,
      [user.id, penalty]
    );
  }

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: user.phone, channel: 'sms' });

  await pool.query(
    `INSERT INTO monthly_allotments (user_id, month_key, password_resets_used)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, month_key) DO UPDATE
     SET password_resets_used = monthly_allotments.password_resets_used + 1`,
    [user.id, monthKey]
  );

  res.json({ sent: true, phone: user.phone.slice(-4) });
});

router.post('/forgot/confirm', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code and new password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  if (!rows.length) return res.status(404).json({ error: 'Account not found' });

  const user   = rows[0];
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const check  = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: user.phone, code });

  if (check.status !== 'approved') return res.status(400).json({ error: 'Incorrect code' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

  const hash = await argon2.hash(newPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  await pool.query('DELETE FROM active_sessions WHERE user_id = $1', [user.id]);

  res.json({ ok: true });
});

// ── GET PROFILE ────────────────────────────────────────

router.get('/profile', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, dob, tier, coin_balance, membership_expires_at, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('profile/get error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── UPDATE PROFILE ─────────────────────────────────────

router.patch('/profile', authMid, async (req, res) => {
  const { displayName, dob } = req.body;

  // Validate DOB if provided
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