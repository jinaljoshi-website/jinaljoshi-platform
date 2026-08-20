// backend/routes/studio.js
// Artist-only console API

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { postSystemMessage } = require('./community');
const { pushToUser } = require('./push');
const { applyBlock, liftBlock, setMuted, logModerationAction } = require('../lib/moderation');
const { notifyArtist } = require('../lib/notify');
const { grantGiftedTokens, refundByRelated, refundLedgerEntry } = require('../lib/tokens');
const { deleteObjects, findOrphans } = require('../lib/r2');
const { getBalances } = require('../lib/tokens');
const { getDmConfigForTier, getConfigNumber } = require('../lib/config');
const { render: renderTemplate, inspect: inspectTemplate, FIELDS: BROADCAST_FIELDS } = require('../lib/broadcast');
const { getLocalDateStr, getAllotmentPeriodKey } = require('../lib/time');

router.use(authMid, artistOnly);

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const [notifs, pendingCalls, pendingRequests, recentMembers, unreadDMs, lowStockMerch, pendingReports] = await Promise.all([
      // Joined to the member. Every notification already carries fan_id and none
      // of them ever fetched the name, so they read as "a member unlocked a set"
      // — true of anybody, and useless for deciding whether to reply.
      pool.query(`SELECT n.*,
                         u.display_name AS fan_name,
                         u.email        AS fan_email,
                         u.tier         AS fan_tier
                    FROM artist_notifications n
                    LEFT JOIN users u ON u.id = n.fan_id
                   WHERE n.read = FALSE
                   ORDER BY n.created_at DESC LIMIT 20`),
      pool.query(`SELECT cr.*, u.email, u.display_name, u.tier FROM call_requests cr JOIN users u ON u.id = cr.user_id WHERE cr.status = 'pending' AND cr.proposed_by = 'fan' ORDER BY cr.created_at DESC`),
      pool.query(`SELECT cr.*, u.email, u.display_name, u.tier FROM custom_requests cr JOIN users u ON u.id = cr.user_id WHERE cr.status = 'pending' ORDER BY cr.created_at DESC`),
      pool.query(`SELECT id, email, display_name, tier, membership_expires_at, coin_balance, created_at FROM users WHERE tier != 'guest' AND membership_expires_at > NOW() ORDER BY created_at DESC LIMIT 10`),
      pool.query(`SELECT dm.*, u.email, u.display_name, u.tier FROM direct_messages dm JOIN users u ON u.id = dm.sender_id WHERE dm.recipient_id = $1 AND dm.read = FALSE ORDER BY dm.created_at DESC LIMIT 20`, [req.user.userId]),
      // One-of-one outfits are excluded: quantity 1 is the whole point, so they
      // would sit in a "running low" list forever and train the eye to ignore it.
      pool.query(`SELECT * FROM merchandise WHERE visible = TRUE AND remaining <= 5
                    AND is_auction_item = FALSE ORDER BY remaining ASC LIMIT 10`),
      pool.query(
        `SELECT cr.id, cr.reason, cr.created_at, cp.id AS post_id, cp.content AS post_content,
                author.display_name AS author_name, author.email AS author_email,
                reporter.display_name AS reporter_name, reporter.email AS reporter_email
         FROM content_reports cr
         JOIN community_posts cp ON cp.id = cr.post_id
         JOIN users author ON author.id = cp.user_id
         JOIN users reporter ON reporter.id = cr.reporter_id
         WHERE cr.status = 'pending' ORDER BY cr.created_at ASC LIMIT 10`
      ),
    ]);
    res.json({
      notifications: notifs.rows, pendingCalls: pendingCalls.rows, pendingRequests: pendingRequests.rows,
      recentMembers: recentMembers.rows, unreadDMs: unreadDMs.rows,
      lowStockMerch: lowStockMerch.rows, pendingReports: pendingReports.rows,
    });
  } catch (err) {
    console.error('studio/dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.post('/notifications/mark-read', async (req, res) => {
  await pool.query(`UPDATE artist_notifications SET read = TRUE WHERE read = FALSE`);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// PLATFORM CONFIG
// ─────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT key, value FROM platform_config ORDER BY key`);
    const config = {};
    rows.forEach((r) => { config[r.key] = r.value; });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

router.post('/config', async (req, res) => {
  const { changes } = req.body;
  if (!changes || typeof changes !== 'object') {
    return res.status(400).json({ error: 'Invalid changes object' });
  }
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(changes)) {
      await client.query(
        `INSERT INTO platform_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    await client.query(`UPDATE platform_config SET value = 'false', updated_at = NOW() WHERE key = 'config_published'`);
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

router.post('/config/publish', async (req, res) => {
  try {
    await pool.query(`UPDATE platform_config SET value = 'true', updated_at = NOW() WHERE key = 'config_published'`);
    res.json({ ok: true, message: 'Config published. All new purchases will use updated pricing.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish config' });
  }
});

// Deleting messages. Several at once, because tidying a conversation one
// message at a time is not tidying.
//
// The row stays and is marked instead of being removed: a message that vanishes
// without trace leaves the other person wondering whether they imagined it, and
// on a platform built on closeness that is a worse outcome than admitting
// something was withdrawn.
router.post('/dms/delete', async (req, res) => {
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return res.status(400).json({ error: 'Nothing selected' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE direct_messages SET deleted_at = NOW()
       WHERE id = ANY($1) AND deleted_at IS NULL
       RETURNING id`,
      [messageIds]
    );
    res.json({ ok: true, deleted: rows.length });
  } catch (err) {
    console.error('studio/dms/delete error:', err);
    res.status(500).json({ error: 'Could not delete those' });
  }
});

// ─────────────────────────────────────────────
// CHAT BACKGROUNDS
// ─────────────────────────────────────────────

router.post('/chat-bg', async (req, res) => {
  const { type, value, fanId } = req.body;
  try {
    if (type === 'fan' && fanId) {
      await pool.query(
        `INSERT INTO fan_settings (user_id, personal_chat_bg) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET personal_chat_bg = $2, updated_at = NOW()`,
        [fanId, value]
      );
    } else {
      const key = type === 'community' ? 'community_chat_bg' : 'personal_chat_bg';
      if (value === null || value === undefined || value === '') {
        // platform_config.value is NOT NULL — "removing" a background means deleting the
        // row entirely rather than trying to store null. chat.js's LEFT JOIN + COALESCE
        // already treats a missing row exactly the same as a null value on read.
        await pool.query(`DELETE FROM platform_config WHERE key = $1`, [key]);
      } else {
        await pool.query(
          `INSERT INTO platform_config (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('chat-bg update error:', err.message);
    res.status(500).json({ error: 'Failed to update background' });
  }
});

// ─────────────────────────────────────────────
// TOKEN GRANTS
// ─────────────────────────────────────────────

router.post('/grant-tokens', async (req, res) => {
  const { email, amount, reason } = req.body;
  if (!email || !amount || amount < 1) {
    return res.status(400).json({ error: 'Email and amount are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No account found for this email' });
    }
    const userId = rows[0].id;
    // A gift goes into the gifted pot: spendable on messages and content, expiring,
    // and never usable for merchandise, outfits, calls or membership. Crediting
    // coin_balance here would quietly hand out purchased-equivalent tokens.
    const grant = await grantGiftedTokens(client, {
      userId,
      amount,
      source: 'artist_gift',
      note:   reason || null,
      label:  reason || 'Token gift from Jinal',
    });
    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('token_grant', $1, $2)`,
      [userId, JSON.stringify({ amount, reason })]
    );
    await client.query('COMMIT');
    const expiryDate = new Date(grant.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    res.json({ ok: true, message: `${amount} gifted tokens sent to ${email} — they expire on ${expiryDate}` });

    pushToUser(userId, {
      title: 'Jinal sent you tokens',
      body:  `${amount} gifted tokens added — use them on messages and content before ${expiryDate}.`,
      url:   '/platform/coins',
      tag:   'grant',
    }).catch((e) => console.error('Grant push failed:', e.message));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to grant tokens' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// REFUNDS
// ─────────────────────────────────────────────

// A fan's recent spends, so a refund can be issued against a specific transaction
// rather than by handing out fresh tokens and hoping the amounts line up.
router.get('/fans/:fanId/transactions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, amount, label, from_gifted, from_purchased, refunded_at, created_at
       FROM coin_ledger
       WHERE user_id = $1 AND direction = 'debit'
       ORDER BY created_at DESC LIMIT 40`,
      [req.params.fanId]
    );
    res.json({ transactions: rows });
  } catch (err) {
    console.error('studio/fan transactions error:', err);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// Reverses one spend, returning each part to the pot it came from. Gifted portions
// come back as a fresh 30-day grant; purchased goes back to the spendable balance.
router.post('/refund', async (req, res) => {
  const { ledgerId, reason } = req.body;
  if (!ledgerId) return res.status(400).json({ error: 'ledgerId is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await refundLedgerEntry(client, {
      ledgerId,
      label: reason?.trim() ? `Refund: ${reason.trim()}` : undefined,
    });
    await client.query('COMMIT');

    const parts = [];
    if (result.fromPurchased > 0) parts.push(`${result.fromPurchased} purchased`);
    if (result.fromGifted > 0)    parts.push(`${result.fromGifted} gifted`);

    res.json({
      ok: true,
      ...result,
      message: `Refunded ${result.amount} tokens (${parts.join(' + ')}).`,
    });

    pushToUser(result.userId, {
      title: 'Tokens refunded',
      body:  `${result.amount} tokens have been returned to your balance.${result.fromGifted > 0 ? ' Gifted tokens come back with a fresh 30-day window.' : ''}`,
      url:   '/platform/coins',
      tag:   'refund',
    }).catch((e) => console.error('Refund push failed:', e.message));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/refund error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to issue refund' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// FANS
// ─────────────────────────────────────────────

// One member's whole history, in the order it happened.
//
// Deliberately distinguishes looking from buying. A set somebody opened and did
// not unlock says something quite different from one they paid for, and a
// screen that shows both as "opened" is how a paid set with no buyers ends up
// looking like a popular one.
router.get('/fans/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT g.granted_at AS at, 'unlock' AS kind,
                s.title AS detail,
                COALESCE(g.coins_paid, 0) AS tokens,
                g.scope AS extra,
                NULL::text AS ledger_id, NULL::timestamptz AS refunded_at
         FROM access_grants g JOIN sets s ON s.id = g.set_id
         WHERE g.user_id = $1

         UNION ALL
         -- Looked but did not unlock. Only where no grant exists, so a set they
         -- later paid for shows once, as the purchase.
         SELECT v.first_seen, 'viewed', s.title, 0, NULL, NULL, NULL
         FROM set_views v JOIN sets s ON s.id = v.set_id
         WHERE v.user_id = $1
           AND NOT EXISTS (SELECT 1 FROM access_grants g2
                           WHERE g2.user_id = v.user_id AND g2.set_id = v.set_id)

         UNION ALL
         SELECT l.created_at, 'recharge', l.label, l.amount, l.payment_amount_inr::text, NULL, NULL
         FROM coin_ledger l
         WHERE l.user_id = $1 AND l.type = 'recharge' AND l.direction = 'credit'

         UNION ALL
         SELECT l.created_at, 'membership', l.label, l.amount, NULL, l.id::text, l.refunded_at
         FROM coin_ledger l
         WHERE l.user_id = $1 AND l.direction = 'debit'
           AND l.type IN ('membership_purchase','membership_upgrade','membership_extend')

         UNION ALL
         SELECT l.created_at, 'spend', l.label, l.amount, l.type,
                l.id::text, l.refunded_at
         FROM coin_ledger l
         WHERE l.user_id = $1 AND l.direction = 'debit'
           AND l.type NOT IN ('membership_purchase','membership_upgrade','membership_extend','content_unlock')

         UNION ALL
         SELECT m.created_at, 'message', LEFT(m.content, 60), COALESCE(m.tokens_charged, 0), NULL, NULL, NULL
         FROM direct_messages m
         WHERE m.sender_id = $1

         UNION ALL
         SELECT cr.created_at, 'call', cr.call_type, COALESCE(cr.coins_charged, 0), cr.status, NULL, NULL
         FROM call_requests cr WHERE cr.user_id = $1
       ) x
       ORDER BY at DESC
       LIMIT 300`,
      [req.params.id]
    );

    // Where their money and their attention actually went. The history says
    // what happened; this says what it adds up to, which is the question you
    // arrive with.
    const { rows: sum } = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(payment_amount_inr), 0) FROM coin_ledger
          WHERE user_id = $1 AND type = 'recharge' AND direction = 'credit')        AS paid_inr,
         (SELECT COALESCE(SUM(amount), 0) FROM coin_ledger
          WHERE user_id = $1 AND type = 'recharge' AND direction = 'credit')        AS tokens_bought,
         (SELECT COALESCE(SUM(g.amount), 0) FROM gifted_grants g WHERE g.user_id = $1) AS tokens_gifted,
         (SELECT count(*) FROM access_grants WHERE user_id = $1 AND scope = 'tier')  AS sets_opened,
         (SELECT count(*) FROM access_grants WHERE user_id = $1 AND scope = 'upsell') AS extras_bought,
         (SELECT count(*) FROM set_views v WHERE v.user_id = $1
            AND NOT EXISTS (SELECT 1 FROM access_grants g2
                            WHERE g2.user_id = v.user_id AND g2.set_id = v.set_id))  AS looked_only,
         (SELECT count(*) FROM direct_messages WHERE sender_id = $1)                 AS messages,
         (SELECT count(*) FROM call_requests WHERE user_id = $1)                     AS calls,
         (SELECT COALESCE(SUM(coin_balance), 0) FROM users WHERE id = $1)            AS balance`,
      [req.params.id]
    );

    // What they spent it on, by kind. A member who spends everything on messages
    // is a different person from one who spends it on sets, and the total alone
    // hides which.
    const { rows: byType } = await pool.query(
      `SELECT type, COALESCE(SUM(amount), 0)::int AS tokens, count(*) AS times
       FROM coin_ledger WHERE user_id = $1 AND direction = 'debit'
       GROUP BY type ORDER BY 2 DESC`,
      [req.params.id]
    );

    const t = sum[0];
    res.json({
      summary: {
        paidInr:      Number(t.paid_inr),
        tokensBought: Number(t.tokens_bought),
        tokensGifted: Number(t.tokens_gifted),
        setsOpened:   Number(t.sets_opened),
        extrasBought: Number(t.extras_bought),
        lookedOnly:   Number(t.looked_only),
        messages:     Number(t.messages),
        calls:        Number(t.calls),
        balance:      Number(t.balance),
      },
      spentOn: byType.map((r) => ({
        type: r.type, tokens: Number(r.tokens), times: Number(r.times),
      })),
      rows: rows.map((r) => ({
        at: r.at, kind: r.kind, detail: r.detail,
        tokens: Number(r.tokens) || 0, extra: r.extra,
        // Present only where a refund is possible — a view or an unlock taken
        // on membership has no ledger entry to reverse.
        ledgerId: r.ledger_id || null,
        refundedAt: r.refunded_at || null,
      })),
    });
  } catch (err) {
    console.error('studio/fan history error:', err);
    res.status(500).json({ error: 'Failed to load their history' });
  }
});

router.get('/fans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.tier, u.membership_expires_at,
              u.coin_balance, u.created_at, u.is_muted, u.blocked_until, u.block_count,
              u.email_verified,
              COALESCE((
                SELECT SUM(g.remaining) FROM gifted_grants g
                WHERE g.user_id = u.id AND g.remaining > 0 AND g.expires_at > NOW()
              ), 0)::int AS gifted_balance,
              (
                SELECT MIN(g.expires_at) FROM gifted_grants g
                WHERE g.user_id = u.id AND g.remaining > 0 AND g.expires_at > NOW()
              ) AS gifted_expires_at,

              -- What they have actually paid, in rupees.
              --
              -- Money in rather than tokens out: gifted and bonus tokens were
              -- never anybody's money, and ranking members by tokens spent puts
              -- somebody who spent a gift above somebody who paid.
              COALESCE((
                SELECT SUM(cl.payment_amount_inr) FROM coin_ledger cl
                WHERE cl.user_id = u.id AND cl.type = 'recharge' AND cl.direction = 'credit'
              ), 0)::float8 AS paid_inr,

              -- Last seen. active_sessions.last_seen_at is already written on
              -- every authenticated request, so this needed no new column and
              -- no new write — it was simply never read.
              (
                SELECT MAX(a.last_seen_at) FROM active_sessions a WHERE a.user_id = u.id
              ) AS last_seen_at
       FROM users u WHERE u.is_artist = FALSE ORDER BY u.created_at DESC`
    );
    res.json({ fans: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load fans' });
  }
});

// ─────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────

router.get('/dms', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
       dm.id, dm.created_at, dm.tokens_charged, dm.read,
       CASE WHEN dm.deleted_at IS NULL THEN dm.content ELSE NULL END AS content,
       (dm.deleted_at IS NOT NULL) AS deleted,
       (dm.sender_id = $1) AS is_mine,
       CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END AS fan_id,
       u.email, u.display_name, u.tier
       FROM direct_messages dm
       JOIN users u ON u.id = CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END
       WHERE dm.sender_id = $1 OR dm.recipient_id = $1
       ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, dm.created_at DESC`,
      [req.user.userId]
    );

    // Newest first, as every messaging app does. DISTINCT ON only decides which
    // message represents each conversation — it says nothing about the order
    // they come back in, which until now was effectively arbitrary.
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ conversations: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

router.get('/dms/:fanId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.created_at, dm.parent_id,
              dm.tokens_charged, dm.read, dm.unlock_price_coins, dm.unlocked_at,
              (dm.deleted_at IS NOT NULL) AS deleted,
              CASE WHEN dm.deleted_at IS NULL THEN dm.content END            AS content,
              CASE WHEN dm.deleted_at IS NULL THEN dm.media_url END          AS media_url,
              CASE WHEN dm.deleted_at IS NULL THEN dm.media_type END         AS media_type,
              CASE WHEN dm.deleted_at IS NULL THEN dm.locked_media_urls END  AS locked_media_urls,
              (dm.sender_id = $1) AS is_mine
       FROM direct_messages dm
       WHERE (dm.sender_id = $1 AND dm.recipient_id = $2) OR (dm.sender_id = $2 AND dm.recipient_id = $1)
       ORDER BY dm.created_at ASC`,
      [req.user.userId, req.params.fanId]
    );
    await pool.query(
      `UPDATE direct_messages SET read = TRUE WHERE sender_id = $1 AND recipient_id = $2 AND read = FALSE`,
      [req.params.fanId, req.user.userId]
    );
    const { rows: fanRows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.tier, u.coin_balance,
              u.membership_expires_at, u.membership_started_at, u.timezone,
              fs.personal_chat_bg,
              fs.custom_chat_price, fs.custom_messages_per_token, fs.can_send_media,
              u.is_muted, u.blocked_until, u.block_count,
              COALESCE(fs.personal_chat_bg, pc.value, '') AS effective_chat_bg
       FROM users u
       LEFT JOIN fan_settings fs ON fs.user_id = u.id
       LEFT JOIN platform_config pc ON pc.key = 'personal_chat_bg'
       WHERE u.id = $1`,
      [req.params.fanId]
    );

    // What this fan has left, so Jinal can see whether a quiet week means they
    // are out of free messages rather than out of interest — and whether a long
    // reply is about to cost them.
    let quota = null;
    const fan = fanRows[0];
    if (fan) {
      const isActive = fan.membership_expires_at && new Date(fan.membership_expires_at) > new Date();
      const tier     = isActive ? fan.tier : 'guest';
      const [cfg, bal] = await Promise.all([
        getDmConfigForTier(tier),
        getBalances(pool, fan.id),
      ]);

      let monthUsed = 0, todayUsed = 0;
      if (tier !== 'guest') {
        const { rows: allot } = await pool.query(
          `SELECT free_dms_used, free_dms_today, dms_date
           FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
          [fan.id, getAllotmentPeriodKey(fan.membership_started_at)]
        );
        const a = allot[0];
        if (a) {
          monthUsed = a.free_dms_used || 0;
          const dayStr = getLocalDateStr(fan.timezone);
          const rowDay = a.dms_date ? new Date(a.dms_date).toISOString().slice(0, 10) : null;
          todayUsed = rowDay === dayStr ? (a.free_dms_today || 0) : 0;
        }
      }

      quota = {
        tier,
        isActive: !!isActive,
        freeDMsPerMonth: tier === 'guest' ? 0 : cfg.freeDMsPerMonth,
        freeRemaining:   tier === 'guest' ? 0 : Math.max(0, cfg.freeDMsPerMonth - monthUsed),
        dailyDMCap:      tier === 'guest' ? 0 : cfg.dailyDMCap,
        dailyRemaining:  tier === 'guest' ? 0 : Math.max(0, cfg.dailyDMCap - todayUsed),
        overageCost:     cfg.overageCost,
        purchasedBalance: fan.coin_balance,
        giftedBalance:    bal.gifted,
        spendableBalance: bal.total,
        giftedExpiresInDays: bal.giftedExpiresInDays,
      };
    }

    res.json({ messages: rows, fan: fan || null, quota });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

router.post('/dms/:fanId/reply', async (req, res) => {
  const { content, mediaUrl, mediaType } = req.body;
  if (!content?.trim() && !mediaUrl) return res.status(400).json({ error: 'Message or media is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, media_url, media_type, tokens_charged, parent_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING *`,
      [req.user.userId, req.params.fanId, content?.trim() || null, mediaUrl || null, mediaType || null, req.body.parentId || null]
    );
    res.json({ ok: true, message: { ...rows[0], is_mine: true } });

    // Fire-and-forget: a push failure must never break sending the message.
    const preview = content?.trim()
      ? (content.trim().length > 80 ? content.trim().slice(0, 80) + '...' : content.trim())
      : (mediaType === 'video' ? 'Sent you a video' : 'Sent you a photo');
    pushToUser(req.params.fanId, {
      title: 'New message from Jinal',
      body:  preview,
      url:   '/platform/chat',
      tag:   'dm',
    }).catch((e) => console.error('DM push failed:', e.message));
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

router.post('/dms/:fanId/send-locked-media', async (req, res) => {
  const { mediaItems, priceCoins, content } = req.body;

  if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
    return res.status(400).json({ error: 'At least one media item is required' });
  }
  if (priceCoins === undefined || priceCoins === null || priceCoins < 0) {
    return res.status(400).json({ error: 'A valid token price is required (0 or more)' });
  }
  const isValidShape = mediaItems.every((item) => item.url && (item.type === 'image' || item.type === 'video'));
  if (!isValidShape) {
    return res.status(400).json({ error: 'Each media item needs a url and a valid type' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, locked_media_urls, unlock_price_coins, tokens_charged)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING *`,
      [req.user.userId, req.params.fanId, content?.trim() || null, JSON.stringify(mediaItems), priceCoins]
    );

    await pool.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('locked_media_sent', $1, $2)`,
      [req.params.fanId, JSON.stringify({ itemCount: mediaItems.length, priceCoins })]
    );

    res.json({ ok: true, message: { ...rows[0], is_mine: true } });

    pushToUser(req.params.fanId, {
      title: 'Jinal sent you something',
      body:  priceCoins > 0 ? `Unlock for ${priceCoins} tokens` : 'New media in your chat',
      url:   '/platform/chat',
      tag:   'dm',
    }).catch((e) => console.error('Locked media push failed:', e.message));
  } catch (err) {
    // The message as well as the label. 'Failed to send locked media' told
    // nobody anything — not the person who saw it and not whoever had to work
    // out why — and the underlying error was only ever in the server log.
    console.error('studio/dms/send-locked-media error:', err);
    res.status(500).json({
      error: 'LOCKED_MEDIA_FAILED',
      message: `Could not send: ${err.message}`,
    });
  }
});

// ─────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────

// A set with no cover falls back to its first item rather than showing an empty
// card. Cover is normally set from the first upload, but a set created before
// that behaviour — or one whose cover was deleted — would otherwise be blank
// forever with no way to notice from the list.
// A stored key to the URL a browser can fetch. Was defined inside one route
// and nowhere else, so anything needing it had to redeclare it.
const toPublicUrl = (k) => (!k ? null : String(k).startsWith('http') ? k : `${process.env.R2_PUBLIC_URL}/${k}`);

const COVER_FALLBACK = `COALESCE(s.cover_key,
  (SELECT r2_key FROM set_items WHERE set_id = s.id
   AND media_type <> 'video' ORDER BY position ASC, created_at ASC LIMIT 1))`;

router.get('/content', async (req, res) => {
  try {
    // Each page asks for its own and sees nothing of the other, so there is no
    // way to upload to one while looking at the other.
    const wantCollection = req.query.collection === '1';
    const { rows: sets } = await pool.query(
      `SELECT s.*, ${COVER_FALLBACK} AS cover_key,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
               FROM set_photographers sp JOIN photographers p ON p.id = sp.photographer_id
               WHERE sp.set_id = s.id) AS photographer
       FROM sets s
       WHERE s.is_collection = $1
         -- Only what has been through review.
         --
         -- A set is not in its library until every photograph in it has been
         -- decided: given a tier, or marked and then actually removed. Until
         -- then it sits in the upload queue, where the work is unfinished and
         -- visible as such. A live set stays put whatever is added to it —
         -- new photographs are simply not served until they are tiered, which
         -- the tier check already handles.
         AND (
           s.visible = TRUE
           OR (
             -- Nothing left undecided,
             -- Undecided means different things in the two libraries.
             --
             -- A gallery photograph is undecided until it has a tier. A
             -- collection photograph never has one — access is the whole point
             -- and there is nothing to sub-tier — so it is undecided until
             -- somebody has said keep or remove. Reading a null tier as
             -- undecided held every collection set in the queue for ever,
             -- including the ones the split had just correctly made.
             NOT EXISTS (
               SELECT 1 FROM set_items i
                WHERE i.set_id = s.id
                  AND (
                    i.review_flag = 'remove'
                    OR (s.is_collection = FALSE AND i.tier_category IS NULL)
                    OR (s.is_collection = TRUE  AND i.reviewed_at IS NULL)
                  )
             )
             -- and nothing left to separate.
             --
             -- A sorted set can still be three sets waiting to happen: tiered
             -- photographs with purchase-only or collection ones among them.
             -- Checking only for undecided photographs let such a set into the
             -- gallery whole, carrying collection photographs into a library
             -- they do not belong in.
             -- Only where it is mixed. A set uploaded straight to the
             -- collection is already a collection set, and its photographs
             -- carry no marker to separate — is_collection said so from the
             -- moment it was made.
             AND NOT (
               EXISTS (SELECT 1 FROM set_items i
                        WHERE i.set_id = s.id AND i.tier_category = 'collection')
               AND s.is_collection = FALSE
             )
             AND NOT (
               EXISTS (SELECT 1 FROM set_items i
                        WHERE i.set_id = s.id AND i.tier_category = 'purchase_only')
               AND EXISTS (SELECT 1 FROM set_items i
                            WHERE i.set_id = s.id
                              AND i.tier_category IS NOT NULL
                              AND i.tier_category NOT IN ('purchase_only', 'collection'))
             )
           )
         )
       -- The same order the fans see, so arranging here is arranging there.
       ORDER BY (s.pinned_at IS NULL), s.pinned_at DESC,
                s.display_order ASC NULLS LAST,
                COALESCE(s.published_at, s.created_at) DESC`,
      [wantCollection]
    );
    const { rows: itemCounts } = await pool.query(
      `SELECT set_id, tier_category, COUNT(*) AS count FROM set_items GROUP BY set_id, tier_category`
    );
    const countsBySet = {};
    itemCounts.forEach((row) => {
      if (!countsBySet[row.set_id]) countsBySet[row.set_id] = {};
      countsBySet[row.set_id][row.tier_category] = parseInt(row.count);
    });
    const setsWithCounts = sets.map((s) => ({ ...s, categoryCounts: countsBySet[s.id] || {} }));
    res.json({ sets: setsWithCounts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load content' });
  }
});

router.post('/content', async (req, res) => {
  const { title, description, type = 'photo_set', price_coins = 0, visible = false, category,
          photographerName, photographerNames, isCollection = false } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      // is_collection is set once, here, from which page the set was made on.
      // There is no control to change it afterwards and no checkbox to get
      // wrong — a set belongs to the gallery or to the collection from the
      // moment it exists, and the two lists never show each other.
      // Straight to the top of its own library. A new drop is the thing worth
      // seeing, and putting it last would mean rearranging after every upload.
      `INSERT INTO sets (title, description, type, price_coins, visible, category, is_collection,
                         display_order, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT COALESCE(MIN(display_order), 0) - 1 FROM sets WHERE is_collection = $7),
               CASE WHEN $5 = TRUE THEN NOW() ELSE NULL END)
       RETURNING *`,
      [title.trim(), description || null, type, price_coins, visible, category || null, Boolean(isCollection)]
    );

    await setPhotographers(client, rows[0].id, photographerNames ?? photographerName);
    await client.query('COMMIT');

    // Never announced. The whole point is that it is a surprise found rather
    // than a thing advertised, and a system message would tell everybody it
    // exists — including everybody who cannot open it.
    if (visible && !isCollection) {
      postSystemMessage(`📸 Jinal just dropped "${title.trim()}"! Check the Gallery!`, { kind: 'news' });
    }
    res.json({ ok: true, set: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content error:', err);
    res.status(500).json({ error: 'Failed to create content' });
  } finally {
    client.release();
  }
});

// 'collection' is a marker used only while sorting, never a served tier: the
// split moves those photographs into a collection set and clears it again.
const VALID_TIER_CATEGORIES = ['free', 'community', 'insider', 'premium', 'supreme', 'purchase_only', 'collection'];

// The cover image, served through the backend rather than from storage.
//
// The browser needs to read the pixels into a canvas to make the small blurred
// version, and reading pixels cross-origin requires a CORS policy on the
// bucket — which needs a Cloudflare token the backend does not have. Passing
// the bytes through here makes it a same-origin read, so no bucket
// configuration is involved at all.

// The bytes of one item, through the API.
//
// media.jinaljoshi.in serves no CORS header: an <img> displays fine, but the
// browser may not fetch it or read it back off a canvas. So choosing an
// existing photograph as a cover — which means regenerating the blurred
// preview and the share card from it — could not be done in the page at all.
// It failed silently, because the fetch rejects and the catch swallowed it.
//
// The same trick the cover backfill already uses: the server reads from R2 and
// streams it back same-origin, where the canvas is allowed to look at it.

// ─────────────────────────────────────────────
// POST /api/studio/content/:id/split
// ─────────────────────────────────────────────
//
// One shoot, sorted once, into as many sets as it turns out to hold.
//
// Photographs come off a camera in one pile and belong in different places, and
// deciding which before uploading means guessing at a thumbnail. So they arrive
// as one draft and the review decides: 1-5 tier them, 6 marks a photograph as
// purchase-only, 7 sends it to the private collection.
//
// A set never mixes the three. A Supreme member who has paid for everything
// should not find part of a set walled off from her, so purchase-only content
// is its own set rather than a locked corner of somebody else's — which the
// database already enforces, and this works with rather than around.
//
// The original set keeps whatever was tiered and the others are created beside
// it, hidden, each with its own caption, price and cover. Nothing is published
// here: a collection set may want different timing from a gallery drop, and
// that is a decision for afterwards.
router.post('/content/:id/split', async (req, res) => {
  // A caption and price for each group the sort turned up, the tiered one
  // included: the draft was named before anybody had seen the photographs, and
  // by the end of a review there is usually a better name for it.
  const { tiered, purchase, collection, removeMarked } = req.body;
  const setId = req.params.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: srcRows } = await client.query(
      `SELECT * FROM sets WHERE id = $1 FOR UPDATE`, [setId]
    );
    if (!srcRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Set not found' });
    }
    const src = srcRows[0];

    const { rows: items } = await client.query(
      `SELECT id, tier_category, r2_key, media_type FROM set_items
        WHERE set_id = $1 AND review_flag IS DISTINCT FROM 'remove'
        ORDER BY position ASC, created_at ASC`, [setId]
    );

    const forPurchase  = items.filter((i) => i.tier_category === 'purchase_only');
    const forCollection = items.filter((i) => i.tier_category === 'collection');
    const staying      = items.filter((i) =>
      i.tier_category && i.tier_category !== 'purchase_only' && i.tier_category !== 'collection');

    // Told plainly rather than silently doing nothing. A caption asked for and
    // then not used is a worse outcome than being asked to go back.
    if (forPurchase.length && !purchase?.title?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'PURCHASE_CAPTION_REQUIRED',
        message: `${forPurchase.length} photographs are marked purchase-only and need a caption and price.` });
    }
    if (forCollection.length && !collection?.title?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'COLLECTION_CAPTION_REQUIRED',
        message: `${forCollection.length} photographs are marked for the collection and need a caption and price.` });
    }

    // Neither of these can be free.
    //
    // A tiered set may well be worth nothing on its own — membership already
    // paid for it, and a price of zero says exactly that. Purchase-only and
    // collection sets have no such story: being bought is the whole of what
    // they are, and a zero there is a slip that hands them to everybody.
    // Caught here rather than at publish, because this is where the number is
    // typed and where it can still be corrected in context.
    if (forPurchase.length && !(parseInt(purchase?.price, 10) > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'PURCHASE_PRICE_REQUIRED',
        message: 'A purchase-only set needs a price. Being bought is the whole of what it is.' });
    }
    if (forCollection.length && !(parseInt(collection?.price, 10) > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'COLLECTION_PRICE_REQUIRED',
        message: 'A collection set needs a price. Being bought is the whole of what it is.' });
    }

    // Marked photographs go first, or nothing goes at all.
    //
    // A set must not reach its library carrying photographs meant to be gone —
    // they have been judged and simply not acted on yet. Asked once, here,
    // rather than at publish: this is the moment the sets are being made, and
    // it is the last point at which somebody is still looking at the review.
    const { rows: doomedRows } = await client.query(
      `SELECT id, r2_key FROM set_items WHERE set_id = $1 AND review_flag = 'remove'`,
      [setId]
    );
    if (doomedRows.length && !removeMarked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'MARKED_ITEMS',
        marked: doomedRows.length,
        message: `${doomedRows.length} photograph${doomedRows.length === 1 ? ' is' : 's are'} marked for removal. They go before the sets are made.`,
      });
    }
    if (doomedRows.length) {
      await client.query(`DELETE FROM set_items WHERE id = ANY($1)`, [doomedRows.map((d) => d.id)]);
      // The files themselves, after the transaction has committed — a failed
      // delete in R2 should not roll back a finished review, and the orphan
      // sweep would find them anyway.
      var doomedKeys = doomedRows.map((d) => d.r2_key).filter(Boolean);
    }

    const made = [];

    // The original, renamed and repriced if the sort suggested better.
    if (tiered?.title?.trim()) {
      await client.query(
        `UPDATE sets SET title = $1, description = $2, price_coins = $3 WHERE id = $4`,
        [tiered.title.trim(), tiered.description || null,
         parseInt(tiered.price, 10) || src.price_coins, setId]
      );
    }

    // Each new set is made the same way the create route makes one, so a set
    // born of a split is indistinguishable from one made by hand.
    const makeSet = async (spec, isCollection, moving) => {
      const { rows } = await client.query(
        `INSERT INTO sets (title, description, type, price_coins, visible, category, is_collection,
                           display_order, cover_key)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6,
                 (SELECT COALESCE(MIN(display_order), 0) - 1 FROM sets WHERE is_collection = $6),
                 $7)
         RETURNING *`,
        [spec.title.trim(), spec.description || null, src.type,
         parseInt(spec.price, 10) || 0, src.category, isCollection,
         // The first photograph of the group, so a set is never coverless. It
         // can be changed afterwards like any other.
         moving.find((m) => m.media_type !== 'video')?.r2_key || null]
      );
      const made = rows[0];
      await client.query(
        `UPDATE set_items SET set_id = $1 WHERE id = ANY($2)`,
        [made.id, moving.map((m) => m.id)]
      );
      // The same people are credited: it is one shoot however many sets it
      // becomes.
      await client.query(
        `INSERT INTO set_photographers (set_id, photographer_id)
         SELECT $1, photographer_id FROM set_photographers WHERE set_id = $2
         ON CONFLICT DO NOTHING`,
        [made.id, setId]
      );
      return made;
    };

    if (forPurchase.length) {
      // Purchase-only carries no tier: it is not part of any ladder, and
      // leaving the marker behind would put it back in one.
      const created = await makeSet(purchase, false, forPurchase);
      await client.query(
        `UPDATE set_items SET tier_category = 'purchase_only' WHERE set_id = $1`, [created.id]);
      made.push({ id: created.id, title: created.title, kind: 'purchase', items: forPurchase.length });
    }

    if (forCollection.length) {
      const created = await makeSet(collection, true, forCollection);
      // Inside the collection there are no tiers to speak of — access is the
      // whole point and the set is opened or it is not. Marked reviewed at the
      // same time: without a tier to stand for the decision, reviewed_at is the
      // only record that somebody looked at these and kept them, and a
      // collection set is judged by that.
      await client.query(
        `UPDATE set_items SET tier_category = NULL, reviewed_at = COALESCE(reviewed_at, NOW())
          WHERE set_id = $1`, [created.id]);
      made.push({ id: created.id, title: created.title, kind: 'collection', items: forCollection.length });
    }

    await client.query('COMMIT');

    if (typeof doomedKeys !== 'undefined' && doomedKeys.length) {
      deleteObjects(doomedKeys).catch((e) => console.error('split: R2 delete failed:', e.message));
    }

    // Everything hidden, including the original. A sort is not a decision to
    // publish — the sets are looked at once more, whole, before anybody sees
    // them, and that second look is the point of leaving them hidden.
    res.json({
      ok: true,
      stayed: staying.length,
      removed: doomedRows.length,
      created: made,
      note: 'All sets are hidden. Publish each when you have looked at it whole.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('studio/content/split error:', err);
    res.status(500).json({ error: 'SPLIT_FAILED', message: err.message });
  } finally {
    client.release();
  }
});


