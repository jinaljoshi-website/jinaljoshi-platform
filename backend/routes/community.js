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
// Three kinds, and they are treated differently on purpose.
//
//   news      Jinal posted something. Always shown.
//   arrival   somebody joined, took a membership or upgraded. Always named —
//             this is the welcome, and a welcome without a name is not one.
//   activity  what a member did afterwards. Named only if Jinal chooses;
//             otherwise "Someone", because what a person unlocks or orders is
//             their business and announcing it by name is a different thing
//             from celebrating that they arrived.
//
// Anonymising replaces the name in the sentence rather than dropping the post,
// so the room keeps its signs of life without reporting on anybody.
async function postSystemMessage(content, { kind = 'activity', name = null } = {}) {
  try {
    const artistId = process.env.ARTIST_USER_ID;
    let text = content;

    if (kind === 'activity' && name) {
      const { rows } = await pool.query(
        `SELECT value FROM platform_config WHERE key = 'name_member_activity'`
      );
      if (rows[0]?.value === 'false') {
        text = text.split(name).join('Someone');
      }
    }

    await pool.query(
      `INSERT INTO community_posts (user_id, content, is_system, pinned, update_kind)
       VALUES ($1, $2, TRUE, FALSE, $3)`,
      [artistId, text, kind]
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
      // People only. Announcements about unlocks and purchases were mixed in
      // with the conversation, which meant a room that is meant to feel like
      // people talking read like a feed of transactions instead.
      `SELECT cp.id, cp.content, cp.pinned, cp.is_system, cp.created_at,
              u.id AS user_id, u.display_name, u.email, u.is_artist, u.tier
       FROM community_posts cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.removed = FALSE AND cp.is_system = FALSE
       ORDER BY cp.pinned DESC, cp.created_at ASC
       LIMIT 200`
    );

    // The room is Jinal's, so the background is hers to set. Fans cannot change
    // it — a shared space everyone restyles belongs to nobody.
    const { rows: cfg } = await pool.query(
      `SELECT value FROM platform_config WHERE key = 'community_background_key'`
    );
    const bg = cfg[0]?.value;

    res.json({
      posts: rows,
      backgroundUrl: bg ? (bg.startsWith('http') ? bg : `${process.env.R2_PUBLIC_URL}/${bg}`) : null,
    });
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
// What the platform has announced, kept out of the conversation and available
// underneath it. Two days deliberately — older than that and it is history
// rather than news, and the point is catching up on what was missed.
router.get('/updates', authMid, async (req, res) => {
  try {
    // 48 hours unless asked for more, capped at a month.
    const hours = Math.min(parseInt(req.query.hours, 10) || 48, 720);
    const { rows } = await pool.query(
      // Two days by default. Older is available on request up to a month —
      // beyond that it is history rather than catching up, and nobody scrolls
      // a month of announcements.
      `SELECT id, content, created_at, COALESCE(update_kind, 'member') AS kind
       FROM community_posts
       WHERE is_system = TRUE AND removed = FALSE
         AND created_at > NOW() - ($1 || ' hours')::interval
       ORDER BY created_at DESC
       LIMIT 200`,
      [String(hours)]
    );

    const { rows: older } = await pool.query(
      `SELECT count(*)::int AS n FROM community_posts
       WHERE is_system = TRUE AND removed = FALSE
         AND created_at <= NOW() - ($1 || ' hours')::interval
         AND created_at > NOW() - INTERVAL '30 days'`,
      [String(hours)]
    );

    res.json({
      updates: rows,
      hours,
      olderAvailable: hours < 720 ? older[0].n : 0,
    });
  } catch (err) {
    console.error('community/updates error:', err);
    res.status(500).json({ error: 'Failed to load updates' });
  }
});

module.exports.postSystemMessage = postSystemMessage;