// backend/routes/analytics.js
// Studio analytics — revenue, engagement, demographics, all in one place
// Every section is wrapped independently so one bad query doesn't break the whole dashboard

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');

router.use(authMid, artistOnly);

const STREAM_LABELS = {
  membership_purchase: 'Memberships',
  membership_upgrade:  'Memberships',
  membership_extend:   'Memberships',
  call_charge:         'Calls',
  content_unlock:      'Gallery Unlocks',
  merch_purchase:      'Merchandise',
  custom_request:      'Extras',
  community_credits:   'Community Credits',
};

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error('analytics section error:', err.message);
    return fallback;
  }
}

// Period start dates for WTD/MTD/YTD/All-time bucketing
function getPeriodBounds() {
  const now = new Date();
  const wtd = new Date(now);
  const dayOfWeek = (wtd.getDay() + 6) % 7; // Monday = 0
  wtd.setDate(wtd.getDate() - dayOfWeek);
  wtd.setHours(0, 0, 0, 0);

  const mtd = new Date(now.getFullYear(), now.getMonth(), 1);
  const ytd = new Date(now.getFullYear(), 0, 1);

  return { wtd, mtd, ytd, allTime: new Date(0) };
}

async function topFansByRevenueSince(sinceDate) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.tier, SUM(cl.payment_amount_inr) AS total_inr
     FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
     WHERE cl.type = 'recharge' AND cl.created_at >= $1
     GROUP BY u.id, u.email, u.display_name, u.tier ORDER BY total_inr DESC LIMIT 10`,
    [sinceDate]
  );
  return rows.map((r) => ({ email: r.email, name: r.display_name, tier: r.tier, totalInr: parseFloat(r.total_inr) }));
}

async function topFansByActivitySince(sinceDate) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.tier, SUM(cl.amount) AS total_tokens
     FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
     WHERE cl.direction = 'debit' AND cl.created_at >= $1
     GROUP BY u.id, u.email, u.display_name, u.tier ORDER BY total_tokens DESC LIMIT 10`,
    [sinceDate]
  );
  return rows.map((r) => ({ email: r.email, name: r.display_name, tier: r.tier, totalTokens: parseInt(r.total_tokens) }));
}

