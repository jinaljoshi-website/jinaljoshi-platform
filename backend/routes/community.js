// backend/routes/community.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { getConfigNumber } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { getLocalDateStr } = require('../lib/time');

// Community chat is free. Members post without limit; guests get one message a
// day at no cost, as a taste of the space. Nothing here costs tokens, so the old
// message-credit system is gone entirely.

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

    if (req.user.isArtist) {
      return res.json({ isArtist: true, unlimited: true, communityBg });
    }

    const guestDailyLimit = await getConfigNumber('community_guest_daily_messages');

    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, timezone, hide_system_posts FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = userRows[0];
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();

    if (isActive) {
      return res.json({
        isArtist: false, isMember: true, unlimited: true,
        communityBg, hideSystemPosts: !!user.hide_system_posts,
      });
    }

    const { rows: usageRows } = await pool.query(
      `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2`,
      [req.user.userId, getLocalDateStr(user.timezone)]
    );
    const usedToday = usageRows[0]?.posts_used || 0;

    res.json({
      isArtist:      false,
      isMember:      false,
      unlimited:     false,
      freeRemaining: Math.max(0, guestDailyLimit - usedToday),
      freeDailyLimit: guestDailyLimit,
      communityBg,
      hideSystemPosts: !!user.hide_system_posts,
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
      const { rows: uRows } = await client.query(
        `SELECT timezone, membership_expires_at FROM users WHERE id = $1`, [req.user.userId]
      );
      const isMember = uRows[0]?.membership_expires_at && new Date(uRows[0].membership_expires_at) > new Date();
      const day = getLocalDateStr(uRows[0]?.timezone);

      // Members post freely. Guests get a daily allowance and are invited to join
      // rather than sold message credits.
      if (!isMember) {
        const guestDailyLimit = await getConfigNumber('community_guest_daily_messages');
        const { rows: usageRows } = await client.query(
          `SELECT posts_used FROM community_daily_usage WHERE user_id = $1 AND day_key = $2 FOR UPDATE`,
          [req.user.userId, day]
        );
        if ((usageRows[0]?.posts_used || 0) >= guestDailyLimit) {
          await client.query('ROLLBACK');
          return res.status(429).json({
            error:   'GUEST_DAILY_LIMIT',
            message: `Guests can post once a day here. Join any membership to post as much as you like.`,
          });
        }
      }

      await client.query(
        `INSERT INTO community_daily_usage (user_id, day_key, posts_used)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, day_key)
         DO UPDATE SET posts_used = community_daily_usage.posts_used + 1`,
        [req.user.userId, day]
      );
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

// ─────────────────────────────────────────────
// POST /api/community/preferences
// ─────────────────────────────────────────────

router.post('/preferences', authMid, async (req, res) => {
  const { hideSystemPosts } = req.body;
  try {
    await pool.query(`UPDATE users SET hide_system_posts = $1 WHERE id = $2`, [!!hideSystemPosts, req.user.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('community/preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
module.exports.postSystemMessage = postSystemMessage;