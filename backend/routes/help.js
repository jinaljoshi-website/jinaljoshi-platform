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
const { effectiveAllowances, renewalSummary } = require('../lib/allowance');

router.get('/context', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance, timezone,
              renewal_streak
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const u = rows[0];
    const isActive = u.membership_expires_at && new Date(u.membership_expires_at) > new Date();
    const tier = isActive ? u.tier : 'guest';

    // The member's own allowances, not the tier's.
    //
    // The cap used to be read here with getConfigNumber(...).catch(() => 0),
    // which looks safe and is not: these ladder keys are not in
    // REQUIRED_PRICING, so a missing one comes back undefined rather than
    // throwing and the catch never fires. The help panel would then print an
    // undefined allowance while the gallery charged full price for every set.
    // Routed through the shared helper, which returns finite or null and
    // nothing in between, and which applies the early-renewal bonus so this
    // page agrees with the gallery.
    const [bal, dm, allowances, discountPct, guestMult, tokenRate, selfieTiers,
           selfieCost, selfiePass] = await Promise.all([
      getBalances(pool, req.user.userId),
      getDmConfigForTier(tier),
      effectiveAllowances(u, tier),
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

      // A cap of 0 is uncapped and null is unreadable — neither is a number of
      // sets, so neither gets subtracted into a misleading "remaining".
      unlocks: (() => {
        const cap = allowances ? allowances.openCap : null;
        const known = Number.isFinite(cap) && cap > 0;
        return {
          allowance: cap,
          used: unlocksUsed,
          remaining: known ? Math.max(0, cap - unlocksUsed) : null,
          unlimited: cap === 0,
        };
      })(),

      messages: {
        freePerMonth: allowances ? allowances.dmFreePerMonth : dm.freeDMsPerMonth,
        freeRemaining: Math.max(0, (allowances ? allowances.dmFreePerMonth : dm.freeDMsPerMonth) - dmsUsed),
        dailyCap: dm.dailyDMCap,
        dailyRemaining: Math.max(0, dm.dailyDMCap - dmsToday),
        costAfterFree: dm.overageCost,
      },

      // Why those two numbers are what they are, so the panel can say so.
      renewalBonus: tier === 'guest' ? null : renewalSummary(u),

      selfies: { free: selfiesFree, unlockCost: selfieCost, passCost: selfiePass },
    });
  } catch (err) {
    console.error('help/context error:', err);
    res.status(500).json({ error: 'Could not load your details' });
  }
});

module.exports = router;