// ─────────────────────────────────────────────
// GET /api/studio/content/queue
// ─────────────────────────────────────────────
//
// Everything uploaded and not yet finished with.
//
// Both libraries at once, because a shoot does not know yet which it belongs to
// — that is what the review decides. A set leaves this list by being finished:
// every photograph tiered, and anything marked for removal actually removed.
router.get('/content/queue', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.is_collection, s.price_coins, s.created_at,
              ${COVER_FALLBACK} AS cover_key,
              (SELECT count(*)::int FROM set_items i WHERE i.set_id = s.id)                       AS total,
              (SELECT count(*)::int FROM set_items i WHERE i.set_id = s.id
                AND i.review_flag IS DISTINCT FROM 'remove'
                AND (CASE WHEN s.is_collection THEN i.reviewed_at IS NULL
                          ELSE i.tier_category IS NULL END))                                      AS untiered,
              (SELECT count(*)::int FROM set_items i WHERE i.set_id = s.id
                AND i.review_flag = 'remove')                                                     AS marked,
              (SELECT count(*)::int FROM set_items i WHERE i.set_id = s.id
                AND i.tier_category = 'purchase_only')                                            AS purchase,
              (SELECT count(*)::int FROM set_items i WHERE i.set_id = s.id
                AND i.tier_category = 'collection')                                               AS collection
         FROM sets s
        WHERE s.visible = FALSE
          AND (
            EXISTS (
              SELECT 1 FROM set_items i
               WHERE i.set_id = s.id
                 AND (
                   i.review_flag = 'remove'
                   OR (s.is_collection = FALSE AND i.tier_category IS NULL)
                   OR (s.is_collection = TRUE  AND i.reviewed_at IS NULL)
                 )
            )
            OR (
              EXISTS (SELECT 1 FROM set_items i
                       WHERE i.set_id = s.id AND i.tier_category = 'collection')
              AND s.is_collection = FALSE
            )
            OR (
              EXISTS (SELECT 1 FROM set_items i
                       WHERE i.set_id = s.id AND i.tier_category = 'purchase_only')
              AND EXISTS (SELECT 1 FROM set_items i
                           WHERE i.set_id = s.id
                             AND i.tier_category IS NOT NULL
                             AND i.tier_category NOT IN ('purchase_only', 'collection'))
            )
          )
        ORDER BY s.created_at DESC`
    );
    res.json({
      sets: rows.map((r) => ({
        id: r.id, title: r.title, isCollection: r.is_collection,
        priceCoins: r.price_coins, createdAt: r.created_at,
        coverUrl: toPublicUrl(r.cover_key),
        total: r.total, untiered: r.untiered, marked: r.marked,
        purchase: r.purchase, collection: r.collection,
        // Ready when nothing is left undecided and nothing is left to
        // separate. A set of tiered photographs with collection ones among them
        // is sorted but not finished — it is two sets that have not been made
        // yet, and letting it through put collection photographs in the gallery.
        ready: r.untiered === 0,
        needsSplit: (r.collection > 0 && !r.is_collection)
          || (r.purchase > 0 && r.total - r.purchase - r.collection - r.marked > 0),
      })),
    });
  } catch (err) {
    console.error('studio/content/queue error:', err);
    res.status(500).json({ error: 'Could not load the queue' });
  }
});

router.get('/content/item/:itemId/image', async (req, res) => {
  try {
    const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
    const { rows } = await pool.query(
      `SELECT r2_key FROM set_items WHERE id = $1`, [req.params.itemId]
    );
    const key = rows[0]?.r2_key;
    if (!key) return res.status(404).json({ error: 'Not found' });

    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const objectKey = key.startsWith('http') ? new URL(key).pathname.replace(/^\//, '') : key;
    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: objectKey,
    }));
    res.setHeader('Content-Type', obj.ContentType || 'image/jpeg');
    obj.Body.pipe(res);
  } catch (err) {
    console.error('studio/item-image error:', err.message);
    res.status(500).json({ error: 'Could not read that image' });
  }
});

router.get('/content/:id/cover-image', async (req, res) => {
  try {
    const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
    const { rows } = await pool.query(
      `SELECT ${COVER_FALLBACK} AS cover_key FROM sets s WHERE s.id = $1`, [req.params.id]
    );
    const key = rows[0]?.cover_key;
    if (!key) return res.status(404).json({ error: 'No cover' });

    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    // Stored values are sometimes full URLs and sometimes bare keys, depending
    // on when they were written.
    const objectKey = key.startsWith('http')
      ? new URL(key).pathname.replace(/^\//, '')
      : key;

    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: objectKey,
    }));

    res.setHeader('Content-Type', obj.ContentType || 'image/jpeg');
    obj.Body.pipe(res);
  } catch (err) {
    console.error('studio/cover-image error:', err.message);
    res.status(500).json({ error: 'Could not read the cover' });
  }
});

// What every tier actually pays for this set. The price on the form is a base
// that gets split by how many photos sit at each level, then discounted or
// multiplied by who is looking — so the number Jinal types is not a number any
// fan sees. This shows all five.
router.get('/content/:id/pricing', async (req, res) => {
  try {
    const { rows: setRows } = await pool.query(
      `SELECT price_coins FROM sets WHERE id = $1`, [req.params.id]
    );
    if (!setRows.length) return res.status(404).json({ error: 'Set not found' });
    const basePrice = setRows[0].price_coins;

    const { rows: items } = await pool.query(
      `SELECT tier_category FROM set_items WHERE set_id = $1`, [req.params.id]
    );
    if (!items.length) return res.json({ basePrice, tiers: [], itemCount: 0 });

    const { rows: cfgRows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key = 'guest_price_multiplier' OR key = 'token_rate_inr'
          OR key LIKE '%_discount_pct'`
    );
    const cfg = {};
    cfgRows.forEach((r) => { cfg[r.key] = parseFloat(r.value); });

    const ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];
    const total = items.length;
    const freeCount = items.filter((i) => i.tier_category === 'free').length;

    const tiers = ORDER.map((tier) => {
      const reaches = (cat) => ORDER.indexOf(tier) >= ORDER.indexOf(cat);
      const tierItems = items.filter((i) =>
        i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && reaches(i.tier_category));
      const upsellItems = items.filter((i) =>
        i.tier_category === 'purchase_only' ||
        (i.tier_category !== 'free' && !reaches(i.tier_category)));

      const isGuest  = tier === 'guest';
      const rawTier   = basePrice * (tierItems.length / total);
      const rawUpsell = basePrice * (upsellItems.length / total);
      const discount  = isGuest ? 0 : (cfg[`${tier}_discount_pct`] || 0);
      const mult      = cfg.guest_price_multiplier || 1;

      // A member's own level is included; a guest has no level, so they buy it.
      const tierPrice   = isGuest ? Math.ceil(rawTier * mult) : 0;
      const upsellPrice = isGuest
        ? Math.ceil(rawUpsell * mult)
        : Math.ceil(rawUpsell * (1 - discount / 100));

      return {
        tier,
        freeCount,
        includedCount: isGuest ? 0 : tierItems.length,
        tierPrice,
        upsellCount: upsellItems.length,
        upsellPrice,
        totalToSeeAll: tierPrice + upsellPrice,
        totalInr: Math.round((tierPrice + upsellPrice) * (cfg.token_rate_inr || 0)),
      };
    });

    res.json({ basePrice, itemCount: total, freeCount, tokenRate: cfg.token_rate_inr, tiers });
  } catch (err) {
    console.error('studio/content/pricing error:', err);
    res.status(500).json({ error: 'Failed to work out pricing' });
  }
});

