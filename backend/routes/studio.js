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
const { getDmConfigForTier } = require('../lib/config');
const { getLocalDateStr, getAllotmentPeriodKey } = require('../lib/time');

router.use(authMid, artistOnly);

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const [notifs, pendingCalls, pendingRequests, recentMembers, unreadDMs, lowStockMerch, pendingReports] = await Promise.all([
      pool.query(`SELECT * FROM artist_notifications WHERE read = FALSE ORDER BY created_at DESC LIMIT 20`),
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

router.get('/fans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.tier, u.membership_expires_at,
              u.coin_balance, u.created_at, u.is_muted, u.blocked_until, u.block_count,
              COALESCE((
                SELECT SUM(g.remaining) FROM gifted_grants g
                WHERE g.user_id = u.id AND g.remaining > 0 AND g.expires_at > NOW()
              ), 0)::int AS gifted_balance,
              (
                SELECT MIN(g.expires_at) FROM gifted_grants g
                WHERE g.user_id = u.id AND g.remaining > 0 AND g.expires_at > NOW()
              ) AS gifted_expires_at
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
       dm.id, dm.content, dm.created_at, dm.tokens_charged, dm.read,
       (dm.sender_id = $1) AS is_mine,
       CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END AS fan_id,
       u.email, u.display_name, u.tier
       FROM direct_messages dm
       JOIN users u ON u.id = CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END
       WHERE dm.sender_id = $1 OR dm.recipient_id = $1
       ORDER BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END, dm.created_at DESC`,
      [req.user.userId]
    );
    res.json({ conversations: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

router.get('/dms/:fanId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dm.*, (dm.sender_id = $1) AS is_mine FROM direct_messages dm
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
      `INSERT INTO direct_messages (sender_id, recipient_id, content, media_url, media_type, tokens_charged)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING *`,
      [req.user.userId, req.params.fanId, content?.trim() || null, mediaUrl || null, mediaType || null]
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
    console.error('studio/dms/send-locked-media error:', err);
    res.status(500).json({ error: 'Failed to send locked media' });
  }
});

// ─────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────

// A set with no cover falls back to its first item rather than showing an empty
// card. Cover is normally set from the first upload, but a set created before
// that behaviour — or one whose cover was deleted — would otherwise be blank
// forever with no way to notice from the list.
const COVER_FALLBACK = `COALESCE(s.cover_key,
  (SELECT r2_key FROM set_items WHERE set_id = s.id
   AND media_type <> 'video' ORDER BY position ASC, created_at ASC LIMIT 1))`;

router.get('/content', async (req, res) => {
  try {
    const { rows: sets } = await pool.query(
      `SELECT s.*, ${COVER_FALLBACK} AS cover_key, p.name AS photographer
       FROM sets s
       LEFT JOIN photographers p ON p.id = s.photographer_id
       ORDER BY s.created_at DESC`
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
          photographerName } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const photographerId = await resolvePhotographer(client, photographerName);

    const { rows } = await client.query(
      `INSERT INTO sets (title, description, type, price_coins, visible, category, photographer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title.trim(), description || null, type, price_coins, visible, category || null, photographerId]
    );
    await client.query('COMMIT');

    if (visible) {
      postSystemMessage(`📸 Jinal just dropped "${title.trim()}"! Check the Gallery!`);
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

const VALID_TIER_CATEGORIES = ['free', 'community', 'insider', 'premium', 'supreme', 'purchase_only'];

// Everything inside a set, so Jinal can look through it the way a fan would
// rather than trusting a count. Without this, a single bad photo in a large set
// means deleting and rebuilding the whole thing.
router.get('/content/:id/items', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, set_id, type, media_type, r2_key, position, tier_category, created_at
       FROM set_items WHERE set_id = $1
       ORDER BY tier_category, position ASC, created_at ASC`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('studio/content/items error:', err);
    res.status(500).json({ error: 'Failed to load set items' });
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
    const movingToPurchase = tierCategory === 'purchase_only';
    const hasTiered  = others.some((o) => o.tier_category !== 'purchase_only');
    const hasPurchase = others.some((o) => o.tier_category === 'purchase_only');
    if ((movingToPurchase && hasTiered) || (!movingToPurchase && hasPurchase)) {
      return res.status(409).json({
        error: 'CATEGORY_LOCKED',
        message: 'A set is either tier-segmented or purchase-only, never both. Move the other items first.',
      });
    }

    const { rows } = await pool.query(
      `UPDATE set_items SET tier_category = $1 WHERE id = $2 RETURNING *`,
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
    if (after.has('purchase_only') && after.size > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'CATEGORY_LOCKED',
        message: 'A set is either tier-segmented or purchase-only, never both. Move the rest first.',
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
// PHOTOGRAPHERS
// ─────────────────────────────────────────────

router.get('/photographers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.contact, p.active,
              (SELECT count(*)::int FROM sets s WHERE s.photographer_id = p.id) AS sets
       FROM photographers p WHERE p.active = TRUE ORDER BY p.name`
    );
    res.json({ photographers: rows });
  } catch (err) {
    console.error('studio/photographers error:', err);
    res.status(500).json({ error: 'Failed to load photographers' });
  }
});

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
       WHERE key IN ('token_rate_inr', 'membership_set_share_pct', 'domestic_gst_rate_pct')
          OR key LIKE '%_monthly_cost' OR key LIKE 'gallery_unlocks_%'`
    );
    const cfg = {};
    cfgRows.forEach((r) => { cfg[r.key] = parseFloat(r.value); });

    const tokenRate = cfg.token_rate_inr;
    const setShare  = cfg.membership_set_share_pct;
    if (Number.isNaN(tokenRate) || tokenRate === undefined) {
      return res.status(503).json({ error: 'Token rate is not configured' });
    }

    // What one allowance-funded unlock is worth, per tier.
    //
    // GST comes out first. Token prices are GST-inclusive — 10 tokens is Rs 660
    // of which Rs 100.68 is tax — and that tax is collected on the government's
    // behalf, not earned. Sharing it out would mean giving away money that was
    // never ours. Leaving it in overstated every unlock by about 18%.
    //
    // What remains is split 50% to messages, 15% to running the platform, and
    // 35% to set access. That 35% divided by the tier's monthly allowance gives
    // a fixed value per unlock — fixed, so it does not move because somebody
    // else happened to browse more.
    const gstPct = cfg.domestic_gst_rate_pct || 0;
    const unlockValue = {};
    for (const tier of ['community', 'insider', 'premium', 'supreme']) {
      const cost      = cfg[`${tier}_monthly_cost`];
      const allowance = cfg[`gallery_unlocks_${tier}`];
      if (!cost || !allowance) { unlockValue[tier] = 0; continue; }
      const netTokens = cost / (1 + gstPct / 100);
      unlockValue[tier] = (netTokens * (setShare / 100)) / allowance;
    }

    const { rows } = await pool.query(
      // Summed from the ledger by set rather than joined per grant. Joining
      // grants to ledger rows double-counts anyone holding both a tier and an
      // upsell grant for the same set, and attributes gifted spend as purchased.
      `WITH spend AS (
         SELECT related_id AS set_id,
                COALESCE(SUM(from_purchased), 0)::int AS purchased_tokens,
                COALESCE(SUM(from_gifted), 0)::int    AS gifted_tokens
         FROM coin_ledger
         WHERE type = 'content_unlock' AND direction = 'debit' AND related_id IS NOT NULL
         GROUP BY related_id
       ),
       unlocks AS (
         SELECT set_id, COUNT(*)::int AS n FROM access_grants GROUP BY set_id
       )
       SELECT p.id, p.name, p.contact,
              s.id AS set_id, s.title,
              COALESCE(sp.purchased_tokens, 0) AS purchased_tokens,
              COALESCE(sp.gifted_tokens, 0)    AS gifted_tokens,
              COALESCE(u.n, 0)                 AS unlocks
       FROM photographers p
       LEFT JOIN sets s     ON s.photographer_id = p.id
       LEFT JOIN spend sp   ON sp.set_id = s.id
       LEFT JOIN unlocks u  ON u.set_id  = s.id
       WHERE p.active = TRUE
       ORDER BY p.name, s.title`
    );

    // Allowance unlocks, counted per tier so each can be valued at its own rate.
    const { rows: allowanceRows } = await pool.query(
      `SELECT s.id AS set_id, u.tier, count(*)::int AS n
       FROM access_grants g
       JOIN sets s  ON s.id = g.set_id
       JOIN users u ON u.id = g.user_id
       WHERE s.photographer_id IS NOT NULL AND COALESCE(g.coins_paid, 0) = 0
       GROUP BY s.id, u.tier`
    );
    const allowanceBySet = {};
    allowanceRows.forEach((r) => {
      allowanceBySet[r.set_id] ||= { count: 0, tokens: 0 };
      allowanceBySet[r.set_id].count  += r.n;
      allowanceBySet[r.set_id].tokens += r.n * (unlockValue[r.tier] || 0);
    });

    const { rows: paid } = await pool.query(
      `SELECT photographer_id, COALESCE(SUM(amount_inr), 0) AS total FROM photographer_payments GROUP BY photographer_id`
    );
    const paidBy = {};
    paid.forEach((r) => { paidBy[r.photographer_id] = parseFloat(r.total); });

    const byId = {};
    for (const r of rows) {
      byId[r.id] ||= { id: r.id, name: r.name, contact: r.contact, sets: [], generatedInr: 0 };
      if (!r.set_id) continue;
      const allowance = allowanceBySet[r.set_id] || { count: 0, tokens: 0 };

      // Purchased tokens are GST-inclusive too, so the same deduction applies —
      // otherwise a set unlocked directly would appear to earn 18% more than
      // the identical set unlocked on a membership credit.
      const directInr    = (r.purchased_tokens * tokenRate) / (1 + gstPct / 100);
      const allowanceInr = allowance.tokens * tokenRate;
      const totalInr     = directInr + allowanceInr;

      byId[r.id].sets.push({
        setId: r.set_id, title: r.title,
        unlocks: r.unlocks,
        purchasedTokens: r.purchased_tokens, giftedTokens: r.gifted_tokens,
        allowanceUnlocks: allowance.count,
        directInr:    Math.round(directInr * 100) / 100,
        allowanceInr: Math.round(allowanceInr * 100) / 100,
        revenueInr:   Math.round(totalInr * 100) / 100,
      });
      byId[r.id].generatedInr += totalInr;
    }

    const list = Object.values(byId).map((p) => ({
      ...p,
      generatedInr: Math.round(p.generatedInr * 100) / 100,
      paidInr: paidBy[p.id] || 0,
    })).sort((a, b) => b.generatedInr - a.generatedInr);

    res.json({
      photographers: list,
      tokenRate,
      setSharePct: setShare,
      gstPct,
      unlockValueByTier: unlockValue,
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
      `SELECT g.id, g.grant_type, g.coins_paid, g.scope, g.created_at,
              u.email, u.display_name, u.tier
       FROM access_grants g
       JOIN users u ON u.id = g.user_id
       WHERE g.set_id = $1
       ORDER BY g.created_at DESC`,
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
  const { setId, type, r2Key, position, tierCategory = 'community' } = req.body;
  if (!setId || !type || !r2Key) {
    return res.status(400).json({ error: 'setId, type and r2Key are required' });
  }
  if (!VALID_TIER_CATEGORIES.includes(tierCategory)) {
    return res.status(400).json({ error: 'Invalid tier category' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO set_items (set_id, type, r2_key, position, media_type, tier_category)
       VALUES ($1, $2, $3, $4, $2, $5) RETURNING *`,
      [setId, type, r2Key, position ?? 0, tierCategory]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/content/item error:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