router.get('/', async (req, res) => {
  const bounds = getPeriodBounds();

  const [
    revenueOverview,
    revenueTrend,
    tokenUtilization,
    streamBreakdown,
    topFansByRevenue,
    topFansByActivity,
    membershipBreakdown,
    newMembersTrend,
    galleryStats,
    communityStats,
    callStats,
    requestStats,
    dmStats,
    demographics,
    signupTrend,
    tokenRate,
  ] = await Promise.all([

    // ── REAL REVENUE (INR actually collected via recharge) ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(payment_amount_inr),0) AS total_revenue_inr, COUNT(*) AS total_recharges
         FROM coin_ledger WHERE type = 'recharge'`
      );
      const { rows: thisMonth } = await pool.query(
        `SELECT COALESCE(SUM(payment_amount_inr),0) AS revenue FROM coin_ledger
         WHERE type = 'recharge' AND date_trunc('month', created_at) = date_trunc('month', NOW())`
      );
      const { rows: lastMonth } = await pool.query(
        `SELECT COALESCE(SUM(payment_amount_inr),0) AS revenue FROM coin_ledger
         WHERE type = 'recharge' AND date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month')`
      );
      return {
        totalRevenueInr:   parseFloat(rows[0].total_revenue_inr),
        totalRecharges:    parseInt(rows[0].total_recharges),
        thisMonthRevenue:  parseFloat(thisMonth[0].revenue),
        lastMonthRevenue:  parseFloat(lastMonth[0].revenue),
      };
    }, { totalRevenueInr: 0, totalRecharges: 0, thisMonthRevenue: 0, lastMonthRevenue: 0 }),

    // ── 30-DAY REVENUE TREND ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, SUM(payment_amount_inr) AS revenue
         FROM coin_ledger WHERE type = 'recharge' AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day ASC`
      );
      return rows.map((r) => ({ day: r.day, revenue: parseFloat(r.revenue) || 0 }));
    }, []),

    // ── TOKEN UTILIZATION (recharged vs spent vs idle) ──
    safe(async () => {
      const { rows: recharged } = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM coin_ledger WHERE type = 'recharge' AND direction = 'credit'`
      );
      const { rows: spent } = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM coin_ledger WHERE direction = 'debit'`
      );
      const { rows: idle } = await pool.query(
        `SELECT COALESCE(SUM(coin_balance),0) AS total FROM users WHERE is_artist = FALSE`
      );
      const totalRecharged = parseInt(recharged[0].total);
      const totalSpent     = parseInt(spent[0].total);
      return {
        totalRecharged,
        totalSpent,
        totalIdle:        parseInt(idle[0].total),
        utilizationPct:   totalRecharged > 0 ? Math.round((totalSpent / totalRecharged) * 100) : 0,
      };
    }, { totalRecharged: 0, totalSpent: 0, totalIdle: 0, utilizationPct: 0 }),

    // ── STREAM-WISE TOKEN SPEND ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT type, SUM(amount) AS tokens, COUNT(*) AS tx_count
         FROM coin_ledger WHERE direction = 'debit' GROUP BY type`
      );
      const grouped = {};
      rows.forEach((r) => {
        const label = STREAM_LABELS[r.type] || r.type;
        if (!grouped[label]) grouped[label] = { label, tokens: 0, txCount: 0 };
        grouped[label].tokens   += parseInt(r.tokens);
        grouped[label].txCount  += parseInt(r.tx_count);
      });
      return Object.values(grouped).sort((a, b) => b.tokens - a.tokens);
    }, []),

    // ── TOP FANS BY REAL SPEND (INR) — now bucketed by WTD/MTD/YTD/All-time ──
    safe(async () => {
      const [wtd, mtd, ytd, allTime] = await Promise.all([
        topFansByRevenueSince(bounds.wtd),
        topFansByRevenueSince(bounds.mtd),
        topFansByRevenueSince(bounds.ytd),
        topFansByRevenueSince(bounds.allTime),
      ]);
      return { wtd, mtd, ytd, allTime };
    }, { wtd: [], mtd: [], ytd: [], allTime: [] }),

    // ── TOP FANS BY TOKEN ACTIVITY — now bucketed by WTD/MTD/YTD/All-time ──
    safe(async () => {
      const [wtd, mtd, ytd, allTime] = await Promise.all([
        topFansByActivitySince(bounds.wtd),
        topFansByActivitySince(bounds.mtd),
        topFansByActivitySince(bounds.ytd),
        topFansByActivitySince(bounds.allTime),
      ]);
      return { wtd, mtd, ytd, allTime };
    }, { wtd: [], mtd: [], ytd: [], allTime: [] }),

    // ── MEMBERSHIP TIER BREAKDOWN ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT tier, COUNT(*) AS count FROM users
         WHERE is_artist = FALSE AND membership_expires_at > NOW() GROUP BY tier`
      );
      const { rows: guestRows } = await pool.query(
        `SELECT COUNT(*) AS count FROM users
         WHERE is_artist = FALSE AND (membership_expires_at IS NULL OR membership_expires_at <= NOW())`
      );
      return {
        tiers: rows.map((r) => ({ tier: r.tier, count: parseInt(r.count) })),
        guests: parseInt(guestRows[0].count),
      };
    }, { tiers: [], guests: 0 }),

    // ── NEW MEMBERS THIS MONTH VS LAST ──
    safe(async () => {
      const { rows: thisMonth } = await pool.query(
        `SELECT COUNT(*) AS count FROM users WHERE is_artist = FALSE AND date_trunc('month', created_at) = date_trunc('month', NOW())`
      );
      const { rows: lastMonth } = await pool.query(
        `SELECT COUNT(*) AS count FROM users WHERE is_artist = FALSE AND date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month')`
      );
      return { thisMonth: parseInt(thisMonth[0].count), lastMonth: parseInt(lastMonth[0].count) };
    }, { thisMonth: 0, lastMonth: 0 }),

    // ── GALLERY ENGAGEMENT ──
    safe(async () => {
      const { rows: totals } = await pool.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE granted_at > NOW() - INTERVAL '30 days') AS last_30
         FROM access_grants`
      );
      const { rows: top } = await pool.query(
        `SELECT s.title, COUNT(*) AS unlocks FROM access_grants ag
         JOIN sets s ON s.id = ag.set_id
         GROUP BY s.id, s.title ORDER BY unlocks DESC LIMIT 1`
      );
      return {
        totalUnlocks:  parseInt(totals[0].total),
        last30Days:    parseInt(totals[0].last_30),
        topSet:        top[0] ? { title: top[0].title, unlocks: parseInt(top[0].unlocks) } : null,
      };
    }, { totalUnlocks: 0, last30Days: 0, topSet: null }),

    // ── COMMUNITY ENGAGEMENT ──
    safe(async () => {
      const { rows: totals } = await pool.query(
        `SELECT COUNT(*) AS total FROM community_posts WHERE removed = FALSE AND is_system = FALSE`
      );
      const { rows: top } = await pool.query(
        `SELECT u.display_name, u.email, COUNT(*) AS posts FROM community_posts cp
         JOIN users u ON u.id = cp.user_id
         WHERE cp.removed = FALSE AND cp.is_system = FALSE AND u.is_artist = FALSE
         GROUP BY u.id, u.display_name, u.email ORDER BY posts DESC LIMIT 1`
      );
      return {
        totalPosts:     parseInt(totals[0].total),
        mostActiveFan:  top[0] ? { name: top[0].display_name || top[0].email, posts: parseInt(top[0].posts) } : null,
      };
    }, { totalPosts: 0, mostActiveFan: null }),

    // ── CALLS ──
    safe(async () => {
      const { rows } = await pool.query(`SELECT status, COUNT(*) AS count FROM call_requests GROUP BY status`);
      return rows.map((r) => ({ status: r.status, count: parseInt(r.count) }));
    }, []),

    // ── EXTRAS REQUESTS ──
    safe(async () => {
      const { rows } = await pool.query(`SELECT status, COUNT(*) AS count FROM custom_requests GROUP BY status`);
      return rows.map((r) => ({ status: r.status, count: parseInt(r.count) }));
    }, []),

    // ── DIRECT MESSAGE VOLUME (best-effort — table shape unconfirmed) ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last_30
         FROM direct_messages`
      );
      return { total: parseInt(rows[0].total), last30Days: parseInt(rows[0].last_30) };
    }, { total: null, last30Days: null }),

    // ── AGE DEMOGRAPHICS ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT
           CASE
             WHEN AGE(dob) < INTERVAL '25 years' THEN '18-24'
             WHEN AGE(dob) < INTERVAL '35 years' THEN '25-34'
             WHEN AGE(dob) < INTERVAL '45 years' THEN '35-44'
             WHEN AGE(dob) < INTERVAL '55 years' THEN '45-54'
             ELSE '55+'
           END AS bracket,
           COUNT(*) AS count
         FROM users WHERE is_artist = FALSE
         GROUP BY bracket`
      );
      return rows.map((r) => ({ bracket: r.bracket, count: parseInt(r.count) }));
    }, []),

    // ── SIGNUP TREND (last 6 months) ──
    safe(async () => {
      const { rows } = await pool.query(
        `SELECT to_char(date_trunc('month', created_at), 'Mon YYYY') AS month, COUNT(*) AS count
         FROM users WHERE is_artist = FALSE AND created_at > NOW() - INTERVAL '6 months'
         GROUP BY date_trunc('month', created_at), month ORDER BY date_trunc('month', created_at) ASC`
      );
      return rows.map((r) => ({ month: r.month, count: parseInt(r.count) }));
    }, []),

    // ── TOKEN RATE (for GST estimate) ──
    safe(async () => {
      const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'token_rate_inr'`);
      return rows[0] ? parseFloat(rows[0].value) : 66;
    }, 66),
  ]);

  const gstRateAssumed = 18;
  const estimatedGstCollected = Math.round(revenueOverview.totalRevenueInr * gstRateAssumed / (100 + gstRateAssumed));

  res.json({
    revenueOverview,
    revenueTrend,
    tokenUtilization,
    streamBreakdown,
    topFansByRevenue,
    topFansByActivity,
    membershipBreakdown,
    newMembersTrend,
    galleryStats,
    communityStats,
    callStats,
    requestStats,
    dmStats,
    demographics,
    signupTrend,
    tokenRate,
    tax: {
      gstRateAssumed,
      estimatedGstCollected,
      note: 'Estimated assuming GST-inclusive pricing at the rate shown. Confirm the exact applicable rate and treatment with your CA before relying on this for filing.',
    },
  });
});

module.exports = router;