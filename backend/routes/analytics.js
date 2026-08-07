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
       SELECT s.id, s.title, s.price_coins,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id) AS photographer,
              COALESCE(u.unlocks, 0)          AS unlocks,
              COALESCE(u.credit_unlocks, 0)   AS credit_unlocks,
              u.credit_by_tier,
              COALESCE(sp.purchased_tokens,0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)   AS gifted_tokens
       FROM sets s
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

// Every set opening, newest first. Unlocks and free-set views in one list,
// because what Jinal wants to know is who looked at what — whether a token
// changed hands is a detail of that, not a separate question.
router.get('/activity', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT g.granted_at   AS at,
                u.display_name, u.email, u.tier,
                s.title        AS set_title,
                s.is_vault,
                g.scope,
                COALESCE(g.coins_paid, 0)   AS tokens,
                COALESCE(l.from_purchased, 0) AS purchased_tokens,
                COALESCE(l.from_gifted, 0)    AS gifted_tokens,
                CASE WHEN COALESCE(g.coins_paid, 0) = 0 THEN 'membership' ELSE 'tokens' END AS how
         FROM access_grants g
         JOIN users u ON u.id = g.user_id
         JOIN sets  s ON s.id = g.set_id
         LEFT JOIN LATERAL (
           SELECT from_purchased, from_gifted FROM coin_ledger
           WHERE user_id = g.user_id AND related_id = g.set_id
             AND type = 'content_unlock' AND direction = 'debit'
           ORDER BY abs(EXTRACT(EPOCH FROM (created_at - g.granted_at))) ASC
           LIMIT 1
         ) l ON COALESCE(g.coins_paid, 0) > 0
         WHERE u.is_test = FALSE

         UNION ALL

         -- Views only where there is no unlock for that fan and set, so a set
         -- that was opened and then unlocked appears once, as the unlock.
         SELECT v.first_seen AS at,
                u.display_name, u.email, u.tier,
                s.title, s.is_vault,
                NULL AS scope, 0 AS tokens, 0 AS purchased_tokens, 0 AS gifted_tokens, 'free' AS how
         FROM set_views v
         JOIN users u ON u.id = v.user_id
         JOIN sets  s ON s.id = v.set_id
         WHERE u.is_test = FALSE
           AND NOT EXISTS (
             SELECT 1 FROM access_grants g2
             WHERE g2.user_id = v.user_id AND g2.set_id = v.set_id
           )
       ) x
       ORDER BY at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: totals } = await pool.query(
      `SELECT
         (SELECT count(*) FROM access_grants g JOIN users u ON u.id = g.user_id WHERE u.is_test = FALSE) AS unlocks,
         (SELECT count(*) FROM set_views v JOIN users u ON u.id = v.user_id WHERE u.is_test = FALSE)     AS views,
         (SELECT COALESCE(SUM(l.from_purchased), 0) FROM coin_ledger l JOIN users u ON u.id = l.user_id
          WHERE l.type = 'content_unlock' AND l.direction = 'debit' AND u.is_test = FALSE)               AS purchased,
         (SELECT COALESCE(SUM(l.from_gifted), 0) FROM coin_ledger l JOIN users u ON u.id = l.user_id
          WHERE l.type = 'content_unlock' AND l.direction = 'debit' AND u.is_test = FALSE)               AS gifted`
    );

    res.json({
      rows: rows.map((r) => ({
        at: r.at,
        who: r.display_name || r.email,
        tier: r.tier,
        setTitle: r.set_title,
        isVault: r.is_vault,
        scope: r.scope,
        tokens: Number(r.tokens),
        purchasedTokens: Number(r.purchased_tokens),
        giftedTokens: Number(r.gifted_tokens),
        how: r.how,
      })),
      totalUnlocks: Number(totals[0].unlocks),
      totalViews:   Number(totals[0].views),
      totalPurchasedTokens: Number(totals[0].purchased),
      totalGiftedTokens:    Number(totals[0].gifted),
      hasMore: rows.length === limit,
    });
  } catch (err) {
    console.error('analytics/activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// Everything a member has done, in one stream.
//
// Set unlocks, calls, messages, memberships, purchases -- these all existed in
// their own screens, which meant knowing what had happened required visiting
// five places and remembering what each looked like last time. One list,
// newest first, is the difference between checking in and preparing to.
router.get('/member-activity', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT g.granted_at AS at, 'unlock' AS kind,
                u.display_name, u.email, u.tier,
                s.title AS detail,
                COALESCE(g.coins_paid, 0) AS tokens,
                g.scope AS extra
         FROM access_grants g
         JOIN users u ON u.id = g.user_id
         JOIN sets  s ON s.id = g.set_id
         WHERE u.is_test = FALSE

         UNION ALL
         SELECT m.created_at, 'message',
                u.display_name, u.email, u.tier,
                LEFT(m.content, 60), COALESCE(m.tokens_charged, 0), NULL
         FROM direct_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE u.is_test = FALSE AND u.is_artist = FALSE

         UNION ALL
         SELECT cr.created_at, 'call',
                u.display_name, u.email, u.tier,
                cr.call_type, COALESCE(cr.coins_charged, 0), cr.status
         FROM call_requests cr
         JOIN users u ON u.id = cr.user_id
         WHERE u.is_test = FALSE

         UNION ALL
         SELECT l.created_at, 'membership',
                u.display_name, u.email, u.tier,
                l.label, l.amount, NULL
         FROM coin_ledger l
         JOIN users u ON u.id = l.user_id
         WHERE u.is_test = FALSE AND l.direction = 'debit'
           AND l.type IN ('membership_purchase','membership_upgrade','membership_extend')

         UNION ALL
         SELECT l.created_at, 'recharge',
                u.display_name, u.email, u.tier,
                l.label, l.amount, l.payment_amount_inr::text
         FROM coin_ledger l
         JOIN users u ON u.id = l.user_id
         WHERE u.is_test = FALSE AND l.type = 'recharge' AND l.direction = 'credit'

         UNION ALL
         SELECT r.created_at, 'request',
                u.display_name, u.email, u.tier,
                COALESCE(r.type, LEFT(r.details, 60)), COALESCE(r.coins_charged, 0), r.status
         FROM custom_requests r
         JOIN users u ON u.id = r.user_id
         WHERE u.is_test = FALSE
       ) x
       ORDER BY at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      rows: rows.map((r) => ({
        at: r.at,
        kind: r.kind,
        who: r.display_name || r.email,
        tier: r.tier,
        detail: r.detail,
        tokens: Number(r.tokens) || 0,
        extra: r.extra,
      })),
      hasMore: rows.length === limit,
    });
  } catch (err) {
    console.error('analytics/member-activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// The money position, in the four figures that actually matter.
//
// Revenue alone does not tell you what you keep: GST collected is the
// government's and has to be set aside, the IGST on exports paid in rupees
// comes back as a refund, and a zero-rated export carries no tax at all. Those
// are three different kinds of money inside one total, and reading them as one
// number is how a tax bill becomes a surprise.
router.get('/money', async (req, res) => {
  try {
    const [totals, byMonth, donations] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(i.amount_inr_equivalent), 0)                                     AS collected,
           COALESCE(SUM(i.taxable_amount_inr), 0)                                   AS taxable,
           COALESCE(SUM(i.gst_amount_inr), 0)                                       AS gst_collected,
           COALESCE(SUM(i.gst_amount_inr) FILTER (WHERE i.export_with_tax), 0)      AS gst_refundable,
           COALESCE(SUM(i.amount_inr_equivalent) FILTER (WHERE i.is_export), 0)          AS zero_rated,
           COUNT(*)                                                                 AS invoices,
           COUNT(*) FILTER (WHERE i.is_export)                                      AS export_count,
           COUNT(*) FILTER (WHERE i.export_with_tax)                                AS export_with_tax_count
         FROM invoices i
         JOIN users u ON u.id = i.user_id
         WHERE u.is_test = FALSE`
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', i.issued_at), 'YYYY-MM')            AS month,
                COALESCE(SUM(i.amount_inr_equivalent), 0)                            AS collected,
                COALESCE(SUM(i.gst_amount_inr), 0)                              AS gst,
                COALESCE(SUM(i.gst_amount_inr) FILTER (WHERE i.export_with_tax), 0) AS refundable,
                COALESCE(SUM(i.amount_inr_equivalent) FILTER (WHERE i.is_export), 0) AS zero_rated
         FROM invoices i
         JOIN users u ON u.id = i.user_id
         WHERE u.is_test = FALSE
         GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
      ),
      // Outfit sales carry a share pledged to charity. Collected as part of the
      // sale but not income — money passing through rather than in. Held on the
      // item as a percentage of what it sold for, and settled when Jinal
      // records the transfer.
      pool.query(
        `SELECT COALESCE(SUM(m.sold_price_coins * m.csr_pct / 100.0), 0) AS pledged_tokens,
                COALESCE(SUM(m.sold_price_coins * m.csr_pct / 100.0)
                         FILTER (WHERE m.donation_confirmed_at IS NOT NULL), 0) AS settled_tokens,
                COUNT(*) AS sales
         FROM merchandise m
         WHERE m.is_auction_item = TRUE AND m.auction_status = 'sold'
           AND m.csr_pct IS NOT NULL AND m.sold_price_coins IS NOT NULL`
      ),
    ]);

    const t = totals.rows[0];
    const d = donations.rows[0];
    const n = (v) => Math.round((Number(v) || 0) * 100) / 100;

    const { rows: rateRows } = await pool.query(
      `SELECT value FROM platform_config WHERE key = 'token_rate_inr'`
    );
    const tokenRate = parseFloat(rateRows[0]?.value) || 0;
    const pledged = Number(d.pledged_tokens) * tokenRate;
    const settled = Number(d.settled_tokens) * tokenRate;

    res.json({
      collected:     n(t.collected),
      taxableValue:  n(t.taxable),
      gstCollected:  n(t.gst_collected),
      gstRefundable: n(t.gst_refundable),
      zeroRated:     n(t.zero_rated),
      // Everything collected, less all the GST. The refundable portion is NOT
      // added back: it has to be claimed, the claim has to be approved, and
      // until the money arrives it is the government's. Counting it as earnings
      // would overstate what is available by exactly the amount most likely to
      // be spent before it lands.
      netOfTax:      n(Number(t.collected) - Number(t.gst_collected)),
      invoices:      Number(t.invoices),
      exportCount:   Number(t.export_count),
      exportWithTaxCount: Number(t.export_with_tax_count),
      donations: {
        pledged: n(pledged), settled: n(settled),
        outstanding: n(pledged - settled),
        sales: Number(d.sales),
      },
      byMonth: byMonth.rows.map((r) => ({
        month: r.month, collected: n(r.collected), gst: n(r.gst),
        refundable: n(r.refundable), zeroRated: n(r.zero_rated),
      })),
    });
  } catch (err) {
    console.error('analytics/money error:', err);
    res.status(500).json({ error: 'Failed to load the money position' });
  }
});

module.exports = router;