// Everything inside a set, so Jinal can look through it the way a fan would
// rather than trusting a count. Without this, a single bad photo in a large set
// means deleting and rebuilding the whole thing.

// ─────────────────────────────────────────────
// GET /api/studio/library
// ─────────────────────────────────────────────
//
// Everything on the platform, for picking from rather than uploading again.
//
// Chat stores a media URL, not an upload — so anything already in R2 can be
// sent by passing the URL it already has. Nothing is copied and nothing is
// stored twice; the picker only needs to know what exists.
//
// Grouped the way the money works rather than the way the tables do: free,
// paid, and the private collection. What matters when choosing a photograph to
// send is what somebody would otherwise have paid for it.

// ─────────────────────────────────────────────
// BROADCAST
// ─────────────────────────────────────────────
//
// One message to many members, addressed to each of them.
//
// Sent as real direct messages rather than only as a push, because a push is
// gone the moment it is dismissed and a fan who had notifications switched off
// would never know. A message waits in the thread, and replying to it lands
// exactly where a reply should.
//
// Never charged. This is Jinal writing to her members, not a fan buying her
// attention, and the DM allowance exists to price the latter.

const AUDIENCES = {
  // Everybody with a live membership.
  members:     "membership_expires_at > NOW()",
  // Everybody at all, including those who never subscribed.
  everyone:    "TRUE",
  // Lapsed, and therefore worth writing to.
  lapsed:      "membership_expires_at IS NOT NULL AND membership_expires_at <= NOW()",
  // Never held one.
  guests:      "membership_expires_at IS NULL",
  // Running out within the fortnight.
  expiring:    "membership_expires_at > NOW() AND membership_expires_at < NOW() + INTERVAL '14 days'",
};

async function audienceRows(audience, tier, artistId) {
  const where = AUDIENCES[audience];
  if (!where) throw new Error(`Unknown audience: ${audience}`);
  const params = [artistId];
  let sql = `SELECT id, display_name, email, tier, coin_balance, timezone,
                    membership_expires_at, membership_started_at,
                    trial_tier, trial_started_at, trial_ends_at
               FROM users
              -- Never Jinal. She is a row in users like anybody else, so
              -- "everyone" included her and a broadcast sent her a message
              -- from herself: unread, counted on the dashboard, and belonging
              -- to no conversation, so there was nothing to open and nothing
              -- to clear it.
              WHERE is_test = FALSE
                AND id <> $1
                AND (${where})`;
  if (tier && tier !== 'all') { params.push(tier); sql += ` AND tier = $${params.length}`; }
  sql += ' ORDER BY created_at ASC';
  const { rows } = await pool.query(sql, params);
  return rows;
}

// What it would look like, for real people, before anybody receives it.
// What may be used in a template. Served rather than duplicated in the
// frontend, so a field cannot be offered that does not exist.
router.get('/broadcast/fields', (req, res) => {
  res.json({ fields: BROADCAST_FIELDS, audiences: Object.keys(AUDIENCES) });
});

router.post('/broadcast/preview', async (req, res) => {
  const { template, audience = 'members', tier = 'all' } = req.body;
  try {
    const rows = await audienceRows(audience, tier, req.user.userId);
    const checked = inspectTemplate(template);
    res.json({
      recipients: rows.length,
      unknownFields: checked.unknown,
      usedFields: checked.used,
      // Three real ones rather than invented examples: a template that reads
      // well for a made-up member and badly for an actual one is exactly the
      // mistake this exists to catch.
      samples: rows.slice(0, 3).map((r) => ({
        to: r.display_name || r.email,
        text: renderTemplate(template, r),
      })),
    });
  } catch (err) {
    console.error('studio/broadcast/preview error:', err);
    res.status(400).json({ error: err.message });
  }
});

router.post('/broadcast/send', async (req, res) => {
  const { template, audience = 'members', tier = 'all', alsoPush = true, confirm } = req.body;
  if (!template || !String(template).trim()) {
    return res.status(400).json({ error: 'Nothing to send' });
  }
  // Typed confirmation, because this is the one action here that cannot be
  // taken back — a message can be deleted from a thread, but not unread.
  if (confirm !== 'SEND') {
    return res.status(400).json({ error: 'CONFIRM_REQUIRED', message: 'Confirmation missing' });
  }

  try {
    const rows = await audienceRows(audience, tier, req.user.userId);
    if (!rows.length) return res.json({ ok: true, sent: 0, message: 'Nobody matched' });

    let sent = 0, failed = 0;
    for (const fan of rows) {
      const text = renderTemplate(template, fan);
      try {
        const { rows: msg } = await pool.query(
          `INSERT INTO direct_messages (sender_id, recipient_id, content, tokens_charged)
           VALUES ($1, $2, $3, 0) RETURNING id, created_at`,
          [req.user.userId, fan.id, text]
        );
        // No Stream mirror here. Every other message in this file is mirrored
        // by the browser that sent it, and reaching Stream from the server
        // would be a second way of doing the same thing — one more path to
        // drift. A broadcast lands in the thread and the push announces it;
        // somebody with the app already open sees it on their next poll.
        if (alsoPush) {
          pushToUser(fan.id, {
            title: 'Jinal sent you a message',
            body:  text.length > 90 ? text.slice(0, 90) + '…' : text,
            url:   '/platform/chat',
            tag:   'dm',
          }).catch(() => {});
        }
        sent += 1;
      } catch (e) {
        console.error(`broadcast to ${fan.id}:`, e.message);
        failed += 1;
      }
    }

    res.json({ ok: true, sent, failed, recipients: rows.length });
  } catch (err) {
    console.error('studio/broadcast/send error:', err);
    res.status(500).json({ error: 'Could not send', message: err.message });
  }
});

router.get('/library', async (req, res) => {
  const scope  = req.query.scope || 'sets';       // 'sets' | 'recent'
  const group  = req.query.group || 'all';        // 'all' | 'free' | 'paid' | 'collection'
  const limit  = Math.min(parseInt(req.query.limit, 10) || 120, 400);

  try {
    if (scope === 'recent') {
      // Newest media across everything, which is what most sends draw on.
      const { rows } = await pool.query(
        `SELECT i.id, i.r2_key, i.media_type, i.tier_category, i.created_at,
                s.id AS set_id, s.title AS set_title, s.price_coins, s.is_collection
           FROM set_items i JOIN sets s ON s.id = i.set_id
          WHERE i.review_flag IS DISTINCT FROM 'remove'
          ORDER BY i.created_at DESC
          LIMIT $1`,
        [limit]
      );
      return res.json({ items: rows.map(shapeLibraryItem) });
    }

    // Sets, with a cover to recognise them by and the counts that decide what
    // sending one actually gives away.
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.price_coins, s.is_collection, s.created_at,
              ${COVER_FALLBACK} AS cover_key,
              (SELECT count(*)::int FROM set_items WHERE set_id = s.id
                AND review_flag IS DISTINCT FROM 'remove')                       AS item_count,
              (SELECT count(*)::int FROM set_items WHERE set_id = s.id
                AND tier_category = 'free')                                      AS free_count
         FROM sets s
        ORDER BY s.pinned_at IS NULL, s.pinned_at DESC,
                 s.display_order ASC NULLS LAST,
                 COALESCE(s.published_at, s.created_at) DESC`
    );

    const sets = rows.map((r) => ({
      id: r.id,
      title: r.title,
      coverUrl: toPublicUrl(r.cover_key),
      itemCount: r.item_count,
      priceCoins: r.price_coins,
      isCollection: r.is_collection,
      // Free where every item in it is free; paid where any of it costs
      // something. The collection is its own thing and never mixes.
      group: r.is_collection ? 'collection'
           : (r.free_count === r.item_count && r.item_count > 0) ? 'free'
           : 'paid',
    })).filter((x) => group === 'all' || x.group === group);

    res.json({ sets });
  } catch (err) {
    console.error('studio/library error:', err);
    res.status(500).json({ error: 'Could not load the library' });
  }
});

function shapeLibraryItem(r) {
  return {
    id: r.id,
    url: toPublicUrl(r.r2_key),
    mediaType: r.media_type,
    setId: r.set_id,
    setTitle: r.set_title,
    priceCoins: r.price_coins,
    isCollection: r.is_collection,
    group: r.is_collection ? 'collection'
         : r.tier_category === 'free' ? 'free' : 'paid',
  };
}

router.get('/content/:id/items', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, set_id, type, media_type, r2_key, position, tier_category, created_at, quality,
              review_flag, review_note, reviewed_at
       FROM set_items WHERE set_id = $1
       ORDER BY tier_category, position ASC, created_at ASC`,
      [req.params.id]
    );
    // The URL as well as the key.
    //
    // This returned raw rows, so every screen built its own URL from its own
    // environment variable — and Studio's points at the r2.dev bucket while the
    // backend serves fans from the custom domain. The same photograph therefore
    // had two different addresses depending on who asked, and anything Studio
    // put into a message carried the wrong one.
    res.json({ items: rows.map((r) => ({ ...r, media_url: toPublicUrl(r.r2_key) })) });
  } catch (err) {
    console.error('studio/content/items error:', err);
    res.status(500).json({ error: 'Failed to load set items' });
  }
});


