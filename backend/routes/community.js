// backend/routes/community.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');

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
module.exports.postSystemMessage = postSystemMessage;

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
// POST /api/community/post
// ─────────────────────────────────────────────

router.post('/post', authMid, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  if (content.length > 1000) return res.status(400).json({ error: 'Post too long (max 1000 characters)' });

  const artistId = process.env.ARTIST_USER_ID;

  try {
    // Fair use check (non-artist users)
    if (!req.user.isArtist) {
      const { rows: userRows } = await pool.query(
        `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`,
        [req.user.userId]
      );
      const user     = userRows[0];
      const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
      const userTier = isActive ? user.tier : 'guest';

      if (userTier === 'guest') {
        return res.status(403).json({ error: 'A membership is required to post in the community.' });
      }

      // Fair use limits per tier
      const fairUseLimits = { community: 5, insider: 10, premium: 20, supreme: 999 };
      const limit = fairUseLimits[userTier] || 5;
      const monthKey = new Date().toISOString().slice(0, 7);

      const { rows: usageRows } = await pool.query(
        `SELECT community_posts_used FROM monthly_allotments
         WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      const used = usageRows[0]?.community_posts_used || 0;

      if (used >= limit) {
        return res.status(429).json({
          error: `Fair use limit reached. You can post ${limit} times per month on ${userTier} plan.`,
        });
      }

      await pool.query(
        `INSERT INTO monthly_allotments (user_id, month_key, community_posts_used)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET community_posts_used = monthly_allotments.community_posts_used + 1`,
        [req.user.userId, monthKey]
      );
    }

    const { rows } = await pool.query(
      `INSERT INTO community_posts (user_id, content, is_system)
       VALUES ($1, $2, FALSE) RETURNING *`,
      [req.user.userId, content.trim()]
    );

    res.json({ ok: true, post: rows[0] });
  } catch (err) {
    console.error('community/post error:', err);
    res.status(500).json({ error: 'Failed to post' });
  }
});

module.exports = router;
module.exports.postSystemMessage = postSystemMessage;