router.patch('/content/:id', async (req, res) => {
  const { title, description, price_coins, visible, type, category, cover_key,
          photographerName } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT title, visible FROM sets WHERE id = $1`, [req.params.id]
    );
    const wasHidden       = currentRows[0] && !currentRows[0].visible;
    const becomingVisible = visible === true;

    // Attribution can be added to a set that already exists, and cleared by
    // sending an empty string — undefined leaves it untouched.
    let photographerId;
    if (photographerName !== undefined) {
      photographerId = photographerName?.trim()
        ? await resolvePhotographer(client, photographerName)
        : null;
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
         photographer_id = CASE WHEN $8::boolean THEN $9::uuid ELSE photographer_id END
       WHERE id = $10 RETURNING *`,
      [title, description, price_coins, visible, type, category, cover_key,
       photographerName !== undefined, photographerId || null, req.params.id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Set not found' }); }
    await client.query('COMMIT');

    if (wasHidden && becomingVisible) {
      postSystemMessage(`📸 Jinal just dropped "${rows[0].title}"! Check the Gallery!`);
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
      postSystemMessage(`🛍️ Jinal just dropped "${title.trim()}"! Check the Shop!`);
    }
    if (visible && isAuction) {
      postSystemMessage(`👗 A new Shoot Wardrobe piece just joined the queue: "${title.trim()}"`);
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
      postSystemMessage(`🛍️ Jinal just dropped new merch: "${rows[0].title}"! Check the Shop!`);
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
      `SELECT cr.id, cr.call_type, cr.duration_minutes, cr.total_cost, cr.created_at,
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
        // refundByRelated, which reverses a whole transaction. Custom requests are
        // always paid for with purchased tokens, so the refund is purchased too.
        await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [refundAmount, current.user_id]);
        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id, from_gifted, from_purchased)
           VALUES ($1, 'request_refund', 'credit', $2, $3, $4, 0, $2)`,
          [current.user_id, refundAmount, `Price adjusted for: ${current.topic}`, current.id]
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
    const { rows } = await pool.query(`SELECT cp.*, u.display_name, u.is_artist FROM community_posts cp JOIN users u ON u.id = cp.user_id ORDER BY cp.pinned DESC, cp.created_at DESC LIMIT 100`);
    const { rows: bgRows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'community_chat_bg'`);
    res.json({ posts: rows, communityBg: bgRows[0]?.value || '' });
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