// ─────────────────────────────────────────────
// REVIEW FLAGS
// ─────────────────────────────────────────────
//
// A flag is a note on a photo, never an action. Nothing is hidden and nothing is
// deleted — the item stays exactly where it is and also turns up under its flag,
// to be looked at properly before the set goes out. Deciding what happens to it
// stays a person's job.
//
// reviewed_at is separate from the flag, and records only that somebody looked.
// Without it there is no way to tell a photo that was checked and passed from
// one nobody has reached yet, and no way for a second pass to know where the
// first one stopped — which matters, because a set of several hundred will not
// be got through in one sitting.

// The only mark left. Faults are no longer reported — the pass assigns a tier
// to every photo, and anything not worth a tier is marked for removal and goes
// in one deliberate act afterwards rather than by a keystroke at speed.
const REVIEW_FLAGS = ['remove'];

router.post('/content/items/flag', async (req, res) => {
  const { itemIds, flag, note } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) {
    return res.status(400).json({ error: 'No items given' });
  }
  // null clears the flag while still recording that the photo was seen.
  if (flag !== null && !REVIEW_FLAGS.includes(flag)) {
    return res.status(400).json({ error: `Unknown flag. Expected one of: ${REVIEW_FLAGS.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE set_items
          SET review_flag = $1,
              review_note = $2,
              reviewed_at = NOW()
        WHERE id = ANY($3::uuid[])
        RETURNING id, review_flag, review_note, reviewed_at`,
      [flag, note || null, itemIds]
    );
    res.json({ ok: true, updated: rows.length, items: rows });
  } catch (err) {
    console.error('studio/content/items/flag error:', err);
    res.status(500).json({ error: 'Failed to flag' });
  }
});

// What is left to look at, and what has been flagged. Read by the review screen
// for its tab counts, and useful on its own for picking up a half-finished pass.
router.get('/content/:id/review-progress', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed,
              count(*) FILTER (WHERE review_flag IS NOT NULL)::int AS flagged,
              min(position) FILTER (WHERE reviewed_at IS NULL)     AS first_unreviewed_position
         FROM set_items WHERE set_id = $1`,
      [req.params.id]
    );
    const { rows: byFlag } = await pool.query(
      `SELECT review_flag, count(*)::int AS n
         FROM set_items WHERE set_id = $1 AND review_flag IS NOT NULL
        GROUP BY review_flag`,
      [req.params.id]
    );
    const counts = {};
    byFlag.forEach((r) => { counts[r.review_flag] = r.n; });
    res.json({ ...rows[0], byFlag: counts, flags: REVIEW_FLAGS });
  } catch (err) {
    console.error('studio/content/review-progress error:', err);
    res.status(500).json({ error: 'Failed to read review progress' });
  }
});


// Everything marked for removal, in one go.
//
// Marking is a keystroke made at speed; deleting is not, and putting the two a
// step apart is the whole reason 0 marks rather than deletes. This is that step:
// the pile has been seen, and now it goes.
router.post('/content/:id/delete-marked', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, r2_key FROM set_items WHERE set_id = $1 AND review_flag = 'remove'`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, deleted: 0 });
    }
    await client.query(`DELETE FROM set_items WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    await client.query('COMMIT');

    // Files go after the rows are safely gone. The other way round leaves a set
    // pointing at objects that are no longer there if the delete fails.
    const keys = rows.map((r) => r.r2_key).filter(Boolean);
    if (keys.length) deleteObjects(keys).catch((e) => console.error('r2 cleanup:', e.message));
    res.json({ ok: true, deleted: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/delete-marked error:', err);
    res.status(500).json({ error: 'Failed to remove the marked photos' });
  } finally {
    client.release();
  }
});


// ─────────────────────────────────────────────
// ARRANGING THE LIBRARY
// ─────────────────────────────────────────────
//
// Which order sets appear in, and which sit at the top whatever that order is.
//
// Two separate things deliberately. The sequence is the shape of the library —
// what follows what, how a visit reads. A pin is a temporary promotion that
// survives rearranging, so featuring this week's drop does not mean dragging it
// up and dragging it back afterwards.

const MAX_PINNED = 3;

router.post('/content/sets/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || !orderedIds.length) {
    return res.status(400).json({ error: 'An order is required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Written in one statement rather than a loop: a partial reorder would
    // leave the library in an order nobody chose.
    await client.query(
      `UPDATE sets AS s SET display_order = v.pos
         FROM (SELECT unnest($1::uuid[]) AS id,
                      generate_subscripts($1::uuid[], 1) AS pos) AS v
        WHERE s.id = v.id`,
      [orderedIds]
    );
    await client.query('COMMIT');
    res.json({ ok: true, ordered: orderedIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/sets/reorder error:', err);
    res.status(500).json({ error: 'Could not save that order' });
  } finally {
    client.release();
  }
});

router.post('/content/:id/pin', async (req, res) => {
  const { pinned } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: setRows } = await client.query(
      `SELECT id, is_collection, pinned_at FROM sets WHERE id = $1`, [req.params.id]
    );
    if (!setRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Set not found' });
    }

    if (pinned) {
      // Counted per library, and only against sets that are not this one, so
      // pinning something already pinned is not refused for being itself.
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM sets
          WHERE pinned_at IS NOT NULL AND is_collection = $1 AND id <> $2`,
        [setRows[0].is_collection, req.params.id]
      );
      if (countRows[0].n >= MAX_PINNED) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'TOO_MANY_PINNED',
          message: `Three sets are already pinned. Unpin one first.`,
        });
      }
    }

    // pinned_at doubles as the order among pins: most recently pinned first,
    // so promoting something puts it at the very top without further fiddling.
    const { rows } = await client.query(
      `UPDATE sets SET pinned_at = $1 WHERE id = $2 RETURNING id, pinned_at`,
      [pinned ? new Date() : null, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, set: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/pin error:', err);
    res.status(500).json({ error: 'Could not change that' });
  } finally {
    client.release();
  }
});

// Move a single item to a different tier. The whole-set category lock exists so a
// set is either tier-segmented or purchase-only; this respects that by refusing a
// change that would put the set on both sides at once.
router.patch('/content/item/:itemId', async (req, res) => {
  const { tierCategory } = req.body;
  if (!VALID_TIER_CATEGORIES.includes(tierCategory)) {
    return res.status(400).json({ error: 'Invalid tier category' });
  }
  try {
    const { rows: current } = await pool.query(
      `SELECT set_id, tier_category FROM set_items WHERE id = $1`, [req.params.itemId]
    );
    if (!current.length) return res.status(404).json({ error: 'Item not found' });
    const setId = current[0].set_id;

    const { rows: others } = await pool.query(
      `SELECT DISTINCT tier_category FROM set_items WHERE set_id = $1 AND id <> $2`,
      [setId, req.params.itemId]
    );
    // The same rule as the bulk move, and for a long time only fixed there.
    //
    // Written twice and corrected once: the bulk route learned that a draft is
    // exactly where the three kinds sit together, and this one — the route every
    // keystroke and every dropdown actually uses — kept refusing. Pressing 6 or
    // choosing Purchase-only returned 409 and changed nothing, quietly, because
    // the error appears in a banner above the fold of a long review.
    //
    // It holds for published sets, where it protects a member from finding part
    // of a set walled off. It has no business in a draft being sorted.
    const { rows: liveRows } = await pool.query(
      `SELECT visible FROM sets WHERE id = $1`, [setId]
    );
    const isLive = liveRows[0]?.visible === true;

    const movingToPurchase = tierCategory === 'purchase_only';
    const hasTiered  = others.some((o) => o.tier_category
      && !['purchase_only', 'collection'].includes(o.tier_category));
    const hasPurchase = others.some((o) => o.tier_category === 'purchase_only');
    if (isLive && ((movingToPurchase && hasTiered) || (!movingToPurchase && hasPurchase))) {
      return res.status(409).json({
        error: 'CATEGORY_LOCKED',
        message: 'A published set is either tier-segmented or purchase-only, never both. Move the other items first.',
      });
    }

    // Setting a tier is how a photo gets looked at now, so it counts as
    // reviewed and clears any earlier mark. Without this the unsorted count
    // never falls and the set can never be published.
    const { rows } = await pool.query(
      `UPDATE set_items
          SET tier_category = $1, reviewed_at = NOW(), review_flag = NULL
        WHERE id = $2 RETURNING *`,
      [tierCategory, req.params.itemId]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/content/item patch error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Moving many at once. Doing this as N single calls would be 200 round trips
// and 200 chances for one to fail halfway, leaving a set half re-tiered with no
// record of where it got to.
router.post('/content/items/move', async (req, res) => {
  const { itemIds, tierCategory } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) {
    return res.status(400).json({ error: 'Nothing selected' });
  }
  if (!VALID_TIER_CATEGORIES.includes(tierCategory)) {
    return res.status(400).json({ error: 'Invalid tier category' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: items } = await client.query(
      `SELECT id, set_id FROM set_items WHERE id = ANY($1) FOR UPDATE`, [itemIds]
    );
    if (!items.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Nothing found' }); }

    const setIds = [...new Set(items.map((i) => i.set_id))];
    if (setIds.length > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Those items are not all from the same set' });
    }
    const setId = setIds[0];

    // The whole-set lock is checked against the state the move would produce,
    // not the state before it — otherwise moving every item to purchase-only
    // one batch at a time would be blocked at the first batch.
    const { rows: rest } = await client.query(
      `SELECT DISTINCT tier_category FROM set_items WHERE set_id = $1 AND NOT (id = ANY($2))`,
      [setId, itemIds]
    );
    const after = new Set([...rest.map((r) => r.tier_category), tierCategory]);

    // The rule holds for what fans can see, not for what is still being sorted.
    //
    // A draft is exactly where the three kinds sit side by side: the whole
    // point of sorting one pile is that it holds tiered, purchase-only and
    // collection photographs at once, and the split separates them at the end.
    // Applied to a draft this would block the first keystroke of every sort.
    //
    // Published sets are checked as before, because there the rule is about
    // what a member is shown — a Supreme member who has paid for everything
    // should not find part of a set walled off from her.
    const { rows: liveRows } = await client.query(
      `SELECT visible FROM sets WHERE id = $1`, [setId]
    );
    const isLive = liveRows[0]?.visible === true;

    if (isLive && after.has('purchase_only') && after.size > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'CATEGORY_LOCKED',
        message: 'A published set is either tier-segmented or purchase-only, never both. Move the rest first.',
      });
    }

    const { rowCount } = await client.query(
      `UPDATE set_items SET tier_category = $1 WHERE id = ANY($2)`, [tierCategory, itemIds]
    );
    await client.query('COMMIT');
    res.json({ ok: true, moved: rowCount, tierCategory });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/items/move error:', err);
    res.status(500).json({ error: 'Could not move those items' });
  } finally { client.release(); }
});

// The whole set's order in one call. The client sends the sequence it is
// showing, so what Jinal arranged is exactly what gets stored — no merging of
// partial moves, no drift between what she sees and what a fan will.
// ─────────────────────────────────────────────
// COMMUNITY ACTIVITIES
// ─────────────────────────────────────────────

// A poll, pinned while it runs. Text options are words; image options are
// stored keys — the same mechanism either way, which is why one endpoint
// handles both.
router.post('/community/poll', async (req, res) => {
  const { question, optionKind = 'text', options, hours } = req.body;
  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!question?.trim()) return res.status(400).json({ error: 'A question is required' });
  if (list.length < 2)   return res.status(400).json({ error: 'At least two options' });
  if (list.length > 4)   return res.status(400).json({ error: 'Four options at most' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pinHours = hours || (await getConfigNumber('community_pin_hours').catch(() => 48));

    const { rows: post } = await client.query(
      `INSERT INTO community_posts (user_id, content, is_system, pinned, post_kind)
       VALUES ($1, $2, FALSE, TRUE, 'poll') RETURNING id`,
      [req.user.userId, question.trim()]
    );

    const { rows: poll } = await client.query(
      `INSERT INTO community_polls (post_id, question, option_kind, options, closes_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW() + ($5 || ' hours')::interval) RETURNING *`,
      [post[0].id, question.trim(), optionKind, JSON.stringify(list), String(pinHours)]
    );

    await client.query('COMMIT');
    res.json({ ok: true, poll: poll[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/community/poll error:', err);
    res.status(500).json({ error: 'Could not create the poll' });
  } finally { client.release(); }
});

// An hour of questions rather than a standing invitation. A window that is
// always open gets a trickle nobody sits down to answer; one that closes gets
// a burst worth answering in one go.
router.post('/community/question-window', async (req, res) => {
  const { prompt, hours = 1 } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'A prompt is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: post } = await client.query(
      `INSERT INTO community_posts (user_id, content, is_system, pinned, post_kind)
       VALUES ($1, $2, FALSE, TRUE, 'question_window') RETURNING id`,
      [req.user.userId, prompt.trim()]
    );
    const { rows: w } = await client.query(
      `INSERT INTO community_question_windows (post_id, prompt, closes_at)
       VALUES ($1, $2, NOW() + ($3 || ' hours')::interval) RETURNING *`,
      [post[0].id, prompt.trim(), String(hours)]
    );
    await client.query('COMMIT');
    res.json({ ok: true, window: w[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/community/question-window error:', err);
    res.status(500).json({ error: 'Could not open the window' });
  } finally { client.release(); }
});

// Speaking in the room from Studio. It is her own post, so it goes in exactly
// as one from the fan side would.
router.post('/community/post', async (req, res) => {
  const { content, parentId } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Say something first' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO community_posts (user_id, content, is_system, parent_id)
       VALUES ($1, $2, FALSE, $3) RETURNING *`,
      [req.user.userId, content.trim(), parentId || null]
    );
    res.json({ ok: true, post: rows[0] });
  } catch (err) {
    console.error('studio/community/post error:', err);
    res.status(500).json({ error: 'Could not post that' });
  }
});

// Pinning somebody else's message. Costs nothing to build and means a great
// deal to receive — being singled out by name in a room you share is worth more
// than most things that can be bought here.
router.post('/community/pin/:postId', async (req, res) => {
  const { pinned } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE community_posts SET pinned = $1 WHERE id = $2 AND removed = FALSE RETURNING id, pinned`,
      [pinned !== false, req.params.postId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true, pinned: rows[0].pinned });
  } catch (err) {
    console.error('studio/community/pin error:', err);
    res.status(500).json({ error: 'Could not pin that' });
  }
});

// ─────────────────────────────────────────────
// PHOTOGRAPHERS
// ─────────────────────────────────────────────

router.get('/photographers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.contact, p.active,
              (SELECT count(*)::int FROM set_photographers sp WHERE sp.photographer_id = p.id) AS sets
       FROM photographers p WHERE p.active = TRUE ORDER BY p.name`
    );
    res.json({ photographers: rows });
  } catch (err) {
    console.error('studio/photographers error:', err);
    res.status(500).json({ error: 'Failed to load photographers' });
  }
});

// Replaces a set's photographers with the names given. Sending an empty list
// clears them; sending undefined leaves them alone, so an edit that does not
// mention photographers cannot silently remove one.
async function setPhotographers(client, setId, names) {
  if (names === undefined) return;
  await client.query(`DELETE FROM set_photographers WHERE set_id = $1`, [setId]);
  const list = (Array.isArray(names) ? names : String(names).split(','))
    .map((n) => String(n).trim()).filter(Boolean);
  for (const name of list) {
    const id = await resolvePhotographer(client, name);
    if (id) {
      await client.query(
        `INSERT INTO set_photographers (set_id, photographer_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`, [setId, id]
      );
    }
  }
}

// Finds an existing photographer by name or creates one. Matching is
// case-insensitive so a name typed slightly differently does not become a
// second person with their own separate earnings.
async function resolvePhotographer(client, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const { rows: found } = await client.query(
    `SELECT id FROM photographers WHERE lower(name) = lower($1)`, [clean]
  );
  if (found.length) return found[0].id;
  const { rows } = await client.query(
    `INSERT INTO photographers (name) VALUES ($1) RETURNING id`, [clean]
  );
  return rows[0].id;
}

// What a photographer's work has been worth, and what has been paid so far.
//
// Two things count, and one deliberately does not:
//
//   Direct        purchased tokens spent unlocking the set. Money in.
//   Allowance     an unlock taken on a membership allowance is not free — the
//                 member paid for it as part of their fee. A share of that fee
//                 is attributed to it: 35% of the monthly cost is deemed to be
//                 for set access, divided by that tier's monthly allowance to
//                 give a fixed per-unlock value. A Supreme unlock is worth more
//                 than a Community one because Supreme paid more for it.
//   Gifted        excluded. Those tokens were Jinal's own gift; treating them
//                 as revenue would count the same money twice.
//
// Nothing here calculates what a photographer should receive. That is a token of
// appreciation Jinal decides at the time, looking at what the work actually did
// — not a rate applied to a number. The platform's job is to show the figure
// honestly and record what was sent.
router.get('/photographers/earnings', async (req, res) => {
  try {
    const { rows: cfgRows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key IN ('token_rate_inr', 'domestic_gst_rate_pct')`
    );
    const cfg = {};
    cfgRows.forEach((r) => { cfg[r.key] = parseFloat(r.value); });

    const tokenRate = cfg.token_rate_inr;
    if (Number.isNaN(tokenRate) || tokenRate === undefined) {
      return res.status(503).json({ error: 'Token rate is not configured' });
    }

    // Only what a set earned directly — tokens somebody actually spent to open
    // it. A membership unlock is not set revenue: the fan paid for access to the
    // platform, and that fee is the platform's. Attributing a slice of it here
    // meant inventing a per-unlock value, which needed an allowance to divide
    // by, which is why this once read a config key the ladder had retired and
    // quietly showed zero for everybody.
    //
    // Nothing here calculates what a photographer should receive. There is no
    // revenue-share agreement; they have been paid in full for the shoot. This
    // is a voluntary royalty Jinal decides at the time, and the only thing the
    // platform owes her is an honest figure for what each person's work brought
    // in directly.
    const gstPct = cfg.domestic_gst_rate_pct || 0;

    const { rows } = await pool.query(
      // Summed from the ledger by set rather than joined per grant. Joining
      // grants to ledger rows double-counts anyone holding both a tier and an
      // upsell grant for the same set, and attributes gifted spend as purchased.
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
         SELECT ag.set_id, COUNT(*)::int AS n
         FROM access_grants ag JOIN users u ON u.id = ag.user_id
         WHERE u.is_test = FALSE
         GROUP BY ag.set_id
       )
       SELECT p.id, p.name, p.contact,
              s.id AS set_id, s.title,
              COALESCE(sp.purchased_tokens, 0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)    AS gifted_tokens,
              COALESCE(u.n, 0)                 AS unlocks,
              -- How many people share this set. A shoot credited to two splits
              -- evenly between them.
              (SELECT count(*)::int FROM set_photographers x WHERE x.set_id = s.id) AS credited
       FROM photographers p
       JOIN set_photographers link ON link.photographer_id = p.id
       LEFT JOIN sets s     ON s.id = link.set_id
       LEFT JOIN spend sp   ON sp.set_id = s.id
       LEFT JOIN unlocks u  ON u.set_id  = s.id
       WHERE p.active = TRUE
       ORDER BY p.name, s.title`
    );

    // Membership unlocks, counted but never valued. How often a set is opened
    // on an allowance says something real about what resonates, so it is worth
    // showing — but the fee behind it is the platform's, not the set's, so no
    // rupee figure is attached to it.
    //
    // Joined through set_photographers, the same table the query above uses.
    // This once filtered on sets.photographer_id, a column left over from when
    // a set had one photographer and which nothing has written since — so it
    // matched nothing and excluded every row regardless.
    const { rows: creditRows } = await pool.query(
      `SELECT g.set_id, count(*)::int AS n
       FROM access_grants g
       JOIN users u ON u.id = g.user_id
       WHERE COALESCE(g.coins_paid, 0) = 0
         AND u.is_test = FALSE
         AND EXISTS (SELECT 1 FROM set_photographers sp WHERE sp.set_id = g.set_id)
       GROUP BY g.set_id`
    );
    const creditBySet = {};
    creditRows.forEach((r) => { creditBySet[r.set_id] = r.n; });

    const { rows: paid } = await pool.query(
      `SELECT photographer_id, COALESCE(SUM(amount_inr), 0) AS total FROM photographer_payments GROUP BY photographer_id`
    );
    const paidBy = {};
    paid.forEach((r) => { paidBy[r.photographer_id] = parseFloat(r.total); });

    const byId = {};
    for (const r of rows) {
      byId[r.id] ||= { id: r.id, name: r.name, contact: r.contact, sets: [], generatedInr: 0 };
      if (!r.set_id) continue;
      const creditUnlocks = creditBySet[r.set_id] || 0;

      // Purchased tokens are GST-inclusive, so the tax comes out first — it is
      // collected on the government's behalf, never earned, and sharing it out
      // would mean giving away money that was never ours.
      const share = Math.max(1, r.credited || 1);
      const totalInr = ((r.purchased_tokens * tokenRate) / (1 + gstPct / 100)) / share;

      byId[r.id].sets.push({
        setId: r.set_id, title: r.title,
        sharedWith: share > 1 ? share : null,
        unlocks: r.unlocks,
        purchasedTokens: r.purchased_tokens, giftedTokens: r.gifted_tokens,
        creditUnlocks,
        revenueInr: Math.round(totalInr * 100) / 100,
      });
      byId[r.id].generatedInr += totalInr;
    }

    // Sets nobody is credited on.
    //
    // Every set with a photographer appeared here; every set without one
    // appeared nowhere, so this page and the gallery's own earnings figure
    // disagreed by whatever those sets had brought in — with nothing on either
    // screen to say why. A photographer asking "is that all of it?" could not
    // be answered, which is the whole purpose of the page.
    //
    // Shown as an entry rather than folded into a total, because the useful
    // response is to credit the work, and that only happens if the gap is
    // visible and named.
    const { rows: orphanRows } = await pool.query(
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
         SELECT ag.set_id, COUNT(*)::int AS n
         FROM access_grants ag JOIN users u ON u.id = ag.user_id
         WHERE u.is_test = FALSE GROUP BY ag.set_id
       )
       SELECT s.id AS set_id, s.title,
              COALESCE(sp.purchased_tokens, 0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)    AS gifted_tokens,
              COALESCE(u.n, 0)                 AS unlocks
         FROM sets s
         LEFT JOIN spend sp  ON sp.set_id = s.id
         LEFT JOIN unlocks u ON u.set_id  = s.id
        WHERE NOT EXISTS (SELECT 1 FROM set_photographers sp2 WHERE sp2.set_id = s.id)
        ORDER BY s.title`
    );

    const orphanSets = orphanRows.map((r) => ({
      setId: r.set_id, title: r.title, sharedWith: null,
      unlocks: r.unlocks,
      purchasedTokens: r.purchased_tokens, giftedTokens: r.gifted_tokens,
      creditUnlocks: 0,
      revenueInr: Math.round(((r.purchased_tokens * tokenRate) / (1 + gstPct / 100)) * 100) / 100,
    }));
    const orphanTotal = orphanSets.reduce((a, x) => a + x.revenueInr, 0);

    const list = Object.values(byId).map((p) => ({
      ...p,
      generatedInr: Math.round(p.generatedInr * 100) / 100,
      paidInr: paidBy[p.id] || 0,
    })).sort((a, b) => b.generatedInr - a.generatedInr);

    if (orphanSets.length) {
      list.push({
        id: '__unattributed',
        name: 'Not credited to anyone',
        contact: null,
        unattributed: true,
        sets: orphanSets,
        generatedInr: Math.round(orphanTotal * 100) / 100,
        paidInr: 0,
      });
    }

    res.json({
      photographers: list,
      tokenRate,
      gstPct,
      totalGenerated: Math.round(list.reduce((s2, p) => s2 + p.generatedInr, 0) * 100) / 100,
      totalPaid: Math.round(list.reduce((s2, p) => s2 + p.paidInr, 0) * 100) / 100,
    });
  } catch (err) {
    console.error('studio/photographers/earnings error:', err);
    res.status(500).json({ error: 'Failed to work out earnings' });
  }
});

router.post('/photographers/:id/paid', async (req, res) => {
  const { amountInr, reference, note } = req.body;
  const amount = parseFloat(amountInr);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'An amount is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO photographer_payments (photographer_id, amount_inr, reference, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, amount, reference?.trim() || null, note?.trim() || null]
    );
    res.json({ ok: true, payment: rows[0] });
  } catch (err) {
    console.error('studio/photographers/paid error:', err);
    res.status(500).json({ error: 'Failed to record the payment' });
  }
});

