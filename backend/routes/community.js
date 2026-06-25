// backend/routes/community.js
// Community chat — fair use limits, guest token charge, message posting

const router = require('express').Router();
const pool   = require('../db/pool');
const authMid = require('../middleware/auth');

const MAX_PER_HOUR = 25;
const MAX_PER_DAY  = 50;
const GUEST_COST_PER_DAY = 2; // tokens

// Tier access order — used to check if user's tier meets post's tier_scope
const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];

function tierMeets(userTier, requiredTier) {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}

function utcHourKey() {
  const now = new Date();
  return `${now.toISOString().slice(0, 13)}`; // 'YYYY-MM-DDTHH'
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

// ─────────────────────────────────────────────
// GET /api/community/posts
// Returns recent community posts the user can see
// ─────────────────────────────────────────────

router.get('/posts', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );

    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';

    // Fetch posts this user's tier can see, newest first
    const { rows: posts } = await pool.query(
      `SELECT p.id, p.content, p.tier_scope, p.pinned, p.created_at,
              u.display_name, u.is_artist
       FROM community_posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.removed = FALSE
       ORDER BY p.pinned DESC, p.created_at DESC
       LIMIT 50`
    );

    // Filter posts to only those the user's tier can see
    const visible = posts.filter((p) => tierMeets(userTier, p.tier_scope));

    res.json({ posts: visible, userTier });
  } catch (err) {
    console.error('community/posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ─────────────────────────────────────────────
// POST /api/community/post
// Send a message to the community feed
// ─────────────────────────────────────────────

router.post('/post', authMid, async (req, res) => {
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  if (content.trim().length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get user info
    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance, is_artist FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );

    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const hourKey   = utcHourKey();
    const dayKey    = utcDayKey();
    const monthKey  = currentMonthKey();

    // ── GUEST: charge 2 tokens/day ──
    if (userTier === 'guest' && !user.is_artist) {
      // Check if already paid today
      const { rows: allotRows } = await client.query(
        `SELECT community_chat_paid_date FROM monthly_allotments
         WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );

      const paidDate = allotRows[0]?.community_chat_paid_date;
      const todayStr = dayKey;
      const alreadyPaid = paidDate && paidDate.toISOString().slice(0, 10) === todayStr;

      if (!alreadyPaid) {
        if (user.coin_balance < GUEST_COST_PER_DAY) {
          await client.query('ROLLBACK');
          return res.status(402).json({
            error: 'INSUFFICIENT_TOKENS',
            message: `Community chat costs ${GUEST_COST_PER_DAY} tokens/day for guests.`,
            required:  GUEST_COST_PER_DAY,
            available: user.coin_balance,
          });
        }

        // Deduct tokens
        await client.query(
          `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
          [GUEST_COST_PER_DAY, req.user.userId]
        );

        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
           VALUES ($1, 'community_chat_charge', 'debit', $2, 'Community chat — guest daily access')`,
          [req.user.userId, GUEST_COST_PER_DAY]
        );

        // Record payment date
        await client.query(
          `INSERT INTO monthly_allotments (user_id, month_key, community_chat_paid_date)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, month_key)
           DO UPDATE SET community_chat_paid_date = $3`,
          [req.user.userId, monthKey, now]
        );
      }
    }

    // ── FAIR USE: check hourly and daily limits ──
    const { rows: usageRows } = await client.query(
      `SELECT messages_this_hour, messages_today
       FROM community_chat_usage
       WHERE user_id = $1 AND hour_key = $2`,
      [req.user.userId, hourKey]
    );

    const usage = usageRows[0];

    if (usage) {
      if (usage.messages_this_hour >= MAX_PER_HOUR) {
        await client.query('ROLLBACK');
        return res.status(429).json({
          error: 'RATE_LIMIT_HOUR',
          message: `Fair use limit: max ${MAX_PER_HOUR} messages per hour.`,
        });
      }
      if (usage.messages_today >= MAX_PER_DAY) {
        await client.query('ROLLBACK');
        return res.status(429).json({
          error: 'RATE_LIMIT_DAY',
          message: `Fair use limit: max ${MAX_PER_DAY} messages per day.`,
        });
      }
    }

    // ── POST THE MESSAGE ──
    const tierScope = user.is_artist ? 'community' : userTier; // artist posts visible to all
    const { rows: postRows } = await client.query(
      `INSERT INTO community_posts (user_id, tier_scope, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, tier_scope, pinned, created_at`,
      [req.user.userId, tierScope, content.trim()]
    );

    // ── UPDATE FAIR USE COUNTERS ──
    await client.query(
      `INSERT INTO community_chat_usage (user_id, hour_key, day_key, messages_this_hour, messages_today)
       VALUES ($1, $2, $3, 1, 1)
       ON CONFLICT (user_id, hour_key)
       DO UPDATE SET
         messages_this_hour = community_chat_usage.messages_this_hour + 1,
         messages_today = community_chat_usage.messages_today + 1`,
      [req.user.userId, hourKey, dayKey]
    );

    await client.query('COMMIT');

    res.json({
      ok:   true,
      post: postRows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('community/post error:', err);
    res.status(500).json({ error: 'Failed to post message' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// GET /api/community/chat-status
// Returns user's current chat limits + whether guest needs to pay today
// ─────────────────────────────────────────────

router.get('/chat-status', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, coin_balance, is_artist FROM users WHERE id = $1`,
      [req.user.userId]
    );

    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const hourKey   = utcHourKey();
    const dayKey    = utcDayKey();
    const monthKey  = currentMonthKey();

    const { rows: usageRows } = await pool.query(
      `SELECT messages_this_hour, messages_today FROM community_chat_usage
       WHERE user_id = $1 AND hour_key = $2`,
      [req.user.userId, hourKey]
    );

    const usage = usageRows[0] || { messages_this_hour: 0, messages_today: 0 };

    let guestPaidToday = false;
    if (userTier === 'guest') {
      const { rows: allotRows } = await pool.query(
        `SELECT community_chat_paid_date FROM monthly_allotments
         WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      const paidDate = allotRows[0]?.community_chat_paid_date;
      guestPaidToday = paidDate && paidDate.toISOString().slice(0, 10) === dayKey;
    }

    res.json({
      userTier,
      isArtist:          user.is_artist,
      messagesThisHour:  usage.messages_this_hour,
      messagesToday:     usage.messages_today,
      maxPerHour:        MAX_PER_HOUR,
      maxPerDay:         MAX_PER_DAY,
      guestCostPerDay:   GUEST_COST_PER_DAY,
      guestPaidToday,
      canPost:           usage.messages_this_hour < MAX_PER_HOUR && usage.messages_today < MAX_PER_DAY,
    });
  } catch (err) {
    console.error('community/chat-status error:', err);
    res.status(500).json({ error: 'Failed to load chat status' });
  }
});

module.exports = router;