// backend/routes/membership.js
// Handles membership purchase, upgrade, and gifting (artist only)

const router = require('express').Router();
const pool   = require('../db/pool');
const authMid      = require('../middleware/auth');
const artistOnly   = require('../middleware/artistOnly');

// Tier hierarchy for validation
const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

// Monthly token costs — mirrors data.js TIERS
const TIER_COSTS = {
  community: 10,
  insider:   30,
  premium:   75,
  supreme:   150,
};

// Billing multipliers — mirrors data.js TERMS
const TERM_BILLING = {
  monthly:   1,
  quarterly: 2.5,
  annual:    9,
};

// Months of access per term
const TERM_MONTHS = {
  monthly:   1,
  quarterly: 3,
  annual:    12,
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function calcMembershipCost(tier, term) {
  const monthly = TIER_COSTS[tier];
  const mult    = TERM_BILLING[term];
  if (!monthly || !mult) return null;
  return Math.round(monthly * mult);
}

function calcExpiresAt(term) {
  const months = TERM_MONTHS[term];
  if (!months) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

function calcUpgradeCost(oldTier, newTier, daysRemaining) {
  const oldMonthly = TIER_COSTS[oldTier] || 0;
  const newMonthly = TIER_COSTS[newTier] || 0;
  const rawCredit  = (oldMonthly / 30) * daysRemaining;
  const credit     = rawCredit % 1 >= 0.5 ? Math.ceil(rawCredit) : Math.floor(rawCredit);
  return Math.max(0, newMonthly - credit);
}

function monthsToDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

// ─────────────────────────────────────────────
// GET /api/membership/status
// Returns current user's membership info
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_term, membership_started_at, coin_balance
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const user = rows[0];
    const now  = new Date();
    const expiresAt = user.membership_expires_at ? new Date(user.membership_expires_at) : null;
    const isActive  = expiresAt && expiresAt > now;

    let daysRemaining = 0;
    if (isActive) {
      daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    }

    res.json({
      tier:            isActive ? user.tier : 'guest',
      expiresAt:       user.membership_expires_at,
      term:            user.membership_term,
      startedAt:       user.membership_started_at,
      isActive,
      daysRemaining,
      coinBalance:     user.coin_balance,
    });
  } catch (err) {
    console.error('membership/status error:', err);
    res.status(500).json({ error: 'Failed to fetch membership status' });
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/purchase
// Buy a new membership (user must be guest or expired)
// Body: { tier, term }
// ─────────────────────────────────────────────

router.post('/purchase', authMid, async (req, res) => {
  const { tier, term } = req.body;

  if (!TIER_COSTS[tier])    return res.status(400).json({ error: 'Invalid tier' });
  if (!TERM_BILLING[term])  return res.status(400).json({ error: 'Invalid term' });

  const cost = calcMembershipCost(tier, term);
  if (cost === null) return res.status(400).json({ error: 'Could not calculate cost' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock user row
    const { rows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = rows[0];
    const now  = new Date();
    const currentExpiry = user.membership_expires_at ? new Date(user.membership_expires_at) : null;
    const hasActiveMembership = currentExpiry && currentExpiry > now;

    if (hasActiveMembership) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'ALREADY_MEMBER',
        message: 'You already have an active membership. Use /upgrade to change tier or /extend to add time.',
        currentTier:   user.tier,
        expiresAt:     user.membership_expires_at,
      });
    }

    if (user.coin_balance < cost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `You need ${cost} tokens. You have ${user.coin_balance}.`,
        required:  cost,
        available: user.coin_balance,
        shortBy:   cost - user.coin_balance,
      });
    }

    const expiresAt = calcExpiresAt(term);

    // Deduct tokens
    await client.query(
      `UPDATE users
       SET coin_balance = coin_balance - $1,
           tier = $2,
           membership_expires_at = $3,
           membership_term = $4,
           membership_started_at = NOW()
       WHERE id = $5`,
      [cost, tier, expiresAt, term, req.user.userId]
    );

    // Log to ledger
    await client.query(
      `INSERT INTO coin_ledger
         (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_purchase', 'debit', $2, $3)`,
      [req.user.userId, cost, `${tier} membership — ${term}`]
    );

    // Notify artist
    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('membership_purchase', $1, $2)`,
      [req.user.userId, JSON.stringify({ tier, term, cost })]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      tier,
      term,
      cost,
      expiresAt,
      newBalance: user.coin_balance - cost,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/purchase error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/upgrade
// Upgrade to a higher tier mid-membership
// Body: { newTier }
// ─────────────────────────────────────────────

router.post('/upgrade', authMid, async (req, res) => {
  const { newTier } = req.body;

  if (!TIER_COSTS[newTier]) return res.status(400).json({ error: 'Invalid tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = rows[0];
    const now  = new Date();
    const expiresAt = user.membership_expires_at ? new Date(user.membership_expires_at) : null;

    if (!expiresAt || expiresAt <= now) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No active membership to upgrade. Use /purchase instead.' });
    }

    const currentTierIndex = TIER_ORDER.indexOf(user.tier);
    const newTierIndex     = TIER_ORDER.indexOf(newTier);

    if (newTierIndex <= currentTierIndex) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only upgrade to a higher tier.' });
    }

    const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    const cost          = calcUpgradeCost(user.tier, newTier, daysRemaining);
    const newExpiry     = monthsToDate(1); // new 1-month cycle from today

    if (user.coin_balance < cost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        required:  cost,
        available: user.coin_balance,
        shortBy:   cost - user.coin_balance,
      });
    }

    await client.query(
      `UPDATE users
       SET coin_balance = coin_balance - $1,
           tier = $2,
           membership_expires_at = $3,
           membership_term = 'monthly',
           membership_started_at = NOW()
       WHERE id = $4`,
      [cost, newTier, newExpiry, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger
         (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_upgrade', 'debit', $2, $3)`,
      [req.user.userId, cost, `Upgrade from ${user.tier} to ${newTier}`]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      previousTier: user.tier,
      newTier,
      cost,
      expiresAt: newExpiry,
      newBalance: user.coin_balance - cost,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/upgrade error:', err);
    res.status(500).json({ error: 'Upgrade failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/extend
// Add tenure to an existing membership (same tier)
// Body: { term }
// ─────────────────────────────────────────────

router.post('/extend', authMid, async (req, res) => {
  const { term } = req.body;

  if (!TERM_BILLING[term]) return res.status(400).json({ error: 'Invalid term' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = rows[0];
    const now  = new Date();
    const expiresAt = user.membership_expires_at ? new Date(user.membership_expires_at) : null;

    if (!expiresAt || expiresAt <= now) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No active membership to extend. Use /purchase instead.' });
    }

    const cost = calcMembershipCost(user.tier, term);

    if (user.coin_balance < cost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        required:  cost,
        available: user.coin_balance,
        shortBy:   cost - user.coin_balance,
      });
    }

    // Add months to current expiry
    const months    = TERM_MONTHS[term];
    const newExpiry = new Date(expiresAt);
    newExpiry.setMonth(newExpiry.getMonth() + months);

    await client.query(
      `UPDATE users
       SET coin_balance = coin_balance - $1,
           membership_expires_at = $2
       WHERE id = $3`,
      [cost, newExpiry, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger
         (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_purchase', 'debit', $2, $3)`,
      [req.user.userId, cost, `Extended ${user.tier} membership — ${term}`]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      tier:       user.tier,
      term,
      cost,
      expiresAt:  newExpiry,
      newBalance: user.coin_balance - cost,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/extend error:', err);
    res.status(500).json({ error: 'Extend failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift  [ARTIST ONLY]
// Jinal grants a free membership by email
// Body: { email, tier, term, note? }
// ─────────────────────────────────────────────

router.post('/gift', authMid, artistOnly, async (req, res) => {
  const { email, tier, term, note } = req.body;

  if (!email)               return res.status(400).json({ error: 'Email is required' });
  if (!TIER_COSTS[tier])    return res.status(400).json({ error: 'Invalid tier' });
  if (!TERM_BILLING[term])  return res.status(400).json({ error: 'Invalid term' });

  const normalizedEmail = email.toLowerCase().trim();
  const months          = TERM_MONTHS[term];
  const expiresAt       = monthsToDate(months);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if the user exists
    const { rows: userRows } = await client.query(
      `SELECT id, tier, membership_expires_at FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    const recipient = userRows[0] || null;
    const now       = new Date();

    if (recipient) {
      const currentExpiry = recipient.membership_expires_at
        ? new Date(recipient.membership_expires_at)
        : null;
      const isActive = currentExpiry && currentExpiry > now;

      if (isActive) {
        // Conflict — let artist decide
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'ALREADY_MEMBER',
          message: `${normalizedEmail} already has an active ${recipient.tier} membership.`,
          currentTier:  recipient.tier,
          expiresAt:    recipient.membership_expires_at,
          options: [
            { action: 'extend', description: 'Add tenure to their existing membership' },
            { action: 'change', description: 'Change tier and assign new duration' },
          ],
        });
      }

      // User exists but no active membership — apply it now
      await client.query(
        `UPDATE users
         SET tier = $1,
             membership_expires_at = $2,
             membership_term = $3,
             membership_started_at = NOW()
         WHERE id = $4`,
        [tier, expiresAt, term, recipient.id]
      );

      await client.query(
        `INSERT INTO coin_ledger
           (user_id, type, direction, amount, label)
         VALUES ($1, 'gifted_membership', 'credit', 0, $2)`,
        [recipient.id, `Gifted ${tier} membership (${term}) by artist`]
      );
    }

    // Record the gift regardless (for users who haven't signed up yet)
    await client.query(
      `INSERT INTO membership_gifts
         (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.userId, normalizedEmail, recipient?.id || null, tier, term, expiresAt, note || null]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      email: normalizedEmail,
      tier,
      term,
      expiresAt,
      appliedImmediately: !!recipient,
      message: recipient
        ? `Membership applied to ${normalizedEmail} immediately.`
        : `Gift recorded. Will apply when ${normalizedEmail} creates an account.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift error:', err);
    res.status(500).json({ error: 'Gift failed' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift/extend  [ARTIST ONLY]
// Extend an existing gifted/active membership
// Body: { email, term }
// ─────────────────────────────────────────────

router.post('/gift/extend', authMid, artistOnly, async (req, res) => {
  const { email, term } = req.body;

  if (!email)              return res.status(400).json({ error: 'Email is required' });
  if (!TERM_BILLING[term]) return res.status(400).json({ error: 'Invalid term' });

  const normalizedEmail = email.toLowerCase().trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, tier, membership_expires_at FROM users WHERE email = $1 FOR UPDATE`,
      [normalizedEmail]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }

    const user      = rows[0];
    const now       = new Date();
    const expiresAt = user.membership_expires_at ? new Date(user.membership_expires_at) : now;
    const months    = TERM_MONTHS[term];
    const newExpiry = new Date(Math.max(expiresAt, now));
    newExpiry.setMonth(newExpiry.getMonth() + months);

    await client.query(
      `UPDATE users SET membership_expires_at = $1 WHERE id = $2`,
      [newExpiry, user.id]
    );

    await client.query(
      `INSERT INTO membership_gifts
         (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, 'Extended by artist')`,
      [req.user.userId, normalizedEmail, user.id, user.tier, term, newExpiry]
    );

    await client.query('COMMIT');

    res.json({ ok: true, email: normalizedEmail, tier: user.tier, newExpiresAt: newExpiry });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift/extend error:', err);
    res.status(500).json({ error: 'Failed to extend membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift/change  [ARTIST ONLY]
// Change tier and reset duration for an existing member
// Body: { email, tier, term }
// ─────────────────────────────────────────────

router.post('/gift/change', authMid, artistOnly, async (req, res) => {
  const { email, tier, term } = req.body;

  if (!email)               return res.status(400).json({ error: 'Email is required' });
  if (!TIER_COSTS[tier])    return res.status(400).json({ error: 'Invalid tier' });
  if (!TERM_BILLING[term])  return res.status(400).json({ error: 'Invalid term' });

  const normalizedEmail = email.toLowerCase().trim();
  const months          = TERM_MONTHS[term];
  const newExpiry       = monthsToDate(months);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id FROM users WHERE email = $1 FOR UPDATE`,
      [normalizedEmail]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }

    const userId = rows[0].id;

    await client.query(
      `UPDATE users
       SET tier = $1, membership_expires_at = $2, membership_term = $3, membership_started_at = NOW()
       WHERE id = $4`,
      [tier, newExpiry, term, userId]
    );

    await client.query(
      `INSERT INTO membership_gifts
         (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, 'Tier changed by artist')`,
      [req.user.userId, normalizedEmail, userId, tier, term, newExpiry]
    );

    await client.query('COMMIT');

    res.json({ ok: true, email: normalizedEmail, tier, term, expiresAt: newExpiry });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift/change error:', err);
    res.status(500).json({ error: 'Failed to change membership' });
  } finally {
    client.release();
  }
});

module.exports = router;