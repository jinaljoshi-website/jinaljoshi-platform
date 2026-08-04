// backend/routes/analytics.js
// Two questions, kept apart because they have different answers.
//
//   Purchased  tokens somebody paid for. This is the business.
//   Gifted     tokens Jinal gave away. This is generosity, and counting it as
//              revenue would flatter every figure on the page.
//
// Rupees lead throughout. Tokens are the platform's internal unit, but the
// question being asked here is a commercial one, and it is answered in money.

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');

router.use(authMid, artistOnly);

async function tokenRate() {
  const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'token_rate_inr'`);
  const r = parseFloat(rows[0]?.value);
  if (Number.isNaN(r)) { const e = new Error('Token rate is not configured'); e.code = 'NO_RATE'; throw e; }
  return r;
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─────────────────────────────────────────────
// PURCHASED — money in, and what it was spent on
// ─────────────────────────────────────────────

router.get('/purchased', async (req, res) => {
  try {
    const rate = await tokenRate();

    const [totals, byMonth, byType, outstanding, topFans] = await Promise.all([
      // Revenue is what fans actually paid, not tokens multiplied by a rate —
      // bulk recharges carry a discount, so the two differ.
      pool.query(
        `SELECT COALESCE(SUM(cl.payment_amount_inr), 0) AS revenue_inr,
                COALESCE(SUM(cl.amount), 0)             AS tokens_sold,
                COUNT(*)                             AS purchases
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.type = 'recharge' AND cl.direction = 'credit' AND u.is_test = FALSE`
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', cl.created_at), 'YYYY-MM') AS month,
                COALESCE(SUM(cl.payment_amount_inr), 0) AS revenue_inr,
                COALESCE(SUM(cl.amount), 0)             AS tokens,
                COUNT(*)                             AS purchases
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.type = 'recharge' AND cl.direction = 'credit' AND u.is_test = FALSE
         GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
      ),
      // Everything fans spend, whatever pot it came from.
      //
      // Splitting this by from_purchased answers the wrong question. That column
      // records which pot a token sat in, not whether anyone paid for it — a
      // grant made directly to a balance lands in the purchased pot and is then
      // indistinguishable from a purchase. So a fan who has never bought a token
      // appeared under "purchased spend", which is simply untrue.
      //
      // The question worth answering is where attention goes, and that does not
      // care how the tokens arrived. Gifted is reported alongside so the mix is
      // still visible.
      pool.query(
        `SELECT cl.type,
                COALESCE(SUM(cl.amount), 0)      AS tokens,
                COALESCE(SUM(cl.from_gifted), 0) AS gifted_tokens,
                COUNT(*)                         AS count
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.direction = 'debit' AND u.is_test = FALSE
         GROUP BY cl.type ORDER BY 2 DESC`
      ),
      // Tokens paid for but not yet spent. A real liability — the fan is owed
      // something for them.
      pool.query(`SELECT COALESCE(SUM(coin_balance), 0) AS tokens FROM users WHERE is_artist = FALSE AND is_test = FALSE`),
      pool.query(
        `SELECT u.email, u.display_name, u.tier,
                COALESCE(SUM(cl.payment_amount_inr), 0) AS spent_inr
         FROM users u JOIN coin_ledger cl ON cl.user_id = u.id
         WHERE cl.type = 'recharge' AND cl.direction = 'credit' AND u.is_artist = FALSE AND u.is_test = FALSE
         GROUP BY u.id, u.email, u.display_name, u.tier
         ORDER BY 4 DESC LIMIT 10`
      ),
    ]);

    const t = totals.rows[0];
    res.json({
      tokenRate: rate,
      revenueInr:   round(t.revenue_inr),
      tokensSold:   Number(t.tokens_sold),
      purchases:    Number(t.purchases),
      // What a token actually sold for on average, after discounts.
      effectiveRate: Number(t.tokens_sold) > 0 ? round(t.revenue_inr / t.tokens_sold) : rate,
      unspentTokens: Number(outstanding.rows[0].tokens),
      unspentInr:    round(outstanding.rows[0].tokens * rate),
      byMonth: byMonth.rows.map((r) => ({
        month: r.month, revenueInr: round(r.revenue_inr),
        tokens: Number(r.tokens), purchases: Number(r.purchases),
      })),
      spentOn: byType.rows.map((r) => ({
        type: r.type, tokens: Number(r.tokens),
        giftedTokens: Number(r.gifted_tokens),
        count: Number(r.count),
      })),
      topFans: topFans.rows.map((r) => ({
        who: r.display_name || r.email, tier: r.tier, spentInr: round(r.spent_inr),
      })),
    });
  } catch (err) {
    if (err.code === 'NO_RATE') return res.status(503).json({ error: err.message });
    console.error('analytics/purchased error:', err);
    res.status(500).json({ error: 'Failed to load' });
  }
});

// ─────────────────────────────────────────────
// GIFTED — what was given, and whether it was used
// ─────────────────────────────────────────────

router.get('/gifted', async (req, res) => {
  try {
    const rate = await tokenRate();

    const [grants, bySource, spent, byType, expiring] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(g.amount), 0)    AS granted,
                COALESCE(SUM(g.remaining), 0) AS remaining,
                COUNT(*)                      AS grants,
                COUNT(DISTINCT g.user_id)     AS people
         FROM gifted_grants g JOIN users u ON u.id = g.user_id WHERE u.is_test = FALSE`
      ),
      pool.query(
        `SELECT g.source, COALESCE(SUM(g.amount), 0) AS tokens, COUNT(*) AS grants
         FROM gifted_grants g JOIN users u ON u.id = g.user_id
         WHERE u.is_test = FALSE GROUP BY g.source ORDER BY 2 DESC`
      ),
      pool.query(
        `SELECT COALESCE(SUM(cl.from_gifted), 0) AS tokens FROM coin_ledger cl
         JOIN users u ON u.id = cl.user_id
         WHERE cl.direction = 'debit' AND cl.from_gifted > 0 AND u.is_test = FALSE`
      ),
      pool.query(
        `SELECT cl.type, COALESCE(SUM(cl.from_gifted), 0) AS tokens, COUNT(*) AS count
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.direction = 'debit' AND cl.from_gifted > 0 AND u.is_test = FALSE
         GROUP BY cl.type ORDER BY 2 DESC`
      ),
      // Given but going to waste. The number worth acting on — a nudge before
      // these lapse is the whole reason to look at this page.
      pool.query(
        `SELECT COALESCE(SUM(g.remaining), 0) AS tokens, COUNT(DISTINCT g.user_id) AS people
         FROM gifted_grants g JOIN users u ON u.id = g.user_id
         WHERE u.is_test = FALSE AND g.remaining > 0
           AND g.expires_at > NOW() AND g.expires_at < NOW() + INTERVAL '7 days'`
      ),
    ]);

    const g = grants.rows[0];
    const used = Number(spent.rows[0].tokens);
    const granted = Number(g.granted);
    const live = Number(g.remaining);

    res.json({
      tokenRate: rate,
      grantedTokens: granted,
      grantedInr:    round(granted * rate),
      usedTokens:    used,
      usedInr:       round(used * rate),
      // Granted, never spent, and now past its window. Generosity that did
      // nothing — worth knowing, because the fix is a nudge not a bigger gift.
      lapsedTokens:  Math.max(0, granted - used - live),
      liveTokens:    live,
      takeUpPct:     granted > 0 ? Math.round((used / granted) * 100) : 0,
      grants:        Number(g.grants),
      people:        Number(g.people),
      bySource: bySource.rows.map((r) => ({
        source: r.source, tokens: Number(r.tokens),
        valueInr: round(r.tokens * rate), grants: Number(r.grants),
      })),
      spentOn: byType.rows.map((r) => ({
        type: r.type, tokens: Number(r.tokens),
        valueInr: round(r.tokens * rate), count: Number(r.count),
      })),
      expiringSoon: {
        tokens: Number(expiring.rows[0].tokens),
        people: Number(expiring.rows[0].people),
        valueInr: round(expiring.rows[0].tokens * rate),
      },
    });
  } catch (err) {
    if (err.code === 'NO_RATE') return res.status(503).json({ error: err.message });
    console.error('analytics/gifted error:', err);
    res.status(500).json({ error: 'Failed to load' });
  }
});

