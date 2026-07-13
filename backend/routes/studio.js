// backend/routes/studio.js
// Artist-only console API

const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { postSystemMessage } = require('./community');
const { applyBlock, liftBlock, setMuted } = require('../lib/moderation');

router.use(authMid, artistOnly);

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const [notifs, pendingCalls, pendingRequests, recentMembers, unreadDMs] = await Promise.all([
      pool.query(`SELECT * FROM artist_notifications WHERE read = FALSE ORDER BY created_at DESC LIMIT 20`),
      pool.query(`SELECT cr.*, u.email, u.display_name FROM call_requests cr JOIN users u ON u.id = cr.user_id WHERE cr.status = 'pending' ORDER BY cr.created_at DESC`),
      pool.query(`SELECT cr.*, u.email, u.display_name FROM custom_requests cr JOIN users u ON u.id = cr.user_id WHERE cr.status = 'pending' ORDER BY cr.created_at DESC`),
      pool.query(`SELECT id, email, display_name, tier, membership_expires_at, coin_balance, created_at FROM users WHERE tier != 'guest' AND membership_expires_at > NOW() ORDER BY created_at DESC LIMIT 10`),
      pool.query(`SELECT dm.*, u.email, u.display_name, u.tier FROM direct_messages dm JOIN users u ON u.id = dm.sender_id WHERE dm.recipient_id = $1 AND dm.read = FALSE ORDER BY dm.created_at DESC LIMIT 20`, [req.user.userId]),
    ]);
    res.json({ notifications: notifs.rows, pendingCalls: pendingCalls.rows, pendingRequests: pendingRequests.rows, recentMembers: recentMembers.rows, unreadDMs: unreadDMs.rows });
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
      await pool.query(
        `INSERT INTO platform_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    }
    res.json({ ok: true });
  } catch (err) {
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
  // Basic shape check — each item needs a url and a type
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
    const { rows } = await pool.query(`SELECT * FROM sets ORDER BY created_at DESC`);
    res.json({ sets: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load content' });
  }
});

router.post('/content', async (req, res) => {
  const { title, description, type = 'photo_set', price_coins = 0, min_tier = 'community', use_unlock_credit = true, visible = false } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const VALID_TIERS = ['none', 'community', 'insider', 'premium', 'supreme'];
  if (!VALID_TIERS.includes(min_tier)) return res.status(400).json({ error: 'Invalid min_tier' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sets (title, description, type, price_coins, min_tier, use_unlock_credit, visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title.trim(), description || null, type, price_coins, min_tier, use_unlock_credit, visible]
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

router.post('/content/item', async (req, res) => {
  const { setId, type, r2Key, position } = req.body;
  if (!setId || !type || !r2Key) {
    return res.status(400).json({ error: 'setId, type and r2Key are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO set_items (set_id, type, r2_key, position, media_type)
       VALUES ($1, $2, $3, $4, $2) RETURNING *`,
      [setId, type, r2Key, position ?? 0]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('studio/content/item error:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

router.patch('/content/:id', async (req, res) => {
  const { title, description, price_coins, min_tier, use_unlock_credit, visible, type, category, cover_key } = req.body;
  try {
    const { rows: currentRows } = await pool.query(
      `SELECT title, visible FROM sets WHERE id = $1`, [req.params.id]
    );
    const wasHidden       = currentRows[0] && !currentRows[0].visible;
    const becomingVisible = visible === true;

    const { rows } = await pool.query(
      `UPDATE sets SET
         title             = COALESCE($1, title),
         description       = COALESCE($2, description),
         price_coins       = COALESCE($3, price_coins),
         min_tier          = COALESCE($4, min_tier),
         use_unlock_credit = COALESCE($5, use_unlock_credit),
         visible           = COALESCE($6, visible),
         type              = COALESCE($7, type),
         category          = COALESCE($8, category),
         cover_key         = COALESCE($9, cover_key)
       WHERE id = $10 RETURNING *`,
      [title, description, price_coins, min_tier, use_unlock_credit, visible, type, category, cover_key, req.params.id]
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
  const { title, description, price_coins, total_stock, visible = false } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!price_coins)   return res.status(400).json({ error: 'Price is required' });
  if (!total_stock)   return res.status(400).json({ error: 'Stock quantity is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO merchandise (title, description, price_coins, total_stock, remaining, visible)
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
      [title.trim(), description || '', price_coins, total_stock, visible]
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
  const { title, description, price_coins, remaining, visible } = req.body;
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
         visible     = COALESCE($5, visible)
       WHERE id = $6 RETURNING *`,
      [title, description, price_coins, remaining, visible, req.params.id]
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

    // Refund only happens once, when transitioning INTO rejected from a non-rejected state
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

    // Refund only happens once, when transitioning INTO rejected from a non-rejected state
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
    // custom_chat_price can legitimately be 0 (free messaging for this fan) — only treat undefined as "clear it"
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

module.exports = router;