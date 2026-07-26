// backend/routes/studio.js
// Artist-only console API

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { postSystemMessage } = require('./community');
const { pushToUser } = require('./push');
const { applyBlock, liftBlock, setMuted, logModerationAction } = require('../lib/moderation');

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
      pool.query(`SELECT * FROM merchandise WHERE visible = TRUE AND remaining <= 5 ORDER BY remaining ASC LIMIT 10`),
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
    await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [amount, userId]);
    await client.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
       VALUES ($1, 'grant', 'credit', $2, $3)`,
      [userId, amount, reason || 'Token grant from Jinal']
    );
    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('token_grant', $1, $2)`,
      [userId, JSON.stringify({ amount, reason })]
    );
    await client.query('COMMIT');
    res.json({ ok: true, message: `${amount} tokens sent to ${email}` });

    pushToUser(userId, {
      title: 'Jinal sent you tokens',
      body:  `${amount} tokens have been added to your balance.`,
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
// FANS
// ─────────────────────────────────────────────

router.get('/fans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, tier, membership_expires_at, coin_balance, created_at,
              is_muted, blocked_until, block_count
       FROM users WHERE is_artist = FALSE ORDER BY created_at DESC`
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
      `SELECT u.id, u.email, u.display_name, u.tier, u.coin_balance, fs.personal_chat_bg,
              fs.custom_chat_price, fs.custom_messages_per_token, fs.can_send_media,
              u.is_muted, u.blocked_until, u.block_count,
              COALESCE(fs.personal_chat_bg, pc.value, '') AS effective_chat_bg
       FROM users u
       LEFT JOIN fan_settings fs ON fs.user_id = u.id
       LEFT JOIN platform_config pc ON pc.key = 'personal_chat_bg'
       WHERE u.id = $1`,
      [req.params.fanId]
    );
    res.json({ messages: rows, fan: fanRows[0] || null });
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

router.get('/content', async (req, res) => {
  try {
    const { rows: sets } = await pool.query(`SELECT * FROM sets ORDER BY created_at DESC`);
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
  const { title, description, type = 'photo_set', price_coins = 0, visible = false, category } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sets (title, description, type, price_coins, visible, category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title.trim(), description || null, type, price_coins, visible, category || null]
    );
    if (visible) {
      postSystemMessage(`📸 Jinal just dropped "${title.trim()}"! Check the Gallery!`);
    }
    res.json({ ok: true, set: rows[0] });
  } catch (err) {
    console.error('studio/content error:', err);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

const VALID_TIER_CATEGORIES = ['free', 'community', 'insider', 'premium', 'supreme', 'purchase_only'];

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
  const { title, description, price_coins, visible, type, category, cover_key } = req.body;
  try {
    const { rows: currentRows } = await pool.query(
      `SELECT title, visible FROM sets WHERE id = $1`, [req.params.id]
    );
    const wasHidden       = currentRows[0] && !currentRows[0].visible;
    const becomingVisible = visible === true;

    const { rows } = await pool.query(
      `UPDATE sets SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         price_coins = COALESCE($3, price_coins),
         visible     = COALESCE($4, visible),
         type        = COALESCE($5, type),
         category    = COALESCE($6, category),
         cover_key   = COALESCE($7, cover_key)
       WHERE id = $8 RETURNING *`,
      [title, description, price_coins, visible, type, category, cover_key, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Set not found' });

    if (wasHidden && becomingVisible) {
      postSystemMessage(`📸 Jinal just dropped "${rows[0].title}"! Check the Gallery!`);
    }

    res.json({ ok: true, set: rows[0] });
  } catch (err) {
    console.error('studio/content patch error:', err);
    res.status(500).json({ error: 'Failed to update content' });
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
    await client.query(`DELETE FROM set_items WHERE set_id = $1`, [id]);
    await client.query(`DELETE FROM access_grants WHERE set_id = $1`, [id]);
    await client.query(`DELETE FROM sets WHERE id = $1`, [id]);
    await client.query('COMMIT');
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
// MERCHANDISE
// ─────────────────────────────────────────────

router.get('/merch', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM merchandise ORDER BY created_at DESC`);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load merchandise' });
  }
});

router.post('/merch', async (req, res) => {
  const { title, description, price_coins, total_stock, visible = false, img_key } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!price_coins)   return res.status(400).json({ error: 'Price is required' });
  if (!total_stock)   return res.status(400).json({ error: 'Stock quantity is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO merchandise (title, description, price_coins, total_stock, remaining, visible, img_key)
       VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING *`,
      [title.trim(), description || '', price_coins, total_stock, visible, img_key || null]
    );
    if (visible) {
      postSystemMessage(`🛍️ Jinal just dropped "${title.trim()}"! Check the Shop!`);
    }
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create merchandise' });
  }
});

router.patch('/merch/:id', async (req, res) => {
  const { title, description, price_coins, remaining, visible, img_key } = req.body;
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
         img_key     = COALESCE($6, img_key)
       WHERE id = $7 RETURNING *`,
      [title, description, price_coins, remaining, visible, img_key, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });

    if (wasHidden && becomingVisible) {
      postSystemMessage(`🛍️ Jinal just dropped new merch: "${rows[0].title}"! Check the Shop!`);
    }

    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update merchandise' });
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
      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [current.coins_charged, current.user_id]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'call_refund', 'credit', $2, $3, $4)`,
        [current.user_id, current.coins_charged, `Refund: ${current.call_type} call declined`, current.id]
      );
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
      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [current.coins_charged, current.user_id]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
         VALUES ($1, 'request_refund', 'credit', $2, $3, $4)`,
        [current.user_id, current.coins_charged, `Refund: ${current.type} request declined`, current.id]
      );
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
        await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [refundAmount, current.user_id]);
        await client.query(
          `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id)
           VALUES ($1, 'request_refund', 'credit', $2, $3, $4)`,
          [current.user_id, refundAmount, `Price adjusted for: ${current.topic}`, current.id]
        );
      }
      await client.query(
        `UPDATE custom_requests SET status = 'confirmed', coins_charged = $1, counter_price_coins = $1, counter_note = $2 WHERE id = $3`,
        [price, note || null, current.id]
      );
      await client.query('COMMIT');
      notifyArtist({ title: 'Price adjusted & confirmed', body: `Lowered price for "${current.topic}" — auto-confirmed.`, url: '/requests' });
      return res.json({ ok: true, message: `Confirmed at ${price} tokens (${refundAmount} refunded to the fan).`, autoApplied: true });
    }

    // Higher counter — needs the fan's confirmation before any charge happens
    await client.query(
      `UPDATE custom_requests SET status = 'countered', counter_price_coins = $1, counter_note = $2 WHERE id = $3`,
      [price, note || null, current.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, message: `Counter-offer of ${price} tokens sent to the fan for confirmation.`, autoApplied: false });
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