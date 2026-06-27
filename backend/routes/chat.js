// backend/routes/chat.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');

const TIER_CONFIG = {
  guest:     { freeDMsPerMonth: 0,   dailyDMCap: 0,  overageCost: 4 },
  community: { freeDMsPerMonth: 5,   dailyDMCap: 2,  overageCost: 2 },
  insider:   { freeDMsPerMonth: 30,  dailyDMCap: 3,  overageCost: 1 },
  premium:   { freeDMsPerMonth: 100, dailyDMCap: 5,  overageCost: 1 },
  supreme:   { freeDMsPerMonth: 250, dailyDMCap: 10, overageCost: 1 },
};

function currentMonthKey() { return new Date().toISOString().slice(0, 7); }
function currentDayStr()   { return new Date().toISOString().slice(0, 10); }

// ─────────────────────────────────────────────
// GET /api/chat/messages
// ─────────────────────────────────────────────

router.get('/messages', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sender_id, recipient_id, content, media_url, media_type,
              tokens_charged, created_at, (sender_id = $1) AS is_mine
       FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at ASC LIMIT 50`,
      [req.user.userId, process.env.ARTIST_USER_ID]
    );
    res.json({ messages: rows });
  } catch (err) {
    console.error('chat/messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/status
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT u.tier, u.membership_expires_at, u.coin_balance,
              COALESCE(fs.custom_chat_price, 0) AS custom_price,
              COALESCE(fs.can_send_media, FALSE) AS can_send_media,
              COALESCE(fs.personal_chat_bg, pc.value, '') AS chat_bg
       FROM users u
       LEFT JOIN fan_settings fs ON fs.user_id = u.id
       LEFT JOIN platform_config pc ON pc.key = 'personal_chat_bg'
       WHERE u.id = $1`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const config   = TIER_CONFIG[userTier];
    const monthKey = currentMonthKey();
    const dayStr   = currentDayStr();

    if (userTier === 'guest') {
      return res.json({
        tier: 'guest', coinBalance: user.coin_balance,
        freeDMsPerMonth: 0, dailyDMCap: 0,
        overageCost: user.custom_price || config.overageCost,
        monthUsed: 0, freeRemaining: 0, todayUsed: 0, dailyRemaining: 0,
        nextIsFree: false, nextCost: user.custom_price || config.overageCost,
        canSendMedia: user.can_send_media,
        chatBg: user.chat_bg,
      });
    }

    const { rows: allotRows } = await pool.query(
      `SELECT free_dms_used, free_dms_today, dms_date
       FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
      [req.user.userId, monthKey]
    );
    const allot      = allotRows[0] || { free_dms_used: 0, free_dms_today: 0, dms_date: null };
    const dmsDateStr = allot.dms_date ? String(allot.dms_date).slice(0, 10) : null;
    const todayUsed  = dmsDateStr === dayStr ? (allot.free_dms_today || 0) : 0;
    const monthUsed  = allot.free_dms_used || 0;
    const freeRem    = Math.max(0, config.freeDMsPerMonth - monthUsed);
    const dailyRem   = Math.max(0, config.dailyDMCap - todayUsed);
    const nextIsFree = freeRem > 0 && dailyRem > 0;
    const overageCost = user.custom_price || config.overageCost;

    res.json({
      tier: userTier, coinBalance: user.coin_balance,
      freeDMsPerMonth: config.freeDMsPerMonth, dailyDMCap: config.dailyDMCap,
      overageCost, monthUsed, freeRemaining: freeRem,
      todayUsed, dailyRemaining: dailyRem,
      nextIsFree, nextCost: nextIsFree ? 0 : overageCost,
      canSendMedia: user.can_send_media,
      chatBg: user.chat_bg,
    });
  } catch (err) {
    console.error('chat/status error:', err);
    res.status(500).json({ error: 'Failed to load chat status' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/send
// ─────────────────────────────────────────────

router.post('/send', authMid, async (req, res) => {
  const { content, mediaUrl, mediaType } = req.body;

  if (!content?.trim() && !mediaUrl) {
    return res.status(400).json({ error: 'Message or media is required' });
  }
  if (content && content.length > 2000) {
    return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
  }

  const artistId = process.env.ARTIST_USER_ID;
  if (!artistId) return res.status(500).json({ error: 'Artist account not configured' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT u.tier, u.membership_expires_at, u.coin_balance,
              COALESCE(fs.custom_chat_price, 0) AS custom_price,
              COALESCE(fs.can_send_media, FALSE) AS can_send_media
       FROM users u
       LEFT JOIN fan_settings fs ON fs.user_id = u.id
       WHERE u.id = $1 FOR UPDATE OF u`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const now      = new Date();
    const isActive = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier = isActive ? user.tier : 'guest';
    const config   = TIER_CONFIG[userTier];
    const monthKey = currentMonthKey();
    const dayStr   = currentDayStr();

    // Media permission check (artist can always send media)
    if (mediaUrl && !req.user.isArtist && !user.can_send_media) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Media sending is not enabled for your account' });
    }

    let tokensCharged = 0;
    let useFreeDM     = false;
    const overageCost = user.custom_price || config.overageCost;

    if (userTier === 'guest') {
      tokensCharged = overageCost;
    } else {
      const { rows: allotRows } = await client.query(
        `INSERT INTO monthly_allotments (user_id, month_key)
         VALUES ($1, $2) ON CONFLICT (user_id, month_key)
         DO UPDATE SET month_key = EXCLUDED.month_key
         RETURNING free_dms_used, free_dms_today, dms_date`,
        [req.user.userId, monthKey]
      );
      const allot      = allotRows[0];
      const dmsDateStr = allot.dms_date ? String(allot.dms_date).slice(0, 10) : null;
      const todayUsed  = dmsDateStr === dayStr ? (allot.free_dms_today || 0) : 0;
      const freeRem    = Math.max(0, config.freeDMsPerMonth - (allot.free_dms_used || 0));
      const dailyRem   = Math.max(0, config.dailyDMCap - todayUsed);
      useFreeDM        = freeRem > 0 && dailyRem > 0;
      tokensCharged    = useFreeDM ? 0 : overageCost;

      await client.query(
        `UPDATE monthly_allotments
         SET free_dms_used  = free_dms_used + $1,
             free_dms_today = $2, dms_date = $3
         WHERE user_id = $4 AND month_key = $5`,
        [useFreeDM ? 1 : 0, todayUsed + 1, now, req.user.userId, monthKey]
      );
    }

    if (tokensCharged > 0 && user.coin_balance < tokensCharged) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'INSUFFICIENT_TOKENS',
        message: `This message costs ${tokensCharged} token${tokensCharged > 1 ? 's' : ''}. You have ${user.coin_balance}.`,
        required: tokensCharged, available: user.coin_balance,
      });
    }

    if (tokensCharged > 0) {
      await client.query(
        `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
        [tokensCharged, req.user.userId]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label)
         VALUES ($1, 'dm_charge', 'debit', $2, $3)`,
        [req.user.userId, tokensCharged, userTier === 'guest' ? 'Direct message — guest rate' : 'Direct message — overage']
      );
    }

    const { rows: msgRows } = await client.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, media_url, media_type, tokens_charged)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, sender_id, recipient_id, content, media_url, media_type, tokens_charged, created_at`,
      [req.user.userId, artistId, content?.trim() || null, mediaUrl || null, mediaType || null, tokensCharged]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('new_dm', $1, $2)`,
      [req.user.userId, JSON.stringify({ preview: content?.slice(0, 80) || '[media]', tier: userTier })]
    );

    await client.query('COMMIT');

    // Notify Jinal via push (best-effort, after commit)
    notifyArtist({
      title: 'New message',
      body:  `A ${userTier === 'guest' ? 'guest' : userTier + ' member'} sent you a message`,
      url:   '/messages',
    });

    res.json({ ok: true, message: { ...msgRows[0], is_mine: true }, tokensCharged, usedFreeDM: useFreeDM });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('chat/send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    client.release();
  }
});

module.exports = router;