// ─────────────────────────────────────────────
// SETS — what the gallery earns
// ─────────────────────────────────────────────

// What a set has been worth. Two halves, and reporting only the first makes an
// active set look like it earned nothing:
//
//   Direct     purchased tokens spent unlocking it
//   Credit     unlocks taken on a membership allowance. Not free — the member
//              paid for them as part of their fee, and 35% of that fee (after
//              GST) is deemed to be for set access.
//
// A fan who buys tokens and spends them on a membership, then opens sets with
// the credits it grants, generates no direct set revenue at all. Without the
// credit half, the sets they actually looked at appear to have earned nothing.
router.get('/sets', async (req, res) => {
  try {
    const rate = await tokenRate();

    const { rows: cfgRows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key IN ('membership_set_share_pct', 'domestic_gst_rate_pct')
          OR key LIKE '%_monthly_cost' OR key LIKE 'gallery_unlocks_%'`
    );
    const cfg = {};
    cfgRows.forEach((r) => { cfg[r.key] = parseFloat(r.value); });
    const gstPct   = cfg.domestic_gst_rate_pct || 0;
    const setShare = cfg.membership_set_share_pct || 0;

    const unlockValue = {};
    for (const tier of ['community', 'insider', 'premium', 'supreme']) {
      const cost = cfg[`${tier}_monthly_cost`], allowance = cfg[`gallery_unlocks_${tier}`];
      unlockValue[tier] = (cost && allowance)
        ? ((cost / (1 + gstPct / 100)) * (setShare / 100)) / allowance
        : 0;
    }
    // Tokens are summed straight from the ledger, grouped by the set they were
    // spent on. The obvious-looking alternative — joining grants to their ledger
    // entry — double-counts: a fan who unlocks both the tier and upsell portions
    // has two grants, and both would match the same ledger row. That inflated
    // every set, and showed gifted spend as revenue where a set had no purchased
    // unlocks at all.
    const { rows } = await pool.query(
      `WITH spend AS (
         SELECT cl.related_id AS set_id,
                COALESCE(SUM(cl.from_purchased), 0)::int AS purchased_tokens,
                COALESCE(SUM(cl.from_gifted), 0)::int    AS gifted_tokens
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
         WHERE cl.type = 'content_unlock' AND cl.direction = 'debit'
           AND cl.related_id IS NOT NULL AND u.is_test = FALSE
         GROUP BY cl.related_id
       ),
       unlocks AS (
         SELECT ag.set_id,
                COUNT(*)::int AS unlocks,
                COUNT(*) FILTER (WHERE COALESCE(ag.coins_paid, 0) = 0)::int AS credit_unlocks,
                -- Kept per tier so each credit unlock is valued at what that
                -- member actually paid for it.
                jsonb_object_agg(t.tier, t.n) FILTER (WHERE t.tier IS NOT NULL) AS credit_by_tier
         FROM access_grants ag
         JOIN users u ON u.id = ag.user_id
         LEFT JOIN LATERAL (
           SELECT u.tier AS tier, 1 AS n WHERE COALESCE(ag.coins_paid, 0) = 0
         ) t ON TRUE
         WHERE u.is_test = FALSE GROUP BY ag.set_id
       )
       SELECT s.id, s.title, s.price_coins, p.name AS photographer,
              COALESCE(u.unlocks, 0)          AS unlocks,
              COALESCE(u.credit_unlocks, 0)   AS credit_unlocks,
              u.credit_by_tier,
              COALESCE(sp.purchased_tokens,0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)   AS gifted_tokens
       FROM sets s
       LEFT JOIN photographers p ON p.id = s.photographer_id
       LEFT JOIN spend sp   ON sp.set_id = s.id
       LEFT JOIN unlocks u  ON u.set_id  = s.id
       ORDER BY 7 DESC, s.created_at DESC`
    );

    const sets = rows.map((r) => {
      // Purchased tokens are GST-inclusive, so netting them keeps a direct
      // unlock and a credit unlock on the same footing.
      const directInr = (r.purchased_tokens * rate) / (1 + gstPct / 100);
      const creditInr = Object.entries(r.credit_by_tier || {})
        .reduce((sum, [tier, n]) => sum + (unlockValue[tier] || 0) * rate * n, 0);
      return {
        id: r.id, title: r.title, photographer: r.photographer,
        priceTokens: r.price_coins,
        unlocks: r.unlocks, creditUnlocks: r.credit_unlocks,
        purchasedTokens: r.purchased_tokens, giftedTokens: r.gifted_tokens,
        directInr:  round(directInr),
        creditInr:  round(creditInr),
        revenueInr: round(directInr + creditInr),
      };
    }).sort((a2, b2) => b2.revenueInr - a2.revenueInr);

    res.json({
      tokenRate: rate,
      setSharePct: setShare,
      gstPct,
      sets,
      totalRevenueInr: round(sets.reduce((s2, r) => s2 + r.revenueInr, 0)),
      totalDirectInr:  round(sets.reduce((s2, r) => s2 + r.directInr, 0)),
      totalCreditInr:  round(sets.reduce((s2, r) => s2 + r.creditInr, 0)),
    });
  } catch (err) {
    if (err.code === 'NO_RATE') return res.status(503).json({ error: err.message });
    console.error('analytics/sets error:', err);
    res.status(500).json({ error: 'Failed to load' });
  }
});

module.exports = router;