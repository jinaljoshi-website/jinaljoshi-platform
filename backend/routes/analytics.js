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

// Read the same way the sets query does, rather than assumed. A rate that is
// absent means nothing can be called revenue, so it defaults to zero tax rather
// than to a guess.
async function gstRate() {
  const { rows } = await pool.query(
    `SELECT value FROM platform_config WHERE key = 'domestic_gst_rate_pct'`
  );
  return parseFloat(rows[0]?.value) || 0;
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─────────────────────────────────────────────
// PURCHASED — money in, and what it was spent on
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// GET /api/studio/analytics/orders
// ─────────────────────────────────────────────
//
// Every successful token purchase, one row each.
//
// The purchased tab summarised and then, oddly, listed what fans had spent
// tokens on — which belongs with spending, not with buying. What was missing
// was the plain thing: who bought, when, how much, and what it cost them.

// ─────────────────────────────────────────────
// GET /api/studio/analytics/traffic?site=ps&days=30
// ─────────────────────────────────────────────
//
// What the counting adds up to, for one site at a time.
//
// The two sites answer different questions and should not be added together:
// the portfolio has no accounts and nothing to buy, so its numbers are about
// reach; PS has a funnel, so its numbers are about persuasion. A single total
// across both would mean nothing.
router.get('/traffic', async (req, res) => {
  const site = req.query.site === 'portfolio' ? 'portfolio' : 'ps';
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);

  try {
    const since = `NOW() - INTERVAL '${days} days'`;
    const base  = `FROM traffic WHERE site = $1 AND at >= ${since}`;

    const [totals, byDay, pages, refs, devices, events, returning] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE event IS NULL)::int AS views,
                COUNT(*) FILTER (WHERE event IS NOT NULL)::int AS clicks,
                COUNT(DISTINCT COALESCE(user_id::text, visitor_hash))::int AS visitors,
                COUNT(DISTINCT user_id)::int AS members,
                -- How many of them did anything at all.
                --
                -- Clicks over pageviews was the wrong shape: a pageview is a
                -- page and a click is an action, one person can do several on
                -- one page, and dividing one by the other describes nothing.
                -- Over visitors it would exceed 100%, which is not a rate.
                --
                -- This is bounded and answers the question actually worth
                -- asking — did they only look, or did they do something.
                COUNT(DISTINCT COALESCE(user_id::text, visitor_hash))
                  FILTER (WHERE event IS NOT NULL)::int AS clickers
           ${base}`, [site]),
      pool.query(
        `SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day,
                COUNT(*) FILTER (WHERE event IS NULL)::int AS views,
                COUNT(DISTINCT COALESCE(user_id::text, visitor_hash))::int AS visitors
           ${base} GROUP BY 1 ORDER BY 1`, [site]),
      pool.query(
        `SELECT path, COUNT(*)::int AS views,
                COUNT(DISTINCT COALESCE(user_id::text, visitor_hash))::int AS visitors
           ${base} AND event IS NULL GROUP BY path ORDER BY 2 DESC LIMIT 20`, [site]),
      pool.query(
        `SELECT COALESCE(referrer_host, 'direct') AS source, COUNT(*)::int AS visits
           ${base} AND event IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [site]),
      pool.query(
        `SELECT device, COUNT(DISTINCT COALESCE(user_id::text, visitor_hash))::int AS visitors
           ${base} GROUP BY device ORDER BY 2 DESC`, [site]),
      pool.query(
        `SELECT event, COUNT(*)::int AS times
           ${base} AND event IS NOT NULL GROUP BY event ORDER BY 2 DESC`, [site]),
      // Somebody who came on more than one day. For a portfolio this is the
      // best signal there is — a visit can be an accident, a return cannot.
      pool.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT COALESCE(user_id::text, visitor_hash) AS who
             ${base}
            GROUP BY 1 HAVING COUNT(DISTINCT date_trunc('day', at)) > 1
         ) t`, [site]),
    ]);

    const t = totals.rows[0];
    res.json({
      site, days,
      totals: {
        views:    t.views,
        clicks:   t.clicks,
        visitors: t.visitors,
        members:  t.members,
        returning: returning.rows[0].n,
        // Two figures, because one number cannot carry both meanings.
        //
        // A share of visitors who did anything — bounded, and a real rate. And
        // an average of how much they did — which can exceed one without being
        // nonsense, because somebody can click several times.
        clickers: t.clickers,
        clickedPct: t.visitors > 0 ? Math.round((t.clickers / t.visitors) * 1000) / 10 : 0,
        clicksPerVisitor: t.visitors > 0 ? Math.round((t.clicks / t.visitors) * 10) / 10 : 0,
        returningPct: t.visitors > 0
          ? Math.round((returning.rows[0].n / t.visitors) * 1000) / 10 : 0,
      },
      byDay:   byDay.rows,
      pages:   pages.rows,
      sources: refs.rows,
      devices: devices.rows,
      events:  events.rows,
    });
  } catch (err) {
    console.error('analytics/traffic error:', err);
    res.status(500).json({ error: 'Could not load traffic' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cl.id, cl.created_at,
              cl.amount        AS tokens,
              cl.payment_amount_inr AS paid_inr,
              cl.label,
              u.display_name, u.email, u.tier,
              i.invoice_number, i.currency, i.is_export
         FROM coin_ledger cl
         JOIN users u ON u.id = cl.user_id
         LEFT JOIN invoices i ON i.coin_ledger_id = cl.id
        WHERE cl.type = 'recharge' AND cl.direction = 'credit'
          AND u.is_test = FALSE
        ORDER BY cl.created_at DESC
        LIMIT 500`
    );
    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        who: r.display_name || r.email,
        tier: r.tier,
        tokens: r.tokens,
        paidInr: r.paid_inr === null ? null : Number(r.paid_inr),
        // A bonus offer is why tokens and rupees do not divide evenly.
        label: r.label,
        invoice: r.invoice_number || null,
        currency: r.currency || 'INR',
        isExport: r.is_export || false,
      })),
    });
  } catch (err) {
    console.error('analytics/orders error:', err);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

// ─────────────────────────────────────────────
// GET /api/studio/analytics/spend
// ─────────────────────────────────────────────
//
// Where tokens went, and whose tokens they were.
//
// Grouped by what the fan was actually buying rather than by ledger type, and
// split by the pot it came from: purchased tokens are money, gifted and bonus
// ones never were. A category that looks busy on gifted tokens is a category
// nobody has paid for.
//
// Sets are broken out by route for the same reason the gallery is — the ladder
// and the exclusive portion are priced differently and behave differently, and
// one figure for both hides which is working. Media unlocked inside a chat is
// counted as media, not as chat: a fan who spends twenty tokens opening
// photographs in a message did what they would have done in the gallery, and
// filing it under chat would make per-message charges look larger than they are.
router.get('/spend', async (req, res) => {
  try {
    const gstPct = await gstRate();

    // The list rate, which is the only rate there has ever been.
    //
    // I briefly derived an effective rate from revenue divided by tokens sold
    // and got ₹56.05, and took that for a bulk discount. It was not: tokensSold
    // counts bonus tokens, which were given rather than sold, so the divisor
    // was 200 too large. There is no discount to account for — a token costs
    // ₹66 and always has.
    //
    // Bonus and gifted tokens carry no rupee figure at all. They are counted so
    // it is clear how much activity they drove, and valued at nothing because
    // nobody paid for them.
    const rate = await tokenRate();

    const { rows } = await pool.query(
      `SELECT CASE
                WHEN cl.type = 'content_unlock' AND ag.scope = 'upsell' THEN 'sets_exclusive'
                WHEN cl.type = 'content_unlock'                          THEN 'sets_ladder'
                WHEN cl.type = 'chat_media_unlock'                       THEN 'media'
                WHEN cl.type IN ('membership_purchase','membership_upgrade','membership_extend')
                                                                         THEN 'membership'
                WHEN cl.type = 'dm_charge'                               THEN 'messages'
                WHEN cl.type = 'call_charge'                             THEN 'calls'
                WHEN cl.type = 'custom_request'                          THEN 'requests'
                WHEN cl.type IN ('merch_purchase','product')             THEN 'merchandise'
                ELSE cl.type
              END AS bucket,
              COUNT(*)::int                                  AS times,
              COALESCE(SUM(cl.amount), 0)::int               AS tokens,
              COALESCE(SUM(cl.from_purchased), 0)::int       AS purchased,
              COALESCE(SUM(cl.from_gifted), 0)::int          AS gifted,
              COALESCE(SUM(cl.from_bonus), 0)::int           AS bonus
         FROM coin_ledger cl
         JOIN users u ON u.id = cl.user_id
         LEFT JOIN access_grants ag
                ON ag.user_id = cl.user_id AND ag.set_id = cl.related_id
               AND ag.coins_paid = cl.amount
        WHERE cl.direction = 'debit' AND u.is_test = FALSE
        GROUP BY 1
        ORDER BY 4 DESC`
    );

    // Refunds, netted off.
    //
    // A refund is a credit, so a token spent, refunded and spent again is two
    // debits. Summing debits alone therefore reports more spent than was ever
    // available — 1,349 purchased tokens against 1,093 that existed to spend.
    // Gross activity is real, but it is not what the money column should say.
    const { rows: refunds } = await pool.query(
      `SELECT COALESCE(SUM(cl.from_purchased), 0)::int AS purchased,
              COALESCE(SUM(cl.from_gifted), 0)::int    AS gifted,
              COALESCE(SUM(cl.from_bonus), 0)::int     AS bonus
         FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
        WHERE cl.type = 'refund' AND cl.direction = 'credit' AND u.is_test = FALSE`
    );
    const refundedPurchased = refunds[0].purchased || 0;
    const refundedGifted    = (refunds[0].gifted || 0) + (refunds[0].bonus || 0);

    const inr = (tk) => Math.round(((tk * rate) / (1 + gstPct / 100)) * 100) / 100;
    const buckets = rows.map((r) => ({
      bucket: r.bucket,
      times: r.times,
      tokens: r.tokens,
      purchasedTokens: r.purchased,
      giftedTokens: r.gifted + r.bonus,
      // Only purchased tokens were ever money, so only they become rupees.
      revenueInr: inr(r.purchased),
    }));

    const totalPurchased = Math.max(0, buckets.reduce((a, b) => a + b.purchasedTokens, 0) - refundedPurchased);
    const totalGifted    = Math.max(0, buckets.reduce((a, b) => a + b.giftedTokens, 0) - refundedGifted);

    res.json({
      buckets,
      tokenRate: rate,
      gstPct,
      totals: {
        purchasedTokens: totalPurchased,
        giftedTokens: totalGifted,
        revenueInr: inr(totalPurchased),
        refundedTokens: refundedPurchased + refundedGifted,
        // What share of everything spent was actually paid for. A number worth
        // watching: generosity that never converts is a cost, not a discount.
        purchasedSharePct: (totalPurchased + totalGifted) > 0
          ? Math.round((totalPurchased / (totalPurchased + totalGifted)) * 1000) / 10
          : 0,
      },
    });
  } catch (err) {
    console.error('analytics/spend error:', err);
    res.status(500).json({ error: 'Could not load spend' });
  }
});

router.get('/purchased', async (req, res) => {
  try {
    const rate = await tokenRate();

    const [totals, byMonth, byType, outstanding, topFans] = await Promise.all([
      // Revenue is what fans actually paid.
      //
      // The comment here used to say bulk recharges carry a discount, which is
      // why revenue and tokens-times-rate differ. They do not — a token has
      // always been ₹66. What made the two disagree was a single credit of 200
      // tokens against ₹0, left behind by a Razorpay test payment, which
      // dragged the apparent rate down to ₹56.05 and had me chasing a discount
      // that never existed.
      //
      // A credit with no payment against it was not sold, so it is not counted
      // as sold. It is still a real credit and the tokens are really in the
      // account — it simply is not a purchase.
      pool.query(
        `SELECT COALESCE(SUM(cl.payment_amount_inr), 0) AS revenue_inr,
                COALESCE(SUM(cl.amount) FILTER (
                  WHERE COALESCE(cl.payment_amount_inr, 0) > 0), 0) AS tokens_sold,
                COUNT(*) FILTER (
                  WHERE COALESCE(cl.payment_amount_inr, 0) > 0)     AS purchases
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

// What a set has earned directly: purchased tokens spent unlocking it.
//
// Membership unlocks are counted alongside, but carry no rupee figure. The fee
// behind them buys access to the platform, and that fee is the platform's — so
// deeming a share of it to be set revenue meant inventing a per-unlock value,
// which needed a monthly allowance to divide by. That allowance key was retired
// when the ladder replaced it, so the figure had quietly been zero throughout.
//
// The count is kept because how often a set is opened on a membership says
// something real about what resonates. It is simply not revenue.
router.get('/sets', async (req, res) => {
  try {
    const rate = await tokenRate();

    const { rows: cfgRows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key IN ('domestic_gst_rate_pct')`
    );
    const cfg = {};
    cfgRows.forEach((r) => { cfg[r.key] = parseFloat(r.value); });
    const gstPct = cfg.domestic_gst_rate_pct || 0;

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
       -- The same money, split by which part of the set it opened.
       --
       -- The ledger knows what was really paid; access_grants knows the route.
       -- Splitting on the grant's own coins_paid counted gifted and bonus
       -- tokens, so the parts exceeded the whole — ₹21,422 against a real
       -- ₹17,730 — and twenty-one sets disagreed with their own total.
       spend_by_scope AS (
         SELECT cl.related_id AS set_id,
                COALESCE(SUM(cl.from_purchased) FILTER (WHERE ag.scope = 'tier'), 0)::int   AS ladder_purchased,
                COALESCE(SUM(cl.from_purchased) FILTER (WHERE ag.scope = 'upsell'), 0)::int AS upsell_purchased
         FROM coin_ledger cl
         JOIN users u ON u.id = cl.user_id
         LEFT JOIN access_grants ag
                ON ag.user_id = cl.user_id
               AND ag.set_id  = cl.related_id
               AND ag.coins_paid = cl.amount
         WHERE cl.type = 'content_unlock' AND cl.direction = 'debit'
           AND cl.related_id IS NOT NULL AND u.is_test = FALSE
         GROUP BY cl.related_id
       ),
       unlocks AS (
         -- Split by how it was opened, not just how many times.
         --
         -- A set opened fifteen times on memberships and once on the ladder is
         -- a different thing from one opened once at full price, and a single
         -- count says neither. scope tells them apart: an upsell grant is the
         -- exclusive portion, a tier grant with tokens against it is a rung on
         -- the ladder, and a tier grant with none is a membership open.
         SELECT ag.set_id,
                COUNT(*)::int AS unlocks,
                COUNT(*) FILTER (WHERE COALESCE(ag.coins_paid, 0) = 0)::int  AS credit_unlocks,
                COUNT(*) FILTER (WHERE ag.scope = 'tier'
                                   AND COALESCE(ag.coins_paid, 0) > 0)::int  AS ladder_unlocks,
                COUNT(*) FILTER (WHERE ag.scope = 'upsell')::int             AS upsell_unlocks
         FROM access_grants ag
         JOIN users u ON u.id = ag.user_id
         WHERE u.is_test = FALSE GROUP BY ag.set_id
       )
       SELECT s.id, s.title, s.price_coins,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id) AS photographer,
              COALESCE(u.unlocks, 0)          AS unlocks,
              COALESCE(u.credit_unlocks, 0)   AS credit_unlocks,
              COALESCE(u.ladder_unlocks, 0)   AS ladder_unlocks,
              COALESCE(u.upsell_unlocks, 0)   AS upsell_unlocks,
              COALESCE(sc.ladder_purchased, 0) AS ladder_purchased,
              COALESCE(sc.upsell_purchased, 0) AS upsell_purchased,
              COALESCE(sp.purchased_tokens,0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)   AS gifted_tokens
       FROM sets s
       LEFT JOIN spend sp   ON sp.set_id = s.id
       LEFT JOIN unlocks u  ON u.set_id  = s.id
       LEFT JOIN spend_by_scope sc ON sc.set_id = s.id
       ORDER BY 7 DESC, s.created_at DESC`
    );

    const sets = rows.map((r) => {
      // Purchased tokens are GST-inclusive, so the tax comes out before anything
      // is called revenue.
      const directInr = (r.purchased_tokens * rate) / (1 + gstPct / 100);
      return {
        id: r.id, title: r.title, photographer: r.photographer,
        priceTokens: r.price_coins,
        unlocks: r.unlocks, creditUnlocks: r.credit_unlocks,
        // Where the money came from within the set. The ladder and the
        // exclusive portion are priced differently and behave differently, and
        // one number for both hides which of them is working.
        ladderUnlocks: r.ladder_unlocks,
        upsellUnlocks: r.upsell_unlocks,
        ladderInr: round((r.ladder_purchased * rate) / (1 + gstPct / 100)),
        upsellInr: round((r.upsell_purchased * rate) / (1 + gstPct / 100)),
        purchasedTokens: r.purchased_tokens, giftedTokens: r.gifted_tokens,
        revenueInr: round(directInr),
      };
    }).sort((a2, b2) => b2.revenueInr - a2.revenueInr);

    res.json({
      tokenRate: rate,
      gstPct,
      sets,
      totalRevenueInr: round(sets.reduce((s2, r) => s2 + r.revenueInr, 0)),
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
                s.is_collection,
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
                s.title, s.is_collection,
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
        isCollection: r.is_collection,
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