router.get('/photographers/:id/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, amount_inr, reference, note, paid_at FROM photographer_payments
       WHERE photographer_id = $1 ORDER BY paid_at DESC`,
      [req.params.id]
    );
    res.json({ payments: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

// Who unlocked a set, when, and what it actually earned.
//
// "Revenue" needs care here. Three unlocks can look identical and be worth
// completely different things: one paid with purchased tokens is real money,
// one paid with gifted tokens is Jinal's own gift coming back to her, and one
// taken with a membership allowance cost nothing at all — its value is the
// membership, not the unlock. They are reported separately rather than summed
// into a single number that would flatter the total.
router.get('/content/:id/unlocks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.grant_type, g.coins_paid, g.scope, g.granted_at AS created_at,
              u.email, u.display_name, u.tier
       FROM access_grants g
       JOIN users u ON u.id = g.user_id
       WHERE g.set_id = $1
       ORDER BY g.granted_at DESC`,
      [req.params.id]
    );

    // Everyone who has opened it, whether or not anything was paid. A free set
    // has no unlocks at all, so views are the only thing that says whether it
    // was seen — and it is usually the most-seen thing posted.
    const { rows: viewRows } = await pool.query(
      `SELECT v.first_seen, u.email, u.display_name, u.tier
       FROM set_views v JOIN users u ON u.id = v.user_id
       WHERE v.set_id = $1 AND u.is_test = FALSE
       ORDER BY v.first_seen DESC`,
      [req.params.id]
    );

    // Totals come from the ledger, not from matching each grant to a ledger row
    // by timestamp. That matching was approximate and could pair a grant with
    // the wrong entry; the ledger summed by set is exact.
    const { rows: spendRows } = await pool.query(
      `SELECT COALESCE(SUM(from_purchased), 0)::int AS purchased,
              COALESCE(SUM(from_gifted), 0)::int    AS gifted
       FROM coin_ledger
       WHERE type = 'content_unlock' AND direction = 'debit' AND related_id = $1`,
      [req.params.id]
    );

    const rateRow = await pool.query(`SELECT value FROM platform_config WHERE key = 'token_rate_inr'`);
    const tokenRate = parseFloat(rateRow.rows[0]?.value) || 0;

    const totals = rows.reduce((t, r) => {
      const paid = Number(r.coins_paid) || 0;
      t.unlocks += 1;
      t.tokens  += paid;
      if (paid === 0) t.byAllowance += 1;
      return t;
    }, { unlocks: 0, tokens: 0, byAllowance: 0 });
    totals.fromPurchased = spendRows[0].purchased;
    totals.fromGifted    = spendRows[0].gifted;

    res.json({
      views: viewRows.map((v) => ({
        at: v.first_seen,
        who: v.display_name || v.email,
        tier: v.tier,
      })),
      unlocks: rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        who: r.display_name || r.email,
        email: r.email,
        tier: r.tier,
        scope: r.scope,
        tokens: Number(r.coins_paid) || 0,
        // An allowance unlock lapses with membership; a paid one is permanent.
        viaAllowance: (Number(r.coins_paid) || 0) === 0,
      })),
      totals: {
        ...totals,
        views: viewRows.length,
        // Only purchased tokens represent money that came in. Gifted tokens were
        // given away, so counting them as revenue would be counting it twice.
        revenueInr: Math.round(totals.fromPurchased * tokenRate * 100) / 100,
        tokenRate,
      },
    });
  } catch (err) {
    console.error('studio/content/unlocks error:', err);
    res.status(500).json({ error: 'Failed to load unlock history' });
  }
});

