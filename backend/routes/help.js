// backend/routes/help.js
// Everything the help panel needs to answer a question about this fan.
//
// Deliberately not a language model. The questions people ask here are about
// prices, allowances and what their membership includes — all things with an
// exact answer sitting in config and in their own record. A model answering
// from a prompt would be right most of the time, and a confidently wrong answer
// about what somebody has paid for is worse than no answer at all.
//
// So: one call, the fan's real position, and the panel phrases it.

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { getBalances } = require('../lib/tokens');
const {
  getConfigNumber, getConfigValue, getDmConfigForTier,
  getDiscountForTier, getGuestMultiplier,
} = require('../lib/config');
const { getAllotmentPeriodKey, getLocalDateStr } = require('../lib/time');

router.get('/context', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance, timezone
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const u = rows[0];
    const isActive = u.membership_expires_at && new Date(u.membership_expires_at) > new Date();
    const tier = isActive ? u.tier : 'guest';

    const [bal, dm, unlockAllowance, discountPct, guestMult, tokenRate, selfieTiers,
           selfieCost, selfiePass] = await Promise.all([
      getBalances(pool, req.user.userId),
      getDmConfigForTier(tier),
      tier === 'guest' ? 0 : getConfigNumber(`tier_open_cap_${tier}`).catch(() => 0),
      getDiscountForTier(tier),
      getGuestMultiplier(),
      getConfigNumber('token_rate_inr'),
      getConfigValue('selfie_free_tiers'),
      getConfigNumber('selfie_unlock_cost'),
      getConfigNumber('selfie_pass_cost'),
    ]);

    // What they have actually used this period, so the answer is their number
    // rather than the tier's.
    let unlocksUsed = 0, dmsUsed = 0, dmsToday = 0;
    if (tier !== 'guest') {
      const { rows: allot } = await pool.query(
        `SELECT unlocks_used, free_dms_used, free_dms_today, dms_date
         FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, getAllotmentPeriodKey(u.membership_started_at)]
      );
      const a = allot[0];
      if (a) {
        unlocksUsed = a.unlocks_used || 0;
        dmsUsed     = a.free_dms_used || 0;
        const today = getLocalDateStr(u.timezone);
        const rowDay = a.dms_date ? new Date(a.dms_date).toISOString().slice(0, 10) : null;
        dmsToday = rowDay === today ? (a.free_dms_today || 0) : 0;
      }
    }

    const selfiesFree = String(selfieTiers || '')
      .split(',').map((s) => s.trim().toLowerCase()).includes(tier);

    res.json({
      tier,
      isMember: tier !== 'guest',
      expiresAt: isActive ? u.membership_expires_at : null,
      tokenRate,
      guestMultiplier: guestMult,
      discountPct,

      tokens: {
        purchased: bal.purchased,
        gifted: bal.gifted,
        total: bal.total,
        giftedExpiresInDays: bal.giftedExpiresInDays,
      },

      unlocks: {
        allowance: unlockAllowance,
        used: unlocksUsed,
        remaining: Math.max(0, unlockAllowance - unlocksUsed),
      },

      messages: {
        freePerMonth: dm.freeDMsPerMonth,
        freeRemaining: Math.max(0, dm.freeDMsPerMonth - dmsUsed),
        dailyCap: dm.dailyDMCap,
        dailyRemaining: Math.max(0, dm.dailyDMCap - dmsToday),
        costAfterFree: dm.overageCost,
      },

      selfies: { free: selfiesFree, unlockCost: selfieCost, passCost: selfiePass },
    });
  } catch (err) {
    console.error('help/context error:', err);
    res.status(500).json({ error: 'Could not load your details' });
  }
});

module.exports = router;