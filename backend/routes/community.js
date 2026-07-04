// backend/routes/community.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');

const TOKENS_PER_MESSAGE_BLOCK = 1; // 1 token buys 3 extra community messages
const MESSAGES_PER_BLOCK       = 3;
const FREE_DAILY_MESSAGES      = 1; // every fan gets 1 free community message per day

// ── Helper: post a system message ────────────────────────────────────────────
async function postSystemMessage(content) {
  try {
    const artistId = process.env.ARTIST_USER_ID;
    await pool.query(
      `INSERT INTO community_posts (user_id, content, is_system, pinned)
       VALUES ($1, $2, TRUE, FALSE)`,
      [artistId, content]
    );
  } catch (err) {
    console.error('postSystemMessage error:', err.message);
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// GET /api/community/posts
// ─────────────────────────────────────────────

router.get('/posts', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cp.id, cp.content, cp.pinned, cp.is_system, cp.created_at,
              u.id AS user_id, u.display_name, u.email, u.is_artist, u.tier
       FROM community_posts cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.removed = FALSE
       ORDER BY cp.pinned DESC, cp.created_at ASC
       LIMIT 200`
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error('community/posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/status
// Tells the fan how many free/paid messages they have left today, plus background
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows: bgRows } = await pool.query(
      `SELECT value FROM platform_config WHERE key = 'community_chat_bg'`
    );
    const communityBg = bgRows[0]?.value || '';

    if (req.user.isArtist) {
      return res.json({ isArtist: true, unlimited: true, communityBg });
    }

    const { rows: userRows } = await pool.query(
      `SELECT community_message_credits, tier, membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = userRows[0];
    const now  = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    const { rows: usageRows } = await pool.query(
      `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2`,
      [req.user.userId, todayKey()]
    );
    const usedToday = usageRows[0]?.posts_used || 0;
    const freeRemaining = Math.max(0, FREE_DAILY_MESSAGES - usedToday);

    res.json({
      isArtist:       false,
      isMember:       isActive,
      freeRemaining,
      freeDailyLimit: FREE_DAILY_MESSAGES,
      messageCredits: user.community_message_credits,
      messagesPerTokenBlock: MESSAGES_PER_BLOCK,
      communityBg,
    });
  } catch (err) {
    console.error('community/status error:', err);
    res.status(500).json({ error: 'Failed to load community status' });
  }
});

// ─────────────────────────────────────────────
// POST /api/community/post
// ─────────────────────────────────────────────

router.post('/post', authMid, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  if (content.length > 1000) return res.status(400).json({ error: 'Post too long (max 1000 characters)' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!req.user.isArtist) {
      const day = todayKey();

      const { rows: usageRows } = await client.query(
        `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2 FOR UPDATE`,
        [req.user.userId, day]
      );
      const usedToday = usageRows[0]?.posts_used || 0;

      if (usedToday < FREE_DAILY_MESSAGES) {
        await client.query(
          `INSERT INTO community_daily_usage (user_id, day_key, posts_used)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, day_key)
           DO UPDATE SET posts_used = community_daily_usage.posts_used + 1`,
          [req.user.userId, day]
        );
      } else {
        const { rows: userRows } = await client.query(
          `SELECT community_message_credits FROM users WHERE id = $1 FOR UPDATE`,
          [req.user.userId]
        );
        const credits = userRows[0]?.community_message_credits || 0;

        if (credits < 1) {
          await client.query('ROLLBACK');
          return res.status(429).json({
            error:   'NO_MESSAGES_LEFT',
            message: `You've used today's free community message. Buy more messages with tokens, or come back tomorrow.`,
          });
        }

        await client.query(
          `UPDATE users SET community_message_credits = community_message_credits - 1 WHERE id = $1`,
          [req.user.userId]
        );
        await client.query(
          `INSERT INTO community_daily_usage (user_id, day_key, posts_used)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, day_key)
           DO UPDATE SET posts_used = community_daily_usage.posts_used + 1`,
          [req.user.userId, day]
        );
      }
    }

    const { rows } = await client.query(
      `INSERT INTO community_posts (user_id, content, is_system)
       VALUES ($1, $2, FALSE) RETURNING *`,
      [req.user.userId, content.trim()]
    );

    await client.query('COMMIT');

    res.json({ ok: true, post: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('community/post error:', err);
    res.status(500).json({ error: 'Failed to post' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/community/buy-credits
// 1 token = 3 extra community messages, credits never expire
// ─────────────────────────────────────────────

router.post('/buy-credits', authMid, async (req, res) => {
  const { tokens } = req.body;
  const amount = parseInt(tokens);

  if (!amount || amount < 1) return res.status(400).json({ error: 'Token amount is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = userRows[0];

    if (user.coin_balance < amount) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `This costs ${amount} tokens. You have ${user.coin_balance}.`,
        required:  amount,
        available: user.coin_balance,
        shortBy:   amount - user.coin_balance,
      });
    }

    const creditsToAdd = amount * MESSAGES_PER_BLOCK;

    await client.query(
      `UPDATE users SET
         coin_balance               = coin_balance - $1,
         community_message_credits  = community_message_credits + $2
       WHERE id = $3`,
      [amount, creditsToAdd, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'community_credits', 'debit', $2, $3)`,
      [req.user.userId, amount, `Bought ${creditsToAdd} community messages`]
    );

    await client.query('COMMIT');

    res.json({
      ok:            true,
      creditsAdded:  creditsToAdd,
      tokensSpent:   amount,
      message:       `${creditsToAdd} community messages added to your account.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('community/buy-credits error:', err);
    res.status(500).json({ error: 'Failed to buy message credits' });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.postSystemMessage = postSystemMessage;