router.post('/content/items/reorder', async (req, res) => {
  const { setId, orderedIds } = req.body;
  if (!setId || !Array.isArray(orderedIds) || !orderedIds.length) {
    return res.status(400).json({ error: 'A set and an order are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Refuse a partial list rather than writing it. A truncated payload would
    // silently leave the tail of a 271-photo set on stale positions.
    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS n FROM set_items WHERE set_id = $1`, [setId]
    );
    if (countRows[0].n !== orderedIds.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `That order covers ${orderedIds.length} of ${countRows[0].n} items. Reload the set and try again.`,
      });
    }

    const { rowCount } = await client.query(
      `UPDATE set_items AS si SET position = v.pos
       FROM (SELECT id, ordinality - 1 AS pos
             FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)) AS v
       WHERE si.id = v.id AND si.set_id = $2`,
      [orderedIds, setId]
    );

    // The cover follows the first item, so arranging the set also chooses what
    // the gallery card shows.
    const { rows: first } = await client.query(
      `SELECT r2_key, media_type, type FROM set_items WHERE id = $1`, [orderedIds[0]]
    );
    if (first.length && first[0].media_type !== 'video' && first[0].type !== 'video') {
      await client.query(`UPDATE sets SET cover_key = $1 WHERE id = $2`, [first[0].r2_key, setId]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, reordered: rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/items/reorder error:', err);
    res.status(500).json({ error: 'Could not save the order' });
  } finally { client.release(); }
});

router.post('/content/items/delete', async (req, res) => {
  const { itemIds } = req.body;
  if (!Array.isArray(itemIds) || !itemIds.length) {
    return res.status(400).json({ error: 'Nothing selected' });
  }
  try {
    const { rows } = await pool.query(
      `DELETE FROM set_items WHERE id = ANY($1) RETURNING id, set_id, r2_key`, [itemIds]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nothing found' });

    const setId = rows[0].set_id;
    const keys  = rows.map((r) => r.r2_key);

    // Clear the cover if it was one of these, rather than leaving the set
    // showing a broken image.
    await pool.query(
      `UPDATE sets SET cover_key = NULL WHERE id = $1 AND cover_key = ANY($2)`, [setId, keys]
    );

    const { rows: remaining } = await pool.query(
      `SELECT count(*)::int AS n FROM set_items WHERE set_id = $1`, [setId]
    );

    // Storage last and unawaited — the rows are already gone, so a slow bucket
    // must not hold up the response.
    deleteObjects(keys).catch((e) => console.error('r2 cleanup:', e.message));

    res.json({ ok: true, deleted: rows.length, remaining: remaining[0].n });
  } catch (err) {
    console.error('studio/content/items/delete error:', err);
    res.status(500).json({ error: 'Could not delete those items' });
  }
});

router.delete('/content/item/:itemId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM set_items WHERE id = $1 RETURNING id, set_id, r2_key`, [req.params.itemId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });

    // If this was the set's cover, clear it rather than leave a broken image.
    await pool.query(
      `UPDATE sets SET cover_key = NULL WHERE id = $1 AND cover_key = $2`,
      [rows[0].set_id, rows[0].r2_key]
    );

    const { rows: remaining } = await pool.query(
      `SELECT count(*)::int AS n FROM set_items WHERE set_id = $1`, [rows[0].set_id]
    );

    // Storage is cleared only after the row is gone, so a failure here leaves an
    // unreferenced file rather than a broken image. Not awaited — the fan-facing
    // effect is already done, and R2 being slow should not hold up the response.
    deleteObjects([rows[0].r2_key]).catch((e) => console.error('r2 cleanup:', e.message));

    res.json({ ok: true, deleted: rows[0].id, remaining: remaining[0].n });
  } catch (err) {
    console.error('studio/content/item delete error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

router.post('/content/item', async (req, res) => {
  // No default tier. A photo arrives with none and gets one in the review, which
  // is what puts it in Unsorted rather than hiding it inside whichever tier the
  // upload happened to pick — a set could then look sorted while nothing had
  // been looked at.
  const { setId, type, r2Key, position, tierCategory = null } = req.body;
  if (!setId || !type || !r2Key) {
    return res.status(400).json({ error: 'setId, type and r2Key are required' });
  }
  if (tierCategory !== null && !VALID_TIER_CATEGORIES.includes(tierCategory)) {
    return res.status(400).json({ error: 'Invalid tier category' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO set_items (set_id, type, r2_key, position, media_type, tier_category, quality)
       VALUES ($1, $2, $3, $4, $2, $5, $6::jsonb) RETURNING *`,
      [setId, type, r2Key, position ?? 0, tierCategory,
       req.body.quality ? JSON.stringify(req.body.quality) : null]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/content/item error:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

router.patch('/content/:id', async (req, res) => {
  const { title, description, price_coins, visible, type, category, cover_key, cover_blur,
          cover_og_key, photographerName, photographerNames, removeMarked } = req.body;
  // Filled in only if publishing also removed the marked photos; cleared from
  // storage after the transaction commits.
  let pendingKeyCleanup = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT title, visible FROM sets WHERE id = $1`, [req.params.id]
    );
    const wasHidden       = currentRows[0] && !currentRows[0].visible;
    const becomingVisible = visible === true;

    // A set does not go out with flags still open. A flag means somebody marked
    // a photo as wanting a second look, and publishing over it makes the whole
    // exercise pointless — the queue exists to be emptied before an audience
    // sees the set, not to sit there afterwards.
    //
    // Clearing a flag is a decision rather than a chore: keep the photo, or
    // remove it. Either empties the queue. This only refuses; it never decides.
    if (becomingVisible && wasHidden) {
      // A collection set is bought whole, so its photos never get a tier and
      // there is nothing to be unsorted from. Counting them as unsorted would
      // mean such a set could never be published at all.
      const { rows: kindRows } = await client.query(
        `SELECT is_collection FROM sets WHERE id = $1`, [req.params.id]
      );
      const isCollectionSet = Boolean(kindRows[0]?.is_collection);

      // Unreviewed means different things in the two libraries. A gallery photo
      // is unsorted until it has a tier; a collection photo has no tier at all,
      // and is unreviewed until somebody has said keep or remove. Both are a
      // reason to wait before publishing.
      const { rows: pending } = await client.query(
        `SELECT count(*) FILTER (WHERE review_flag = 'remove')::int AS marked,
                CASE WHEN $2
                  THEN count(*) FILTER (WHERE reviewed_at IS NULL
                                          AND review_flag IS DISTINCT FROM 'remove')::int
                  ELSE count(*) FILTER (WHERE tier_category IS NULL
                                          AND review_flag IS DISTINCT FROM 'remove')::int
                END AS unsorted
           FROM set_items WHERE set_id = $1`,
        [req.params.id, isCollectionSet]
      );
      const { marked, unsorted } = pending[0];

      // Sorted, but not yet separated.
      //
      // A draft that still holds purchase-only or collection photographs has
      // been reviewed and not split, and publishing it now would put both in
      // front of members who should never see them there. Blocked with a count,
      // because the fix is one button away and the message should say so.
      // The same rule at the other door.
      //
      // The split refuses a free purchase-only or collection set, but a price
      // can also be edited to nothing afterwards, and publishing is the moment
      // that would matter. One guard is not a guard if there are two ways in.
      const { rows: kindCheck } = await client.query(
        `SELECT s.price_coins, s.is_collection,
                EXISTS (SELECT 1 FROM set_items i
                         WHERE i.set_id = s.id AND i.tier_category = 'purchase_only') AS has_purchase
           FROM sets s WHERE s.id = $1`,
        [req.params.id]
      );
      const k = kindCheck[0];
      if (k && (k.is_collection || k.has_purchase) && !(k.price_coins > 0)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'PRICE_REQUIRED',
          message: k.is_collection
            ? 'A collection set cannot be published free. Set a price first.'
            : 'A purchase-only set cannot be published free. Set a price first.',
        });
      }

      const { rows: awaiting } = await client.query(
        `SELECT count(*) FILTER (WHERE tier_category = 'purchase_only')::int AS purchase,
                count(*) FILTER (WHERE tier_category = 'collection')::int    AS collection
           FROM set_items
          WHERE set_id = $1 AND review_flag IS DISTINCT FROM 'remove'`,
        [req.params.id]
      );
      const waiting = awaiting[0];
      if (!isCollectionSet && (waiting.purchase > 0 && unsorted === 0 && marked >= 0)) {
        const alsoTiered = await client.query(
          `SELECT count(*)::int AS n FROM set_items
            WHERE set_id = $1 AND review_flag IS DISTINCT FROM 'remove'
              AND tier_category IS NOT NULL
              AND tier_category NOT IN ('purchase_only', 'collection')`,
          [req.params.id]
        );
        // Only a problem where the set holds more than one kind. A set that is
        // purely purchase-only is a finished set and publishes as it is.
        if (alsoTiered.rows[0].n > 0 || waiting.collection > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'NEEDS_SPLIT',
            message: `This holds ${waiting.purchase} purchase-only and ${waiting.collection} collection photographs alongside tiered ones. Separate them into their own sets first.`,
          });
        }
      }
      if (!isCollectionSet && waiting.collection > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'NEEDS_SPLIT',
          message: `${waiting.collection} photographs are marked for the private collection. Separate them into their own set first.`,
        });
      }

      // Unsorted photos are a hard stop. A photo nobody has looked at has no
      // tier, and publishing would put it in front of whoever the default
      // happens to suit — which is the one thing this review exists to prevent.
      if (unsorted > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'UNSORTED_ITEMS',
          message: `${unsorted} photo${unsorted === 1 ? ' has' : 's have'} no tier yet. Sort them before publishing.`,
          unsorted, marked,
        });
      }

      // Marked photos are not. The decision has been made — they are going —
      // and the only question is whether to do it now or look again first. So
      // ask, rather than refuse: removeMarked says the answer was to go ahead.
      if (marked > 0 && !removeMarked) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'MARKED_ITEMS',
          message: `${marked} photo${marked === 1 ? ' is' : 's are'} marked for removal.`,
          marked, unsorted: 0,
        });
      }

      if (marked > 0 && removeMarked) {
        const { rows: doomed } = await client.query(
          `SELECT id, r2_key FROM set_items WHERE set_id = $1 AND review_flag = 'remove'`,
          [req.params.id]
        );
        await client.query(`DELETE FROM set_items WHERE id = ANY($1::uuid[])`, [doomed.map((d) => d.id)]);
        // Files after the commit, below, so a slow bucket cannot leave rows
        // deleted and the publish rolled back.
        pendingKeyCleanup = doomed.map((d) => d.r2_key).filter(Boolean);
      }
    }

    const { rows } = await client.query(
      `UPDATE sets SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         price_coins = COALESCE($3, price_coins),
         visible     = COALESCE($4, visible),
         type        = COALESCE($5, type),
         category    = COALESCE($6, category),
         cover_key   = COALESCE($7, cover_key),
         cover_blur  = COALESCE($8, cover_blur),
         cover_og_key = COALESCE($9, cover_og_key),
         published_at = CASE WHEN $4 = TRUE AND published_at IS NULL THEN NOW() ELSE published_at END
       WHERE id = $10 RETURNING *`,
      [title, description, price_coins, visible, type, category, cover_key, cover_blur || null,
       cover_og_key || null, req.params.id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Set not found' }); }

    await setPhotographers(client, req.params.id, photographerNames ?? photographerName);

    await client.query('COMMIT');

    // Storage only after the rows are safely gone. The other way round would
    // leave a published set pointing at files that no longer exist if the
    // publish itself failed.
    if (pendingKeyCleanup.length) {
      deleteObjects(pendingKeyCleanup).catch((e) => console.error('r2 cleanup:', e.message));
    }

    if (wasHidden && becomingVisible) {
      postSystemMessage(`📸 Jinal just dropped "${rows[0].title}"! Check the Gallery!`, { kind: 'news' });
    }

    res.json({ ok: true, set: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content patch error:', err);
    res.status(500).json({ error: 'Failed to update content' });
  } finally {
    client.release();
  }
});

router.post('/content/:id/delete', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query(
      `SELECT r2_key FROM set_items WHERE set_id = $1`, [id]
    );
    const { rows: coverRows } = await client.query(
      `SELECT cover_key FROM sets WHERE id = $1`, [id]
    );
    await client.query(`DELETE FROM set_items WHERE set_id = $1`, [id]);
    await client.query(`DELETE FROM access_grants WHERE set_id = $1`, [id]);
    await client.query(`DELETE FROM sets WHERE id = $1`, [id]);
    await client.query('COMMIT');

    // Only once the transaction has committed — if it had rolled back, the files
    // would still be needed.
    deleteObjects([...items.map((i) => i.r2_key), coverRows[0]?.cover_key])
      .catch((e) => console.error('r2 cleanup:', e.message));

    res.json({ ok: true, deletedItems: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/content/delete error:', err);
    res.status(500).json({ error: 'Failed to delete set' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// SELFIE OF THE DAY
// ─────────────────────────────────────────────

router.get('/selfies', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.image_key, s.caption, s.selfie_date, s.visible, s.created_at,
              (SELECT count(*)::int FROM selfie_unlocks u WHERE u.selfie_id = s.id) AS unlocks
       FROM daily_selfies s ORDER BY s.selfie_date DESC LIMIT 120`
    );
    // A pass is active while it still has posts left to cover, so it is measured
    // against the latest selfie rather than a date.
    const { rows: passes } = await pool.query(
      `SELECT count(*)::int AS active FROM selfie_passes
       WHERE to_seq > (SELECT COALESCE(MAX(seq), 0) FROM daily_selfies WHERE visible = TRUE)`
    );
    res.json({ selfies: rows, activePasses: passes[0].active });
  } catch (err) {
    console.error('studio/selfies error:', err);
    res.status(500).json({ error: 'Failed to load selfies' });
  }
});

router.post('/selfies', async (req, res) => {
  const { imageKey, caption, selfieDate } = req.body;
  if (!imageKey) return res.status(400).json({ error: 'An image is required' });

  const date = selfieDate || new Date().toISOString().slice(0, 10);
  try {
    // One per day, so the date is a reliable identifier and there is never an
    // ambiguous "which selfie was the 3rd of August".
    const { rows: clash } = await pool.query(
      `SELECT id FROM daily_selfies WHERE selfie_date = $1`, [date]
    );
    if (clash.length) {
      return res.status(409).json({ error: `There is already a selfie for ${date}. Delete it first, or pick another date.` });
    }

    const { rows } = await pool.query(
      `INSERT INTO daily_selfies (image_key, caption, selfie_date, visible)
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [imageKey, caption?.trim() || null, date]
    );
    res.json({ ok: true, selfie: rows[0] });

    postSystemMessage('📸 A new selfie is up.');
  } catch (err) {
    console.error('studio/selfies create error:', err);
    res.status(500).json({ error: 'Failed to post the selfie' });
  }
});

router.patch('/selfies/:id', async (req, res) => {
  const { caption, visible } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE daily_selfies SET caption = COALESCE($1, caption), visible = COALESCE($2, visible)
       WHERE id = $3 RETURNING *`,
      [caption === undefined ? null : caption, visible, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, selfie: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.delete('/selfies/:id', async (req, res) => {
  try {
    // Refuse rather than take back something people paid for. Hiding it is the
    // reversible option and is offered in the same breath.
    const { rows: paid } = await pool.query(
      `SELECT count(*)::int AS n FROM selfie_unlocks WHERE selfie_id = $1`, [req.params.id]
    );
    if (paid[0].n > 0) {
      return res.status(409).json({
        error: `${paid[0].n} ${paid[0].n === 1 ? 'person has' : 'people have'} paid to unlock this. Hide it instead — they keep what they bought.`,
      });
    }
    const { rows } = await pool.query(
      `DELETE FROM daily_selfies WHERE id = $1 RETURNING image_key`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    deleteObjects([rows[0].image_key]).catch((e) => console.error('r2 cleanup:', e.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('studio/selfies delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ─────────────────────────────────────────────
// FULFILMENT — Qikink
// ─────────────────────────────────────────────

// Authenticates and returns nothing else. Enough to prove the credentials and
// the base URL are right, without creating anything that would need cancelling.
router.get('/fulfilment/ping', async (req, res) => {
  try {
    const { ping, BASE } = require('../lib/qikink');
    const missing = ['QIKINK_CLIENT_ID', 'QIKINK_CLIENT_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) {
      return res.status(503).json({ error: `Not configured: ${missing.join(', ')} missing from the backend service` });
    }
    const result = await ping();
    res.json({
      ok: true,
      environment: /sandbox/i.test(BASE) ? 'sandbox' : 'live',
      base: BASE,
      tokenLength: result.tokenLength,
      tokenValidForMinutes: Math.round(result.expiresInMs / 60000),
    });
  } catch (err) {
    // The message matters here — a 401 means wrong credentials, a network error
    // means the wrong base URL, and those need different fixes.
    console.error('qikink ping failed:', err.message);
    res.status(502).json({ error: err.message, status: err.status || null });
  }
});

// ─────────────────────────────────────────────
// STORAGE HOUSEKEEPING
// ─────────────────────────────────────────────

// Reports what is in the bucket but referenced by nothing. Read-only — deleting
// is a separate, deliberate call, because a mistake here destroys originals.
router.get('/storage/orphans', async (req, res) => {
  try {
    const report = await findOrphans({ minAgeHours: 24 });

    // Grouped by where the file came from — background, chat_media, content and
    // so on. A filename list is useless at this size; knowing that most of the
    // waste is replaced chat backgrounds versus failed content uploads is not.
    const byPrefix = {};
    report.orphans.forEach((o) => {
      const p = o.key.includes('/') ? o.key.split('/')[0] : 'other';
      byPrefix[p] ||= { prefix: p, count: 0, bytes: 0 };
      byPrefix[p].count += 1;
      byPrefix[p].bytes += o.sizeMB * 1048576;
    });

    res.json({
      totalObjects: report.totalObjects,
      referenced:   report.referenced,
      recentSkipped: report.recentSkipped,
      orphanCount:  report.orphans.length,
      orphanMB:     +(report.orphanBytes / 1048576).toFixed(1),
      byPrefix: Object.values(byPrefix)
        .map((g) => ({ prefix: g.prefix, count: g.count, mb: +(g.bytes / 1048576).toFixed(1) }))
        .sort((a, b) => b.count - a.count),
      orphans: report.orphans.slice(0, 50),
    });
  } catch (err) {
    if (err.code === 'UNCOVERED_REFERENCES') {
      return res.status(409).json({ error: err.message });
    }
    console.error('studio/storage/orphans error:', err);
    res.status(500).json({ error: 'Failed to scan storage' });
  }
});

router.post('/storage/orphans/purge', async (req, res) => {
  const { prefixes } = req.body;
  try {
    // Re-scanned rather than trusting a list the browser sends back. Between the
    // scan and the click a set could have been created referencing one of these,
    // and acting on a stale list would delete a file that is now in use.
    const report = await findOrphans({ minAgeHours: 24 });

    // Cleared one category at a time. The categories differ in how confident we
    // can be about them — stranded gallery uploads are plainly waste, while
    // replaced portfolio images are public marketing files worth a second look.
    // Lumping them into one button forces an all-or-nothing decision.
    const wanted = Array.isArray(prefixes) && prefixes.length ? new Set(prefixes) : null;
    const target = wanted
      ? report.orphans.filter((o) => wanted.has(o.key.includes('/') ? o.key.split('/')[0] : 'other'))
      : report.orphans;

    if (!target.length) return res.json({ ok: true, deleted: 0, message: 'Nothing to clean up.' });

    const bytes = target.reduce((s2, o) => s2 + o.sizeMB * 1048576, 0);
    const result = await deleteObjects(target.map((o) => o.key));
    res.json({
      ok: true,
      ...result,
      freedMB: +(bytes / 1048576).toFixed(1),
      message: `Removed ${result.deleted} unused file${result.deleted === 1 ? '' : 's'}, freeing ${(bytes / 1048576).toFixed(1)} MB.`,
    });
  } catch (err) {
    if (err.code === 'UNCOVERED_REFERENCES') {
      return res.status(409).json({ error: err.message });
    }
    console.error('studio/storage/purge error:', err);
    res.status(500).json({ error: 'Failed to remove unused files' });
  }
});

// ─────────────────────────────────────────────
// MERCHANDISE
// ─────────────────────────────────────────────

// Replaces an item's photo set wholesale. The first image is also written back to
// merchandise.img_key as the cover, so anything still reading that single column
// keeps working rather than silently losing the picture.
async function setMerchImages(client, merchId, urls) {
  await client.query(`DELETE FROM merchandise_images WHERE merch_id = $1`, [merchId]);
  const clean = (urls || []).filter(Boolean);
  for (let i = 0; i < clean.length; i++) {
    await client.query(
      `INSERT INTO merchandise_images (merch_id, url, position) VALUES ($1, $2, $3)`,
      [merchId, clean[i], i]
    );
  }
  await client.query(`UPDATE merchandise SET img_key = $1 WHERE id = $2`, [clean[0] || null, merchId]);
  return clean;
}

async function attachImages(items) {
  if (!items.length) return items;
  const { rows } = await pool.query(
    `SELECT merch_id, url FROM merchandise_images
     WHERE merch_id = ANY($1) ORDER BY merch_id, position ASC`,
    [items.map((i) => i.id)]
  );
  const byItem = {};
  rows.forEach((r) => { (byItem[r.merch_id] ||= []).push(r.url); });
  return items.map((i) => ({ ...i, images: byItem[i.id] || (i.img_key ? [i.img_key] : []) }));
}

router.get('/merch', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM merchandise ORDER BY created_at DESC`);
    res.json({ items: await attachImages(rows) });
  } catch (err) {
    console.error('studio/merch error:', err);
    res.status(500).json({ error: 'Failed to load merchandise' });
  }
});

router.post('/merch', async (req, res) => {
  const { title, description, price_coins, total_stock, visible = false, img_key,
          is_auction_item = false, csr_pct, images } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!price_coins)   return res.status(400).json({ error: 'Price is required' });

  const isAuction = !!is_auction_item;
  // One-of-one by definition, so stock is fixed at 1 and never asked for.
  const stock = isAuction ? 1 : parseInt(total_stock);
  if (!isAuction && !stock) return res.status(400).json({ error: 'Stock quantity is required' });

  const csr = isAuction ? parseFloat(csr_pct) : null;
  if (isAuction && (Number.isNaN(csr) || csr < 0 || csr > 100)) {
    return res.status(400).json({ error: 'Charity percentage must be between 0 and 100' });
  }

  const photoList = Array.isArray(images) && images.length ? images : (img_key ? [img_key] : []);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO merchandise
         (title, description, price_coins, total_stock, remaining, visible, img_key,
          is_auction_item, csr_pct, auction_status)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title.trim(), description || '', price_coins, stock, visible, photoList[0] || null,
       isAuction, csr, isAuction ? 'queued' : null]
    );
    await setMerchImages(client, rows[0].id, photoList);
    await client.query('COMMIT');
    if (visible && !isAuction) {
      postSystemMessage(`🛍️ Jinal just dropped "${title.trim()}"! Check the Shop!`, { kind: 'news' });
    }
    if (visible && isAuction) {
      postSystemMessage(`👗 A new Shoot Wardrobe piece just joined the queue: "${title.trim()}"`, { kind: 'news' });
    }
    res.json({ ok: true, item: { ...rows[0], img_key: photoList[0] || null, images: photoList } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/merch create error:', err);
    res.status(500).json({ error: 'Failed to create merchandise' });
  } finally {
    client.release();
  }
});

