// backend/routes/community.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { getConfigNumber, getGuestMultiplier } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { getLocalDateStr } = require('../lib/time');

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
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows: bgRows } = await pool.query(
      `SELECT value FROM platform_config WHERE key = 'community_chat_bg'`
    );
    const communityBg = bgRows[0]?.value || '';

    const [freeDailyLimit, messagesPerBlock] = await Promise.all([
      getConfigNumber('community_daily_free_messages'),
      getConfigNumber('community_messages_per_credit_block'),
    ]);

    if (req.user.isArtist) {
      return res.json({ isArtist: true, unlimited: true, communityBg });
    }

    const { rows: userRows } = await pool.query(
      `SELECT community_message_credits, tier, membership_expires_at, timezone FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = userRows[0];
    const now  = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;

    const { rows: usageRows } = await pool.query(
      `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2`,
      [req.user.userId, getLocalDateStr(user.timezone)]
    );
    const usedToday = usageRows[0]?.posts_used || 0;
    const freeRemaining = Math.max(0, freeDailyLimit - usedToday);

    res.json({
      isArtist:       false,
      isMember:       isActive,
      freeRemaining,
      freeDailyLimit,
      messageCredits: user.community_message_credits,
      messagesPerTokenBlock: messagesPerBlock,
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

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!req.user.isArtist) {
      const { rows: tzRows } = await client.query(`SELECT timezone FROM users WHERE id = $1`, [req.user.userId]);
      const freeDailyLimit = await getConfigNumber('community_daily_free_messages');
      const day = getLocalDateStr(tzRows[0]?.timezone);

      const { rows: usageRows } = await client.query(
        `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2 FOR UPDATE`,
        [req.user.userId, day]
      );
      const usedToday = usageRows[0]?.posts_used || 0;

      if (usedToday < freeDailyLimit) {
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
// ─────────────────────────────────────────────

router.post('/buy-credits', authMid, async (req, res) => {
  const { tokens } = req.body;
  const amount = parseInt(tokens);

  if (!amount || amount < 1) return res.status(400).json({ error: 'Token amount is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: statusRows } = await client.query(
      `SELECT membership_expires_at FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const isGuest = !statusRows[0]?.membership_expires_at || new Date(statusRows[0].membership_expires_at) <= new Date();

    const [messagesPerBlock, guestMultiplier] = await Promise.all([
      getConfigNumber('community_messages_per_credit_block'),
      isGuest ? getGuestMultiplier() : 1,
    ]);

    const { rows: userRows } = await client.query(
      `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user = userRows[0];

    const actualCost = isGuest ? Math.round(amount * guestMultiplier) : amount;

    if (user.coin_balance < actualCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error:     'INSUFFICIENT_TOKENS',
        message:   `This costs ${actualCost} tokens. You have ${user.coin_balance}.`,
        required:  actualCost,
        available: user.coin_balance,
        shortBy:   actualCost - user.coin_balance,
      });
    }

    const creditsToAdd = amount * messagesPerBlock;

    await client.query(
      `UPDATE users SET
         coin_balance               = coin_balance - $1,
         community_message_credits  = community_message_credits + $2
       WHERE id = $3`,
      [actualCost, creditsToAdd, req.user.userId]
    );

    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'community_credits', 'debit', $2, $3)`,
      [req.user.userId, actualCost, `Bought ${creditsToAdd} community messages${isGuest ? ' (guest rate)' : ''}`]
    );

    await client.query('COMMIT');

    res.json({
      ok:            true,
      creditsAdded:  creditsToAdd,
      tokensSpent:   actualCost,
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

// ─────────────────────────────────────────────
// POST /api/community/report
// ─────────────────────────────────────────────

router.post('/report', authMid, async (req, res) => {
  const { postId, reason } = req.body;
  if (!postId) return res.status(400).json({ error: 'postId is required' });

  try {
    const { rows: postRows } = await pool.query(
      `SELECT id, user_id FROM community_posts WHERE id = $1`,
      [postId]
    );
    if (!postRows.length) return res.status(404).json({ error: 'Post not found' });
    if (postRows[0].user_id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot report your own post' });
    }

    await pool.query(
      `INSERT INTO content_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3)`,
      [postId, req.user.userId, reason?.trim() || null]
    );

    res.json({ ok: true, message: 'Thank you — Jinal will review this.' });
  } catch (err) {
    console.error('community/report error:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

module.exports = router;
module.exports.postSystemMessage = postSystemMessage;