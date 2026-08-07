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
              cp.parent_id, cp.post_kind,
              u.id AS user_id, u.display_name, u.email, u.is_artist, u.tier
       FROM community_posts cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.removed = FALSE AND cp.is_system = FALSE
       -- Pinned last, not first. The room reads bottom-up and opens scrolled to
       -- the newest message, so anything put at the top is behind everything
       -- that has been said since — which is the opposite of pinning it.
       ORDER BY cp.pinned ASC, cp.created_at ASC
       LIMIT 300`
    );

    // Polls and question windows, with their results. Fetched alongside rather
    // than embedded in each post, so a poll that has been running for two days
    // does not have its counts recomputed for every message in the room.
    const { rows: polls } = await pool.query(
      `SELECT p.id, p.post_id, p.question, p.option_kind, p.options, p.closes_at,
              (SELECT json_agg(json_build_object('i', v.option_index, 'n', v.n))
               FROM (SELECT option_index, count(*)::int AS n
                     FROM community_poll_votes WHERE poll_id = p.id
                     GROUP BY option_index) v) AS tally,
              (SELECT option_index FROM community_poll_votes
               WHERE poll_id = p.id AND user_id = $1) AS my_vote
       FROM community_polls p
       JOIN community_posts cp ON cp.id = p.post_id
       WHERE cp.removed = FALSE`,
      [req.user.userId]
    );

    const { rows: windows } = await pool.query(
      `SELECT w.id, w.post_id, w.prompt, w.closes_at
       FROM community_question_windows w
       JOIN community_posts cp ON cp.id = w.post_id
       WHERE cp.removed = FALSE`
    );

    // The room is Jinal's, so the background is hers to set. Fans cannot change
    // it — a shared space everyone restyles belongs to nobody.
    const { rows: cfg } = await pool.query(
      `SELECT value FROM platform_config WHERE key = 'community_chat_bg'`
    );
    const bg = cfg[0]?.value;

    const toUrl = (k) => (!k ? null : k.startsWith('http') ? k : `${process.env.R2_PUBLIC_URL}/${k}`);

    res.json({
      posts: rows,
      polls: polls.map((p) => {
        const tally = {};
        (p.tally || []).forEach((t) => { tally[t.i] = t.n; });
        const total = Object.values(tally).reduce((a, b) => a + b, 0);
        return {
          id: p.id, postId: p.post_id, question: p.question,
          optionKind: p.option_kind, closesAt: p.closes_at,
          closed: new Date(p.closes_at) <= new Date(),
          myVote: p.my_vote,
          totalVotes: total,
          options: (p.options || []).map((o, i) => ({
            index: i,
            // A text option is its own label; an image option is a stored key
            // that has to become a URL before it can be shown.
            label: p.option_kind === 'image' ? null : o,
            imageUrl: p.option_kind === 'image' ? toUrl(o) : null,
            votes: tally[i] || 0,
            pct: total ? Math.round(((tally[i] || 0) / total) * 100) : 0,
          })),
        };
      }),
      questionWindows: windows.map((w) => ({
        id: w.id, postId: w.post_id, prompt: w.prompt,
        closesAt: w.closes_at, closed: new Date(w.closes_at) <= new Date(),
      })),
      backgroundUrl: toUrl(bg),
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
  const { content, parentId } = req.body;
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
      `INSERT INTO community_posts (user_id, content, is_system, parent_id)
       VALUES ($1, $2, FALSE, $3) RETURNING *`,
      [req.user.userId, content.trim(), parentId || null]
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

// ─────────────────────────────────────────────
// POLLS
// ─────────────────────────────────────────────

router.post('/polls/:id/vote', authMid, async (req, res) => {
  const { optionIndex } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT closes_at, jsonb_array_length(options) AS n FROM community_polls WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Poll not found' });
    if (new Date(rows[0].closes_at) <= new Date()) {
      return res.status(409).json({ error: 'This poll has closed' });
    }
    const i = parseInt(optionIndex, 10);
    if (Number.isNaN(i) || i < 0 || i >= rows[0].n) {
      return res.status(400).json({ error: 'That is not one of the options' });
    }

    // Changeable while it is open. Someone who taps the wrong thing should be
    // able to correct it rather than being stuck with it for two days.
    await pool.query(
      `INSERT INTO community_poll_votes (poll_id, user_id, option_index)
       VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = $3, voted_at = NOW()`,
      [req.params.id, req.user.userId, i]
    );
    res.json({ ok: true, optionIndex: i });
  } catch (err) {
    console.error('community/vote error:', err);
    res.status(500).json({ error: 'Could not record your vote' });
  }
});

module.exports.postSystemMessage = postSystemMessage;