router.patch('/merch/:id', async (req, res) => {
  const { title, description, price_coins, remaining, visible, img_key, csr_pct, images } = req.body;
  try {
    const { rows: currentRows } = await pool.query(
      `SELECT title, visible FROM merchandise WHERE id = $1`, [req.params.id]
    );
    const wasHidden       = currentRows[0] && !currentRows[0].visible;
    const becomingVisible = visible === true;

    const { rows } = await pool.query(
      `UPDATE merchandise SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         price_coins = COALESCE($3, price_coins),
         remaining   = COALESCE($4, remaining),
         visible     = COALESCE($5, visible),
         img_key     = COALESCE($6, img_key),
         csr_pct     = COALESCE($7, csr_pct)
       WHERE id = $8 RETURNING *`,
      [title, description, price_coins, remaining, visible, img_key,
       csr_pct === undefined || csr_pct === '' ? null : parseFloat(csr_pct), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });

    let photoList = null;
    if (Array.isArray(images)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        photoList = await setMerchImages(client, req.params.id, images);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    if (wasHidden && becomingVisible) {
      postSystemMessage(`🛍️ Jinal just dropped new merch: "${rows[0].title}"! Check the Shop!`, { kind: 'news' });
    }

    const [withImages] = await attachImages([
      photoList ? { ...rows[0], img_key: photoList[0] || null } : rows[0],
    ]);
    res.json({ ok: true, item: withImages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update merchandise' });
  }
});

// ─────────────────────────────────────────────
// BONUS OFFERS
// ─────────────────────────────────────────────

// Everything that has run, with what it actually did. A promotion is only worth
// repeating if you can see whether it moved anything, and that means the money
// taken during it, not just how many people used it.
router.get('/bonus-offers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              (o.ends_at > NOW() AND o.starts_at <= NOW() AND o.active) AS running,
              COALESCE((SELECT SUM(l.amount) FROM coin_ledger l
                        WHERE l.bonus_offer_id = o.id), 0)::int AS bonus_given,
              COALESCE((SELECT SUM(r.payment_amount_inr) FROM coin_ledger r
                        WHERE r.type = 'recharge' AND r.direction = 'credit'
                          AND r.created_at BETWEEN o.starts_at AND LEAST(o.ends_at, NOW())), 0) AS inr_during
       FROM bonus_offers o
       ORDER BY o.starts_at DESC LIMIT 40`
    );
    res.json({
      offers: rows.map((o) => ({
        id: o.id, code: o.code, bonusPct: parseFloat(o.bonus_pct), label: o.label,
        startsAt: o.starts_at, endsAt: o.ends_at, minTokens: o.min_tokens,
        maxUses: o.max_uses, uses: o.uses, active: o.active, running: o.running,
        bonusGiven: Number(o.bonus_given),
        inrDuring: Math.round(Number(o.inr_during)),
      })),
    });
  } catch (err) {
    console.error('studio/bonus-offers error:', err);
    res.status(500).json({ error: 'Failed to load offers' });
  }
});

router.post('/bonus-offers', async (req, res) => {
  const { bonusPct, hours, endsAt, code, label, minTokens, maxUses } = req.body;
  const pct = parseFloat(bonusPct);

  if (Number.isNaN(pct) || pct < 5 || pct > 100) {
    return res.status(400).json({ error: 'A bonus is between 5% and 100%' });
  }

  // An end time, not a duration -- decided when she starts it, so it cannot
  // drift and everybody sees the same deadline.
  const ends = endsAt ? new Date(endsAt) : new Date(Date.now() + (parseFloat(hours) || 4) * 3600000);
  if (!(ends > new Date())) return res.status(400).json({ error: 'That end time has already passed' });

  try {
    // One sitewide offer at a time. Two would leave the platform picking
    // between them, and whichever it picked would be the wrong one to explain.
    if (!code) {
      const { rows: clash } = await pool.query(
        `SELECT id FROM bonus_offers
         WHERE active = TRUE AND code IS NULL AND ends_at > NOW() AND starts_at <= NOW()`
      );
      if (clash.length) {
        return res.status(409).json({
          error: 'A sitewide offer is already running. End it first, or give this one a code.',
        });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO bonus_offers (code, bonus_pct, label, ends_at, min_tokens, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code?.trim().toUpperCase() || null, pct, label?.trim() || null,
       ends.toISOString(), parseInt(minTokens, 10) || 0,
       maxUses ? parseInt(maxUses, 10) : null]
    );

    // Told to everyone, because an offer nobody knows about is not an offer.
    // Only for a sitewide one -- a code is for the people given it.
    if (!code) {
      postSystemMessage(
        `\u2728 ${label?.trim() || `${pct}% bonus tokens`} — on every top up, for a limited time.`,
        { kind: 'news' }
      );
    }

    res.json({ ok: true, offer: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That code already exists' });
    }
    console.error('studio/bonus-offers create error:', err);
    res.status(500).json({ error: 'Could not start the offer' });
  }
});

// Ends it now rather than deleting it, so what it did stays on the record.
router.post('/bonus-offers/:id/end', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE bonus_offers SET active = FALSE, ends_at = LEAST(ends_at, NOW())
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Offer not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('studio/bonus-offers end error:', err);
    res.status(500).json({ error: 'Could not end that offer' });
  }
});

// ─────────────────────────────────────────────
// MERCH MEDIA LIBRARY
// ─────────────────────────────────────────────

// Photos uploaded ahead of the listings that will use them.
//
// Paginated rather than infinite — a page you can link to is a page you can
// come back to, which matters when the job is matching a hundred descriptions
// to a hundred photographs over more than one sitting.
router.get('/merch/media', async (req, res) => {
  const perPage = 20;
  const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
  const unattachedOnly = req.query.unattached === '1' || req.query.unattached === 'true';

  try {
    // Attached means the file is referenced by a listing. Checked against the
    // images table rather than a flag on the row, so it stays true even if a
    // photo is attached by some other route.
    const attachedClause = `EXISTS (SELECT 1 FROM merchandise_images mi WHERE mi.url = m.r2_key)`;
    const where = unattachedOnly ? `WHERE NOT ${attachedClause}` : '';

    const { rows } = await pool.query(
      `SELECT m.id, m.r2_key, m.original_filename, m.width, m.height, m.bytes, m.uploaded_at,
              regexp_replace(m.r2_key, '^.*/([^/.]+)\\.[^.]+$', '\\1') AS file_uuid,
              ${attachedClause} AS attached,
              (SELECT mi2.merch_id FROM merchandise_images mi2 WHERE mi2.url = m.r2_key LIMIT 1) AS merch_id,
              (SELECT mm.title FROM merchandise_images mi3
                 JOIN merchandise mm ON mm.id = mi3.merch_id
                 WHERE mi3.url = m.r2_key LIMIT 1) AS merch_title
       FROM merch_media m
       ${where}
       ORDER BY m.uploaded_at DESC
       LIMIT $1 OFFSET $2`,
      [perPage, (page - 1) * perPage]
    );

    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE NOT ${attachedClause})::int AS unattached
       FROM merch_media m`
    );

    res.json({
      media: rows,
      page,
      perPage,
      total:      countRows[0].total,
      unattached: countRows[0].unattached,
      totalPages: Math.max(1, Math.ceil((unattachedOnly ? countRows[0].unattached : countRows[0].total) / perPage)),
    });
  } catch (err) {
    console.error('studio/merch/media error:', err);
    res.status(500).json({ error: 'Failed to load the media library' });
  }
});

// Recorded after the file itself is in storage. Several at once, because a
// hundred separate calls is a hundred chances for one to fail unnoticed.
router.post('/merch/media', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Nothing to record' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const it of items) {
      if (!it.r2Key) continue;
      const { rows } = await client.query(
        `INSERT INTO merch_media (r2_key, original_filename, width, height, bytes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [it.r2Key, it.originalFilename || null, it.width || null, it.height || null, it.bytes || null]
      );
      saved.push(rows[0]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, saved: saved.length, media: saved });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/merch/media create error:', err);
    res.status(500).json({ error: 'Could not record those uploads' });
  } finally { client.release(); }
});

// Removing a photo from the library. Refused if a listing is using it — the
// file would vanish from a live product page, and the listing would have no way
// to say what happened.
router.delete('/merch/media/:id', async (req, res) => {
  try {
    const { rows: found } = await pool.query(
      `SELECT r2_key FROM merch_media WHERE id = $1`, [req.params.id]
    );
    if (!found.length) return res.status(404).json({ error: 'Not found' });

    const { rows: used } = await pool.query(
      `SELECT mm.title FROM merchandise_images mi
       JOIN merchandise mm ON mm.id = mi.merch_id
       WHERE mi.url = $1 LIMIT 1`,
      [found[0].r2_key]
    );
    if (used.length) {
      return res.status(409).json({ error: `That photo is being used by "${used[0].title}". Remove it from the listing first.` });
    }

    await pool.query(`DELETE FROM merch_media WHERE id = $1`, [req.params.id]);
    deleteObjects([found[0].r2_key]).catch((e) => console.error('r2 cleanup:', e.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('studio/merch/media delete error:', err);
    res.status(500).json({ error: 'Could not remove that' });
  }
});

// ─────────────────────────────────────────────
// AUCTION FULFILMENT
// ─────────────────────────────────────────────

// Everything sold from the Shoot Wardrobe, with who bought it, where it goes, and
// which charity is owed a share — the working list for actually shipping and donating.
router.get('/auction/fulfilment', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.img_key, m.price_coins, m.sold_price_coins, m.sold_via,
              m.csr_pct, m.charity_key, m.display_winner_name, m.donation_confirmed_at,
              m.won_at, m.auction_status,
              u.email, u.display_name,
              o.id AS order_id, o.shipping_address, o.coins_charged, o.created_at AS ordered_at
       FROM merchandise m
       LEFT JOIN users u ON u.id = m.winner_id
       LEFT JOIN orders o ON o.merch_id = m.id AND o.user_id = m.winner_id
       WHERE m.is_auction_item = TRUE AND m.auction_status = 'sold'
       ORDER BY o.created_at DESC NULLS LAST`
    );
    res.json({ sales: rows });
  } catch (err) {
    console.error('studio/auction/fulfilment error:', err);
    res.status(500).json({ error: 'Failed to load fulfilment queue' });
  }
});

// Records that the donation for a sale has actually been made.
router.post('/auction/:id/donation-confirmed', async (req, res) => {
  const { reference } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE merchandise
       SET donation_confirmed_at = NOW(),
           donation_reference = COALESCE($1, donation_reference)
       WHERE id = $2 AND is_auction_item = TRUE RETURNING id, title, donation_confirmed_at`,
      [reference?.trim() || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Sale not found' });
    res.json({ ok: true, sale: rows[0] });
  } catch (err) {
    console.error('studio/auction/donation error:', err);
    res.status(500).json({ error: 'Failed to record donation' });
  }
});

// ─────────────────────────────────────────────
// DONATIONS — monthly reconciliation
// ─────────────────────────────────────────────

const CHARITY_NAMES = {
  cry:                   'CRY — Child Rights and You',
  akshaya_patra:         'Akshaya Patra Foundation',
  smile_foundation:      'Smile Foundation',
  pmnrf:                 "Prime Minister's National Relief Fund",
  national_defence_fund: 'National Defence Fund',
};

// What is owed, to whom, for which month.
//
// The donation is worked out on the value of the goods, not the sticker price:
// token prices include GST, so the tax is stripped first and the item's own
// percentage applied to what remains. The handling fee never enters this — it is
// cost recovery, not proceeds — and sold_price_coins already excludes it.
//
// The list token rate is used deliberately, not the discounted rate a fan may
// have paid in a bulk recharge. It is simpler to explain publicly and errs
// slightly in the charities' favour, which is the right way to be wrong.
router.get('/donations', async (req, res) => {
  try {
    const [rateRow, gstRow] = await Promise.all([
      pool.query(`SELECT value FROM platform_config WHERE key = 'token_rate_inr'`),
      pool.query(`SELECT value FROM platform_config WHERE key = 'domestic_gst_rate_pct'`),
    ]);
    const tokenRate = parseFloat(rateRow.rows[0]?.value);
    const gstPct    = parseFloat(gstRow.rows[0]?.value);
    if (Number.isNaN(tokenRate) || Number.isNaN(gstPct)) {
      return res.status(503).json({ error: 'Token rate or GST rate is not configured' });
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.sold_price_coins, m.csr_pct, m.charity_key,
              m.donation_confirmed_at, m.donation_reference, m.display_winner_name,
              u.display_name, u.email,
              COALESCE(o.created_at, m.won_at) AS sold_at
       FROM merchandise m
       LEFT JOIN users u ON u.id = m.winner_id
       LEFT JOIN orders o ON o.merch_id = m.id AND o.user_id = m.winner_id
       WHERE m.is_auction_item = TRUE AND m.auction_status = 'sold'
         AND m.csr_pct IS NOT NULL AND m.sold_price_coins IS NOT NULL
       ORDER BY COALESCE(o.created_at, m.won_at) DESC`
    );

    const months = {};
    let outstandingTotal = 0;
    let settledTotal     = 0;

    for (const r of rows) {
      const soldAt   = r.sold_at ? new Date(r.sold_at) : new Date();
      const monthKey = `${soldAt.getFullYear()}-${String(soldAt.getMonth() + 1).padStart(2, '0')}`;
      const grossInr = r.sold_price_coins * tokenRate;
      const exGst    = grossInr / (1 + gstPct / 100);
      const donation = Math.round(exGst * (parseFloat(r.csr_pct) / 100) * 100) / 100;
      const settled  = !!r.donation_confirmed_at;

      months[monthKey] ||= {
        month: monthKey,
        label: soldAt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        charities: {}, outstanding: 0, settled: 0, salesCount: 0,
      };
      const M = months[monthKey];
      M.salesCount += 1;
      if (settled) { M.settled += donation; settledTotal += donation; }
      else         { M.outstanding += donation; outstandingTotal += donation; }

      const key = r.charity_key || 'unassigned';
      M.charities[key] ||= { key, name: CHARITY_NAMES[key] || 'Not yet chosen', outstanding: 0, settled: 0, sales: [] };
      const CH = M.charities[key];
      if (settled) CH.settled += donation; else CH.outstanding += donation;
      CH.sales.push({
        id: r.id, title: r.title, soldPriceCoins: r.sold_price_coins,
        csrPct: parseFloat(r.csr_pct), grossInr: Math.round(grossInr * 100) / 100,
        exGstInr: Math.round(exGst * 100) / 100, donationInr: donation,
        settled, reference: r.donation_reference,
        confirmedAt: r.donation_confirmed_at,
        buyer: r.display_winner_name ? (r.display_name || r.email) : null,
        soldAt: r.sold_at,
      });
    }

    const list = Object.values(months)
      .map((m) => ({
        ...m,
        outstanding: Math.round(m.outstanding * 100) / 100,
        settled:     Math.round(m.settled * 100) / 100,
        charities:   Object.values(m.charities).map((c) => ({
          ...c,
          outstanding: Math.round(c.outstanding * 100) / 100,
          settled:     Math.round(c.settled * 100) / 100,
        })),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      months: list,
      tokenRate, gstPct,
      outstandingTotal: Math.round(outstandingTotal * 100) / 100,
      settledTotal:     Math.round(settledTotal * 100) / 100,
    });
  } catch (err) {
    console.error('studio/donations error:', err);
    res.status(500).json({ error: 'Failed to build the donation summary' });
  }
});

// Posts a summary to the community. Deliberately takes the finished text rather
// than generating it here — this is a public statement about money, and it can
// not be unsent, so Jinal reads and edits it before it goes out.
router.post('/donations/publish', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Nothing to publish' });
  try {
    await postSystemMessage(content.trim());
    res.json({ ok: true, message: 'Posted to the community.' });
  } catch (err) {
    console.error('studio/donations/publish error:', err);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// ─────────────────────────────────────────────
// EXTRAS (personalised request catalog)
// ─────────────────────────────────────────────

router.get('/extras', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM extras_items ORDER BY created_at DESC`);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load extras' });
  }
});

router.post('/extras', async (req, res) => {
  const { title, price_coins, visible = false } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!price_coins)   return res.status(400).json({ error: 'Price is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO extras_items (title, price_coins, visible)
       VALUES ($1, $2, $3) RETURNING *`,
      [title.trim(), price_coins, visible]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/extras error:', err);
    res.status(500).json({ error: 'Failed to create extra' });
  }
});

router.patch('/extras/:id', async (req, res) => {
  const { title, price_coins, visible } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE extras_items SET
         title       = COALESCE($1, title),
         price_coins = COALESCE($2, price_coins),
         visible     = COALESCE($3, visible)
       WHERE id = $4 RETURNING *`,
      [title, price_coins, visible, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/extras patch error:', err);
    res.status(500).json({ error: 'Failed to update extra' });
  }
});

// ─────────────────────────────────────────────
// CALL AVAILABILITY
// ─────────────────────────────────────────────

router.get('/availability', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM call_availability ORDER BY start_date ASC`);
    res.json({ slots: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

router.post('/availability', async (req, res) => {
  const { type, start_date, end_date, start_time, end_time, multiplier, note } = req.body;
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'Type, start_date and end_date are required' });
  if (!['unavailable', 'primetime'].includes(type)) return res.status(400).json({ error: 'Type must be unavailable or primetime' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO call_availability (type, start_date, end_date, start_time, end_time, multiplier, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [type, start_date, end_date, start_time || null, end_time || null, multiplier || 1.0, note || null]
    );
    res.json({ ok: true, slot: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create availability slot' });
  }
});

router.delete('/availability/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM call_availability WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete slot' });
  }
});

// ─────────────────────────────────────────────
// CALLS & REQUESTS
// ─────────────────────────────────────────────

