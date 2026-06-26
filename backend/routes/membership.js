// backend/routes/membership.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');

const TIER_PRICES = {
  community: 10,
  insider:   30,
  premium:   75,
  supreme:   150,
};

const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

function termMultiplier(term) {
  if (term === 'quarterly') return 2.5;
  if (term === 'annual')    return 9;
  return 1;
}

function termMonths(term) {
  if (term === 'quarterly') return 3;
  if (term === 'annual')    return 12;
  return 1;
}

// ─────────────────────────────────────────────
// GET /api/membership/status
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user     = rows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    const daysRemaining = isActive
      ? Math.ceil((new Date(user.membership_expires_at) - now) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      isActive,
      tier:           isActive ? user.tier : 'guest',
      expiresAt:      user.membership_expires_at,
      daysRemaining,
      coinBalance:    user.coin_balance,
    });
  } catch (err) {
    console.error('membership/status error:', err);
    res.status(500).json({ error: 'Failed to load membership status' });
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/purchase
// ─────────────────────────────────────────────

router.post('/purchase', authMid, async (req, res) => {
  const { tier, term = 'monthly' } = req.body;

  if (!TIER_PRICES[tier]) return res.status(400).json({ error: 'Invalid membership tier' });
  if (!['monthly', 'quarterly', 'annual'].includes(term)) {
    return res.status(400).json({ error: 'Invalid term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    if (isActive) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'You already have an active membership. Use upgrade or extend instead.' });
    }

    const basePrice = TIER_PRICES[tier];
    const mult      = termMultiplier(term);
    const months    = termMonths(term);
    const totalCost = Math.round(basePrice * mult);

    if (user.coin_balance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `This membership costs ${totalCost} tokens. You have ${user.coin_balance}.`,
        required:  totalCost,
        available: user.coin_balance,
        shortBy:   totalCost - user.coin_balance,
      });
    }

    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await client.query(
      `UPDATE users SET
         coin_balance           = coin_balance - $1,
         tier                   = $2,
         membership_expires_at  = $3
       WHERE id = $4`,
      [totalCost, tier, expiresAt, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_purchase', 'debit', $2, $3)`,
      [req.user.userId, totalCost, `${tier} membership — ${term}`]
    );

    await client.query('COMMIT');

    // System message to community
    postSystemMessage(`✨ A new ${tier.charAt(0).toUpperCase() + tier.slice(1)} member just joined the space!`);

    res.json({
      ok:        true,
      tier,
      term,
      totalCost,
      expiresAt,
      newBalance: user.coin_balance - totalCost,
      message:   `${tier.charAt(0).toUpperCase() + tier.slice(1)} membership activated!`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/purchase error:', err);
    res.status(500).json({ error: 'Failed to purchase membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/upgrade
// ─────────────────────────────────────────────

router.post('/upgrade', authMid, async (req, res) => {
  const { newTier } = req.body;

  if (!TIER_PRICES[newTier]) return res.status(400).json({ error: 'Invalid tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No active membership to upgrade' });
    }

    const currentIdx = TIER_ORDER.indexOf(user.tier);
    const newIdx     = TIER_ORDER.indexOf(newTier);

    if (newIdx <= currentIdx) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'New tier must be higher than current tier' });
    }

    // Pro-rate: charge difference for remaining days
    const daysRemaining   = Math.ceil((new Date(user.membership_expires_at) - now) / (1000 * 60 * 60 * 24));
    const daysInMonth     = 30;
    const currentPerDay   = TIER_PRICES[user.tier]  / daysInMonth;
    const newPerDay       = TIER_PRICES[newTier]     / daysInMonth;
    const upgradeCost     = Math.max(1, Math.ceil((newPerDay - currentPerDay) * daysRemaining));

    if (user.coin_balance < upgradeCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `Upgrade costs ${upgradeCost} tokens. You have ${user.coin_balance}.`,
        required:  upgradeCost,
        available: user.coin_balance,
        shortBy:   upgradeCost - user.coin_balance,
      });
    }

    const newExpiry = new Date(now);
    newExpiry.setMonth(newExpiry.getMonth() + 1);

    await client.query(
      `UPDATE users SET
         coin_balance          = coin_balance - $1,
         tier                  = $2,
         membership_expires_at = $3
       WHERE id = $4`,
      [upgradeCost, newTier, newExpiry, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_upgrade', 'debit', $2, $3)`,
      [req.user.userId, upgradeCost, `Upgrade from ${user.tier} to ${newTier}`]
    );

    await client.query('COMMIT');

    postSystemMessage(`⬆️ A member just upgraded to ${newTier.charAt(0).toUpperCase() + newTier.slice(1)}!`);

    res.json({
      ok:         true,
      newTier,
      upgradeCost,
      expiresAt:  newExpiry,
      newBalance: user.coin_balance - upgradeCost,
      message:    `Upgraded to ${newTier}!`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/upgrade error:', err);
    res.status(500).json({ error: 'Failed to upgrade membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/extend
// ─────────────────────────────────────────────

router.post('/extend', authMid, async (req, res) => {
  const { term = 'monthly' } = req.body;

  if (!['monthly', 'quarterly', 'annual'].includes(term)) {
    return res.status(400).json({ error: 'Invalid term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No active membership to extend' });
    }

    const basePrice = TIER_PRICES[user.tier];
    const mult      = termMultiplier(term);
    const months    = termMonths(term);
    const totalCost = Math.round(basePrice * mult);

    if (user.coin_balance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `Extension costs ${totalCost} tokens. You have ${user.coin_balance}.`,
        required:  totalCost,
        available: user.coin_balance,
        shortBy:   totalCost - user.coin_balance,
      });
    }

    const expiresAt = new Date(user.membership_expires_at);
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await client.query(
      `UPDATE users SET
         coin_balance          = coin_balance - $1,
         membership_expires_at = $2
       WHERE id = $3`,
      [totalCost, expiresAt, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'membership_extend', 'debit', $2, $3)`,
      [req.user.userId, totalCost, `${user.tier} membership extended — ${term}`]
    );

    await client.query('COMMIT');

    res.json({
      ok:        true,
      tier:      user.tier,
      term,
      totalCost,
      expiresAt,
      newBalance: user.coin_balance - totalCost,
      message:   `Membership extended to ${expiresAt.toLocaleDateString()}`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/extend error:', err);
    res.status(500).json({ error: 'Failed to extend membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift
// ─────────────────────────────────────────────

router.post('/gift', authMid, async (req, res) => {
  const { email, tier, term = 'monthly' } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!TIER_PRICES[tier]) return res.status(400).json({ error: 'Invalid tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: fanRows } = await client.query(
      `SELECT id, email FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (!fanRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }
    const fan = fanRows[0];

    const months    = termMonths(term);
    const now       = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await client.query(
      `UPDATE users SET tier = $1, membership_expires_at = $2 WHERE id = $3`,
      [tier, expiresAt, fan.id]
    );

    await client.query(
      `INSERT INTO membership_gifts (gifter_id, recipient_id, tier, term, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.userId, fan.id, tier, term, expiresAt]
    );

    await client.query('COMMIT');

    postSystemMessage(`🎁 Someone just gifted a ${tier} membership!`);

    res.json({ ok: true, message: `${tier} membership gifted to ${fan.email}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift error:', err);
    res.status(500).json({ error: 'Failed to gift membership' });
  } finally {
    client.release();
  }
});

module.exports = router;