// backend/routes/membership.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { getTierPrice, getAllTierPrices, getConfigNumber } = require('../lib/config');
const { roundTokensUp } = require('../lib/pricing');
const { addMonthsClamped } = require('../lib/time');

// The date a fan is shown, decided here rather than recomputed in the browser.
// Two copies of the same month arithmetic will drift, and the browser works in
// local time while expiry is stamped in UTC — so a purchase made late in the
// evening IST could be shown a day out.
//
// Deliberately the day BEFORE true expiry: a membership bought at 2pm really
// runs to 2pm a month later, but promising "the 5th" invites "it said the 5th
// and it stopped at lunchtime". Showing the 4th means the real cutoff is always
// later than promised, never earlier.
function displayExpiry(expiresAt) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}
const { spendTokens } = require('../lib/tokens');
const { sendMembershipWelcome } = require('../lib/welcome');

const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

// Billing months are Studio-configurable — Settings → Pricing & Discounts.
async function termMultiplier(term) {
  if (term === 'quarterly') return getConfigNumber('quarterly_billing_months');
  if (term === 'annual')    return getConfigNumber('annual_billing_months');
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
      expiresAtLabel: displayExpiry(user.membership_expires_at),
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

  const TIER_PRICES = await getAllTierPrices();
  if (!TIER_PRICES[tier]) return res.status(400).json({ error: 'Invalid membership tier' });
  if (!['monthly', 'quarterly', 'annual'].includes(term)) {
    return res.status(400).json({ error: 'Invalid term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance, display_name, email FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const fanLabel = user.display_name || 'A member';

    if (isActive) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'You already have an active membership. Use upgrade or extend instead.' });
    }

    const basePrice = TIER_PRICES[tier];
    const mult      = await termMultiplier(term);
    const months    = termMonths(term);
    const totalCost = roundTokensUp(basePrice * mult);


    // Buying outright while a membership is still running used to overwrite the
    // expiry from today, silently destroying paid-for days. Extending or
    // upgrading are the correct routes, so say so rather than reinterpret.
    if (user.membership_expires_at && new Date(user.membership_expires_at) > now) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error:   'ALREADY_MEMBER',
        message: 'You already have an active membership. Use Extend to add time, or Upgrade to move to a higher tier.',
      });
    }

    const expiresAt = addMonthsClamped(now, months);

    await client.query(
      `UPDATE users SET
         tier                   = $1,
         membership_expires_at  = $2,
         membership_started_at  = $4,
         membership_term        = $5
       WHERE id = $3`,
      [tier, expiresAt, req.user.userId, now, term]
    );

    // Membership is bought with purchased tokens. Gifting a membership is its own
    // deliberate act in Studio, not something a token grant should quietly enable.
    try {
      await spendTokens(client, {
        userId:      req.user.userId,
        amount:      totalCost,
        type:        'membership_purchase',
        label:       `${tier} membership — ${term}`,
        allowGifted: false,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        await client.query('ROLLBACK');
        return res.status(402).json(err.httpBody);
      }
      throw err;
    }


    await client.query('COMMIT');

    postSystemMessage(`✨ ${fanLabel} just joined as a ${tier.charAt(0).toUpperCase() + tier.slice(1)} member!`, { kind: 'arrival' });

    // Only after the purchase is committed — a note thanking someone for
    // becoming a member must not arrive if the transaction rolled back. The
    // send is guarded against duplicates, so a renewal or a second tier change
    // will not repeat it.
    sendMembershipWelcome({ id: req.user.userId, email: user.email, display_name: user.display_name }, tier);

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

  const TIER_PRICES = await getAllTierPrices();
  if (!TIER_PRICES[newTier]) return res.status(400).json({ error: 'Invalid tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance, display_name, email FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const fanLabel = user.display_name || 'A member';

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

    const daysRemaining   = Math.ceil((new Date(user.membership_expires_at) - now) / (1000 * 60 * 60 * 24));
    const daysInMonth     = 30;
    const currentPerDay   = TIER_PRICES[user.tier]  / daysInMonth;
    const newPerDay       = TIER_PRICES[newTier]     / daysInMonth;
    const upgradeCost     = Math.max(1, Math.ceil((newPerDay - currentPerDay) * daysRemaining));


    // The upgrade cost above is pro-rated across daysRemaining. Overwriting the
    // expiry would charge for those days and then delete them, so the expiry and
    // the allowance cycle both stay exactly as they were — only the tier moves.
    const newExpiry = new Date(user.membership_expires_at);

    await client.query(
      `UPDATE users SET tier = $1 WHERE id = $2`,
      [newTier, req.user.userId]
    );

    // Membership is bought with purchased tokens. Gifting a membership is its own
    // deliberate act in Studio, not something a token grant should quietly enable.
    try {
      await spendTokens(client, {
        userId:      req.user.userId,
        amount:      upgradeCost,
        type:        'membership_upgrade',
        label:       `Upgrade from ${user.tier} to ${newTier}`,
        allowGifted: false,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        await client.query('ROLLBACK');
        return res.status(402).json(err.httpBody);
      }
      throw err;
    }


    await client.query('COMMIT');

    postSystemMessage(`⬆️ ${fanLabel} just upgraded to ${newTier.charAt(0).toUpperCase() + newTier.slice(1)}!`, { kind: 'arrival' });

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

    const basePrice = await getTierPrice(user.tier);
    const mult      = await termMultiplier(term);
    const months    = termMonths(term);
    const totalCost = roundTokensUp(basePrice * mult);


    const expiresAt = addMonthsClamped(user.membership_expires_at, months);

    await client.query(
      `UPDATE users SET membership_expires_at = $1 WHERE id = $2`,
      [expiresAt, req.user.userId]
    );

    // Membership is bought with purchased tokens. Gifting a membership is its own
    // deliberate act in Studio, not something a token grant should quietly enable.
    try {
      await spendTokens(client, {
        userId:      req.user.userId,
        amount:      totalCost,
        type:        'membership_extend',
        label:       `${user.tier} membership extended — ${term}`,
        allowGifted: false,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        await client.query('ROLLBACK');
        return res.status(402).json(err.httpBody);
      }
      throw err;
    }


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
  const { email, tier, term = 'monthly', note } = req.body;

  const TIER_PRICES = await getAllTierPrices();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!TIER_PRICES[tier]) return res.status(400).json({ error: 'Invalid tier' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: fanRows } = await client.query(
      `SELECT id, email, display_name, membership_expires_at FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (!fanRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }
    const fan = fanRows[0];
    const now = new Date();
    const isActive = fan.membership_expires_at && new Date(fan.membership_expires_at) > now;
    const fanLabel = fan.display_name || 'A member';

    if (isActive) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'This fan already has an active membership. Use extend or change tier instead.' });
    }

    const months    = termMonths(term);
    const expiresAt = addMonthsClamped(now, months);

    await client.query(
      `UPDATE users SET tier = $1, membership_expires_at = $2,
              membership_started_at = $4, membership_term = $5
       WHERE id = $3`,
      [tier, expiresAt, fan.id, now, term]
    );

    await client.query(
      `INSERT INTO membership_gifts (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.userId, fan.email, fan.id, tier, term, expiresAt, note || null]
    );

    await client.query('COMMIT');

    postSystemMessage(`🎁 ${fanLabel} just received a ${tier} membership gift!`, { kind: 'arrival' });

    res.json({ ok: true, message: `${tier} membership gifted to ${fan.email}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift error:', err);
    res.status(500).json({ error: 'Failed to gift membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift/extend
// ─────────────────────────────────────────────

router.post('/gift/extend', authMid, async (req, res) => {
  const { email, term = 'monthly' } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!['monthly', 'quarterly', 'annual'].includes(term)) {
    return res.status(400).json({ error: 'Invalid term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: fanRows } = await client.query(
      `SELECT id, email, tier, membership_expires_at FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (!fanRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }
    const fan = fanRows[0];
    const now = new Date();
    const isActive = fan.membership_expires_at && new Date(fan.membership_expires_at) > now;

    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This fan has no active membership to extend' });
    }

    const months    = termMonths(term);
    const expiresAt = addMonthsClamped(fan.membership_expires_at, months);

    await client.query(
      `UPDATE users SET membership_expires_at = $1 WHERE id = $2`,
      [expiresAt, fan.id]
    );

    await client.query(
      `INSERT INTO membership_gifts (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.userId, fan.email, fan.id, fan.tier, term, expiresAt, 'Extension of existing membership']
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: `${fan.email}'s ${fan.tier} membership extended to ${expiresAt.toLocaleDateString()}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift/extend error:', err);
    res.status(500).json({ error: 'Failed to extend membership' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/membership/gift/change
// ─────────────────────────────────────────────

router.post('/gift/change', authMid, async (req, res) => {
  const { email, tier, term = 'monthly', note } = req.body;

  const TIER_PRICES = await getAllTierPrices();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!TIER_PRICES[tier]) return res.status(400).json({ error: 'Invalid tier' });
  if (!['monthly', 'quarterly', 'annual'].includes(term)) {
    return res.status(400).json({ error: 'Invalid term' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: fanRows } = await client.query(
      `SELECT id, email, membership_expires_at FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (!fanRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }
    const fan = fanRows[0];
    const now = new Date();
    const isActive = fan.membership_expires_at && new Date(fan.membership_expires_at) > now;

    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This fan has no active membership to change' });
    }

    const months    = termMonths(term);
    const expiresAt = addMonthsClamped(fan.membership_expires_at, months);

    await client.query(
      `UPDATE users SET tier = $1, membership_expires_at = $2 WHERE id = $3`,
      [tier, expiresAt, fan.id]
    );

    await client.query(
      `INSERT INTO membership_gifts (granted_by, recipient_email, recipient_id, tier, term, expires_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.userId, fan.email, fan.id, tier, term, expiresAt, note || 'Tier change on existing membership']
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: `${fan.email} changed to ${tier}, now expires ${expiresAt.toLocaleDateString()}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('membership/gift/change error:', err);
    res.status(500).json({ error: 'Failed to change membership tier' });
  } finally {
    client.release();
  }
});

module.exports = router;