// Just enough to know whether the phone should be ringing. Polled every few
// seconds from every Studio screen, so it returns one small row rather than the
// whole call list.
router.get('/calls/ringing', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.id, cr.call_type, cr.coins_per_min, cr.coins_charged, cr.created_at,
              u.display_name, u.email, u.tier
       FROM call_requests cr JOIN users u ON u.id = cr.user_id
       WHERE cr.status = 'ringing'
       ORDER BY cr.created_at DESC LIMIT 1`
    );
    res.json({ call: rows[0] || null });
  } catch (err) {
    console.error('studio/calls/ringing error:', err);
    res.status(500).json({ error: 'Failed to check' });
  }
});

router.get('/calls', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT cr.*, u.email, u.display_name, u.tier FROM call_requests cr JOIN users u ON u.id = cr.user_id ORDER BY cr.created_at DESC`);
    res.json({ calls: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load calls' });
  }
});

router.patch('/calls/:id', async (req, res) => {
  const { status, reason } = req.body;
  if (!['pending','confirmed','completed','cancelled','rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT * FROM call_requests WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Call not found' });
    }
    const current = currentRows[0];

    const isNewRejection = status === 'rejected' && current.status !== 'rejected';

    if (isNewRejection) {
      await refundByRelated(client, {
        userId:     current.user_id,
        type:       'call_charge',
        relatedId:  current.id,
        label:      `Refund: ${current.call_type} call declined`,
        refundType: 'call_refund',
      });
      await client.query(
        `INSERT INTO artist_notifications (type, fan_id, payload)
         VALUES ('call_rejected', $1, $2)`,
        [current.user_id, JSON.stringify({ callType: current.call_type, reason: reason || null, refunded: current.coins_charged })]
      );
    }

    const { rows } = await client.query(
      `UPDATE call_requests SET status = $1, rejection_reason = $2 WHERE id = $3 RETURNING *`,
      [status, status === 'rejected' ? (reason || null) : current.rejection_reason, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, call: rows[0], refunded: isNewRejection ? current.coins_charged : 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/calls patch error:', err);
    res.status(500).json({ error: 'Failed to update call' });
  } finally {
    client.release();
  }
});

router.get('/requests', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT cr.*, u.email, u.display_name, u.tier FROM custom_requests cr JOIN users u ON u.id = cr.user_id ORDER BY cr.created_at DESC`);
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.patch('/requests/:id', async (req, res) => {
  const { status, reason } = req.body;
  if (!['pending','confirmed','completed','cancelled','rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT * FROM custom_requests WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const current = currentRows[0];

    const isNewRejection = status === 'rejected' && current.status !== 'rejected';

    if (isNewRejection) {
      await refundByRelated(client, {
        userId:     current.user_id,
        type:       'custom_request',
        relatedId:  current.id,
        label:      `Refund: ${current.type} request declined`,
        refundType: 'request_refund',
      });
      await client.query(
        `INSERT INTO artist_notifications (type, fan_id, payload)
         VALUES ('request_rejected', $1, $2)`,
        [current.user_id, JSON.stringify({ type: current.type, reason: reason || null, refunded: current.coins_charged })]
      );
    }

    const { rows } = await client.query(
      `UPDATE custom_requests SET status = $1, rejection_reason = $2 WHERE id = $3 RETURNING *`,
      [status, status === 'rejected' ? (reason || null) : current.rejection_reason, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, request: rows[0], refunded: isNewRejection ? current.coins_charged : 0 });

    const statusPush = {
      confirmed: { title: 'Request accepted',      body: `Jinal accepted your request: "${current.topic}"` },
      completed: { title: 'Your request is ready', body: `"${current.topic}" has been delivered.` },
      rejected:  { title: 'Request declined',      body: `${current.coins_charged} tokens have been refunded.` },
      cancelled: { title: 'Request cancelled',     body: `"${current.topic}" was cancelled.` },
    }[status];
    if (statusPush) {
      pushToUser(current.user_id, { ...statusPush, url: '/platform/extras', tag: 'request' })
        .catch((e) => console.error('Request status push failed:', e.message));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/requests patch error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  } finally {
    client.release();
  }
});

// Counter-offer a pending request with a different price. A LOWER counter is strictly
// fan-favorable, so it auto-applies immediately (partial refund, request confirmed right away).
// A HIGHER counter requires the fan's explicit confirmation before any additional charge.
router.post('/requests/:id/counter', async (req, res) => {
  const { counterPrice, note } = req.body;
  const price = parseInt(counterPrice);
  if (!price || price < 0) return res.status(400).json({ error: 'A valid counter price is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(`SELECT * FROM custom_requests WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!currentRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const current = currentRows[0];
    if (current.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a pending request can be countered' });
    }

    if (price <= current.coins_charged) {
      // Auto-applies — strictly fan-favorable, no confirmation needed
      const refundAmount = current.coins_charged - price;
      if (refundAmount > 0) {
        // Only part of the original spend comes back, so this cannot go through
        // refundByRelated, which reverses a whole transaction.
        //
        // Returned to the pots it came from. This used to assume a request was
        // always paid with purchased tokens, which was true when there were two
        // pots -- a bonus token returned as purchased would turn a discount into
        // money the platform never received. Real money comes back first, since
        // that is the part the fan actually paid.
        const { rows: origRows } = await client.query(
          `SELECT from_purchased, from_bonus FROM coin_ledger
           WHERE user_id = $1 AND type = 'custom_request' AND related_id = $2
             AND direction = 'debit' AND refunded_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
          [current.user_id, current.id]
        );
        const paidPurchased = origRows[0]?.from_purchased ?? refundAmount;
        const backPurchased = Math.min(refundAmount, paidPurchased);
        const backBonus     = refundAmount - backPurchased;

        if (backPurchased > 0) {
          await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
                             [backPurchased, current.user_id]);
        }
        if (backBonus > 0) {
          await client.query(`UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + $1 WHERE id = $2`,
                             [backBonus, current.user_id]);
        }
        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id,
                                    from_gifted, from_purchased, from_bonus)
           VALUES ($1, 'request_refund', 'credit', $2, $3, $4, 0, $5, $6)`,
          [current.user_id, refundAmount, `Price adjusted for: ${current.topic}`, current.id,
           backPurchased, backBonus]
        );
      }
      await client.query(
        `UPDATE custom_requests SET status = 'confirmed', coins_charged = $1, counter_price_coins = $1, counter_note = $2 WHERE id = $3`,
        [price, note || null, current.id]
      );
      await client.query('COMMIT');
      notifyArtist({ title: 'Price adjusted & confirmed', body: `Lowered price for "${current.topic}" — auto-confirmed.`, url: '/requests' });
      pushToUser(current.user_id, {
        title: 'Good news on your request',
        body:  refundAmount > 0
          ? `Jinal lowered the price to ${price} tokens. ${refundAmount} refunded.`
          : `Jinal confirmed your request at ${price} tokens.`,
        url:   '/platform/extras',
        tag:   'request',
      }).catch((e) => console.error('Counter push failed:', e.message));
      return res.json({ ok: true, message: `Confirmed at ${price} tokens (${refundAmount} refunded to the fan).`, autoApplied: true });
    }

    // Higher counter — needs the fan's confirmation before any charge happens
    await client.query(
      `UPDATE custom_requests SET status = 'countered', counter_price_coins = $1, counter_note = $2 WHERE id = $3`,
      [price, note || null, current.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, message: `Counter-offer of ${price} tokens sent to the fan for confirmation.`, autoApplied: false });

    pushToUser(current.user_id, {
      title: 'Jinal sent a counter-offer',
      body:  `"${current.topic}" — ${price} tokens. Tap to accept or decline.`,
      url:   '/platform/extras',
      tag:   'request',
    }).catch((e) => console.error('Counter push failed:', e.message));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('studio/requests/counter error:', err);
    res.status(500).json({ error: 'Failed to send counter-offer' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// COMMUNITY
// ─────────────────────────────────────────────

router.get('/community', async (req, res) => {
  try {
    // Split the same way fans see it. Studio showed announcements interleaved
    // with the conversation, which made moderating it — the actual reason to
    // open this screen — a matter of reading past the platform's own noise.
    const { rows } = await pool.query(
      `SELECT cp.*, u.display_name, u.is_artist
       FROM community_posts cp JOIN users u ON u.id = cp.user_id
       WHERE cp.is_system = FALSE
       ORDER BY cp.pinned DESC, cp.created_at DESC LIMIT 100`
    );
    const { rows: updates } = await pool.query(
      `SELECT cp.id, cp.content, cp.created_at, COALESCE(cp.update_kind, 'activity') AS kind
       FROM community_posts cp
       WHERE cp.is_system = TRUE AND cp.removed = FALSE
         AND cp.created_at > NOW() - INTERVAL '48 hours'
       ORDER BY cp.created_at DESC LIMIT 100`
    );
    // Polls with their results, so Studio shows what fans see rather than the
    // bare question as though it were an ordinary message.
    const { rows: polls } = await pool.query(
      `SELECT p.id, p.post_id, p.question, p.option_kind, p.options, p.closes_at,
              (SELECT json_agg(json_build_object('i', v.option_index, 'n', v.n))
               FROM (SELECT option_index, count(*)::int AS n
                     FROM community_poll_votes WHERE poll_id = p.id
                     GROUP BY option_index) v) AS tally
       FROM community_polls p`
    );

    const { rows: windows } = await pool.query(
      `SELECT id, post_id, prompt, closes_at FROM community_question_windows`
    );

    const toUrl = toPublicUrl;

    const { rows: bgRows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'community_chat_bg'`);
    res.json({
      posts: rows,
      updates,
      polls: polls.map((p) => {
        const tally = {};
        (p.tally || []).forEach((t) => { tally[t.i] = t.n; });
        const total = Object.values(tally).reduce((a, b) => a + b, 0);
        return {
          id: p.id, postId: p.post_id, question: p.question,
          optionKind: p.option_kind, closesAt: p.closes_at,
          closed: new Date(p.closes_at) <= new Date(),
          totalVotes: total,
          options: (p.options || []).map((o, i) => ({
            index: i,
            label:    p.option_kind === 'image' ? null : o,
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
      communityBg: bgRows[0]?.value || '',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

router.patch('/community/:id', async (req, res) => {
  const { pinned, removed } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE community_posts SET pinned = COALESCE($1, pinned), removed = COALESCE($2, removed) WHERE id = $3 RETURNING *`,
      [pinned, removed, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true, post: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// ─────────────────────────────────────────────
// FAN SETTINGS
// ─────────────────────────────────────────────

router.patch('/fan-settings/:userId', async (req, res) => {
  const { custom_chat_price, custom_messages_per_token, can_send_media } = req.body;
  try {
    const priceValue = custom_chat_price === undefined || custom_chat_price === '' ? null : custom_chat_price;
    const perTokenValue = custom_messages_per_token === undefined || custom_messages_per_token === '' ? null : custom_messages_per_token;

    await pool.query(
      `INSERT INTO fan_settings (user_id, custom_chat_price, custom_messages_per_token, can_send_media)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET custom_chat_price = $2, custom_messages_per_token = $3, can_send_media = $4, updated_at = NOW()`,
      [req.params.userId, priceValue, perTokenValue, can_send_media ?? false]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update fan settings' });
  }
});

router.post('/fan-settings/:userId/mute', async (req, res) => {
  const { muted } = req.body;
  try {
    await setMuted(req.params.userId, !!muted);
    res.json({ ok: true, muted: !!muted });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mute status' });
  }
});

router.post('/fan-settings/:userId/block', async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await applyBlock(req.params.userId, reason?.trim() || null);
    res.json({
      ok: true,
      message: `Blocked for ${result.appliedDuration}. If this happens again, the next restriction will be ${result.nextTierWarning}.`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply block' });
  }
});

router.post('/fan-settings/:userId/unblock', async (req, res) => {
  try {
    await liftBlock(req.params.userId);
    res.json({ ok: true, message: 'Restriction lifted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to lift block' });
  }
});

// ─────────────────────────────────────────────
// CANNED REPLIES
// ─────────────────────────────────────────────

router.get('/canned-replies', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM canned_replies ORDER BY created_at ASC`);
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

router.post('/canned-replies', async (req, res) => {
  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: 'Title and content are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO canned_replies (title, content) VALUES ($1, $2) RETURNING *`,
      [title.trim(), content.trim()]
    );
    res.json({ ok: true, template: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.delete('/canned-replies/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM canned_replies WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────

router.get('/reports', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cr.id, cr.reason, cr.status, cr.created_at,
              cp.id AS post_id, cp.content AS post_content, cp.removed AS post_removed,
              author.id AS author_id, author.display_name AS author_name, author.email AS author_email,
              reporter.display_name AS reporter_name, reporter.email AS reporter_email
       FROM content_reports cr
       JOIN community_posts cp ON cp.id = cr.post_id
       JOIN users author ON author.id = cp.user_id
       JOIN users reporter ON reporter.id = cr.reporter_id
       WHERE cr.status = 'pending'
       ORDER BY cr.created_at ASC`
    );
    res.json({ reports: rows });
  } catch (err) {
    console.error('studio/reports error:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

router.post('/reports/:id/resolve', async (req, res) => {
  const { action, reason } = req.body;
  if (!['dismiss', 'remove', 'remove_and_mute', 'remove_and_block'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  try {
    const { rows: reportRows } = await pool.query(
      `SELECT cr.*, cp.user_id AS author_id
       FROM content_reports cr JOIN community_posts cp ON cp.id = cr.post_id
       WHERE cr.id = $1`,
      [req.params.id]
    );
    if (!reportRows.length) return res.status(404).json({ error: 'Report not found' });
    const report = reportRows[0];

    if (action !== 'dismiss') {
      await pool.query(`UPDATE community_posts SET removed = TRUE WHERE id = $1`, [report.post_id]);
      await logModerationAction(report.author_id, 'post_removed', reason || report.reason, { postId: report.post_id, reportId: report.id });
    }
    if (action === 'remove_and_mute') {
      await setMuted(report.author_id, true, reason || 'Reported content');
    }
    if (action === 'remove_and_block') {
      await applyBlock(report.author_id, reason || 'Reported content');
    }

    await pool.query(`UPDATE content_reports SET status = 'resolved' WHERE id = $1`, [req.params.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('studio/reports/resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// ─────────────────────────────────────────────
// MODERATION LOG
// ─────────────────────────────────────────────

router.get('/moderation-log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ml.*, u.display_name, u.email
       FROM moderation_log ml
       LEFT JOIN users u ON u.id = ml.target_user_id
       ORDER BY ml.created_at DESC
       LIMIT 100`
    );
    res.json({ log: rows });
  } catch (err) {
    console.error('studio/moderation-log error:', err);
    res.status(500).json({ error: 'Failed to load moderation log' });
  }
});

// ─────────────────────────────────────────────
// PORTFOLIO (jinaljoshi.in) — hero slides
// ─────────────────────────────────────────────

router.get('/portfolio/hero-slides', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM portfolio_hero_slides ORDER BY position ASC, created_at ASC`);
  res.json({ slides: rows });
});

router.post('/portfolio/hero-slides', async (req, res) => {
  const { image_key } = req.body;
  if (!image_key) return res.status(400).json({ error: 'image_key is required' });
  const { rows: maxRows } = await pool.query(`SELECT COALESCE(MAX(position), -1) AS max FROM portfolio_hero_slides`);
  const { rows } = await pool.query(
    `INSERT INTO portfolio_hero_slides (image_key, position) VALUES ($1, $2) RETURNING *`,
    [image_key, maxRows[0].max + 1]
  );
  res.json({ ok: true, slide: rows[0] });
});

router.patch('/portfolio/hero-slides/:id', async (req, res) => {
  const { position, visible } = req.body;
  const { rows } = await pool.query(
    `UPDATE portfolio_hero_slides SET position = COALESCE($1, position), visible = COALESCE($2, visible) WHERE id = $3 RETURNING *`,
    [position, visible, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Slide not found' });
  res.json({ ok: true, slide: rows[0] });
});

router.delete('/portfolio/hero-slides/:id', async (req, res) => {
  await pool.query(`DELETE FROM portfolio_hero_slides WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// PORTFOLIO (jinaljoshi.in) — works entries
// ─────────────────────────────────────────────

router.get('/portfolio/works', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM portfolio_works ORDER BY category ASC, position ASC, created_at ASC`);
  res.json({ works: rows });
});

router.post('/portfolio/works', async (req, res) => {
  const { category, title, year, character, watch_now_url, trailer_url, image_key } = req.body;
  if (!category || !title?.trim()) return res.status(400).json({ error: 'category and title are required' });
  const { rows: maxRows } = await pool.query(`SELECT COALESCE(MAX(position), -1) AS max FROM portfolio_works WHERE category = $1`, [category]);
  const { rows } = await pool.query(
    `INSERT INTO portfolio_works (category, title, year, character, watch_now_url, trailer_url, image_key, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [category, title.trim(), year || null, character || null, watch_now_url || null, trailer_url || null, image_key || null, maxRows[0].max + 1]
  );
  res.json({ ok: true, work: rows[0] });
});

router.patch('/portfolio/works/:id', async (req, res) => {
  const { title, year, character, watch_now_url, trailer_url, image_key, position, visible } = req.body;
  const { rows } = await pool.query(
    `UPDATE portfolio_works SET
       title = COALESCE($1, title), year = COALESCE($2, year), character = COALESCE($3, character),
       watch_now_url = COALESCE($4, watch_now_url), trailer_url = COALESCE($5, trailer_url),
       image_key = COALESCE($6, image_key), position = COALESCE($7, position), visible = COALESCE($8, visible)
     WHERE id = $9 RETURNING *`,
    [title, year, character, watch_now_url, trailer_url, image_key, position, visible, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Work not found' });
  res.json({ ok: true, work: rows[0] });
});

router.delete('/portfolio/works/:id', async (req, res) => {
  await pool.query(`DELETE FROM portfolio_works WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;