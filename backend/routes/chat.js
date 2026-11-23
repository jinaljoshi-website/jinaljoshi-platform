// backend/routes/chat.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { notifyArtist } = require('../lib/notify');
const { getDmConfigForTier } = require('../lib/config');
const { effectiveDmFree } = require('../lib/allowance');
const { assertNotBlocked, assertNotMuted } = require('../lib/moderation');
const { getLocalDateStr, getAllotmentPeriodKey } = require('../lib/time');
const { spendTokens, getBalances } = require('../lib/tokens');
const { clip, jsonForPg } = require('../lib/jsonsafe');


function toDateStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function resolveCustomPricing(fanSettings, tierOverageCost) {
  const perTokenBlock = fanSettings.custom_messages_per_token;
  if (perTokenBlock !== null && perTokenBlock !== undefined && perTokenBlock > 0) {
    return { mode: 'per_token_block', blockSize: perTokenBlock };
  }
  if (fanSettings.custom_chat_price !== null && fanSettings.custom_chat_price !== undefined) {
    return { mode: 'flat', flatCost: fanSettings.custom_chat_price };
  }
  return { mode: 'tier_default', flatCost: tierOverageCost };
}

// Strips real media from a locked message that hasn't been paid for yet,
// replacing it with just enough info to render an "Unlock for X tokens" placeholder
function toFanSafeMessage(row) {
  // A deleted message keeps its place and loses its contents. The fan is told
  // something was there rather than left to wonder — and nothing of the
  // original is sent, so "deleted" means deleted rather than hidden.
  if (row.deleted_at) {
    return {
      id: row.id, sender_id: row.sender_id, recipient_id: row.recipient_id,
      created_at: row.created_at, parent_id: row.parent_id,
      deleted: true, content: null, media_url: null, locked_media_urls: null,
    };
  }

  const isLocked = row.unlock_price_coins !== null && row.unlock_price_coins !== undefined && !row.unlocked_at;
  if (!isLocked) return row;

  const itemCount = Array.isArray(row.locked_media_urls) ? row.locked_media_urls.length : 0;
  return {
    ...row,
    locked_media_urls: null, // never send the real URLs before payment
    is_locked: true,
    locked_item_count: itemCount,
  };
}

// ─────────────────────────────────────────────
// GET /api/chat/messages
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// GET /api/chat/media
// ─────────────────────────────────────────────
//
// Every photograph in the conversation, without scrolling to find it.
//
// The same reasoning as Studio's: photographs are the part of a chat most worth
// returning to and the hardest to reach. Locked bundles appear only once the
// fan has paid for them — before that there is nothing to show and showing a
// placeholder would only advertise what they have not bought, in the one place
// they came to look at what they have.
router.get('/media', authMid, async (req, res) => {
  try {
    const artistId = process.env.ARTIST_USER_ID;
    const { rows } = await pool.query(
      `SELECT id, created_at, media_url, media_type, locked_media_urls,
              unlock_price_coins, unlocked_at,
              (sender_id = $1) AS is_mine
         FROM direct_messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND deleted_at IS NULL
          AND (media_url IS NOT NULL OR (locked_media_urls IS NOT NULL AND unlocked_at IS NOT NULL))
        ORDER BY created_at DESC`,
      [req.user.userId, artistId]
    );

    const items = [];
    for (const r of rows) {
      if (r.media_url) {
        items.push({ messageId: r.id, at: r.created_at, url: r.media_url,
                     type: r.media_type || 'image', isMine: r.is_mine, unlocked: false });
      }
      if (r.unlocked_at && Array.isArray(r.locked_media_urls)) {
        for (const m of r.locked_media_urls) {
          items.push({ messageId: r.id, at: r.created_at, url: m.url,
                       type: m.type || 'image', isMine: r.is_mine, unlocked: true });
        }
      }
    }
    res.json({ items });
  } catch (err) {
    console.error('chat/media error:', err);
    res.status(500).json({ error: 'Could not load the media' });
  }
});

router.get('/messages', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sender_id, recipient_id, content, media_url, media_type,
              locked_media_urls, unlock_price_coins, unlocked_at,
              -- Per message, not per conversation. The column has always been
              -- kept up to date and was never sent, so the app had nothing to
              -- go on: it marked every message read when a read event arrived
              -- and lost that on reload, since anything from the database came
              -- back as merely delivered.
              read,
              tokens_charged, created_at, (sender_id = $1) AS is_mine
       FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       -- The most recent fifty, put back into reading order.
       --
       -- This was ASC LIMIT 50, which is the *oldest* fifty. A thread longer
       -- than that showed its first fifty messages and nothing since, so
       -- everything new was invisible — a locked media message sent today
       -- simply never appeared, however many times it was sent.
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.userId, process.env.ARTIST_USER_ID]
    );
    // Marked read when the thread is opened. Studio has always done this for
    // messages coming in; nothing did it for messages going out, so the flag
    // only worked in one direction and an unread count was impossible.
    pool.query(
      `UPDATE direct_messages SET read = TRUE
       WHERE sender_id = $1 AND recipient_id = $2 AND read = FALSE`,
      [process.env.ARTIST_USER_ID, req.user.userId]
    ).catch(() => {});

    res.json({ messages: rows.reverse().map(toFanSafeMessage) });
  } catch (err) {
    console.error('chat/messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/messages/:id/unlock
// Fan pays to unlock a locked media message Jinal sent
// ─────────────────────────────────────────────

router.post('/messages/:id/unlock', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM direct_messages WHERE id = $1 AND recipient_id = $2 FOR UPDATE`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Message not found' });
    }
    const message = rows[0];

    if (message.unlock_price_coins === null || message.unlock_price_coins === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This message is not locked media' });
    }
    if (message.unlocked_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked', lockedMediaUrls: message.locked_media_urls });
    }

    const price = message.unlock_price_coins;

    // Declared out here because a free unlock spends nothing, and the response
    // still has to report a balance.
    let spend = null;
    if (price > 0) {
      try {
        spend = await spendTokens(client, {
          userId:    req.user.userId,
          amount:    price,
          type:      'chat_media_unlock',
          label:     'Unlocked media in chat',
          relatedId: message.id,
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_TOKENS') {
          await client.query('ROLLBACK');
          return res.status(402).json(err.httpBody);
        }
        throw err;
      }
    }
    const { rows: updated } = await client.query(
      `UPDATE direct_messages SET unlocked_at = NOW() WHERE id = $1 RETURNING locked_media_urls`,
      [message.id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      lockedMediaUrls: updated[0].locked_media_urls,
      // Read back from the spend rather than subtracted from what was loaded
      // earlier. A spend can draw on bonus tokens, which do not sit in
      // coin_balance, so subtracting the whole cost from it reported a balance
      // lower than the fan actually holds until something forced a refresh.
      newBalance: spend ? spend.newPurchased : user.coin_balance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('chat/messages/unlock error:', err);
    res.status(500).json({ error: 'Failed to unlock media' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/status
// ─────────────────────────────────────────────

router.get('/status', authMid, async (req, res) => {
  try {
    const { rows: dndRows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'dnd_chat_enabled'`);
    const chatDndActive = dndRows[0]?.value === 'true';

    const { rows: userRows } = await pool.query(
      `SELECT u.tier, u.membership_expires_at, u.membership_started_at, u.coin_balance, u.timezone,
              u.display_name, u.email, u.renewal_streak,
              fs.custom_chat_price, fs.custom_messages_per_token, fs.messages_since_charge,
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
    // The tier's message allowance, then the member's own.
    //
    // Renewing early raises the monthly count on the same schedule as gallery
    // opens. Only the monthly figure moves: the daily cap is a rate limit
    // rather than an allowance, and raising it would defeat what it is for.
    const tierDm   = await getDmConfigForTier(userTier);
    const config   = { ...tierDm, freeDMsPerMonth: effectiveDmFree(tierDm.freeDMsPerMonth, user) };
    const monthKey = getAllotmentPeriodKey(user.membership_started_at);
    const dayStr   = getLocalDateStr(user.timezone);

    const pricing     = resolveCustomPricing(user, config.overageCost);
    const sinceCharge  = user.messages_since_charge || 0;

    const nextCostUnderCustomPricing = () => {
      if (pricing.mode === 'per_token_block') {
        const wouldReachBlock = (sinceCharge + 1) >= pricing.blockSize;
        return wouldReachBlock ? 1 : 0;
      }
      return pricing.flatCost;
    };

    // Messages can be paid for from either pot, so the client needs the spendable
    // total — checking purchased alone would block a fan who holds only gifted credit.
    const bal = await getBalances(pool, req.user.userId);

    if (userTier === 'guest') {
      const overageCost = nextCostUnderCustomPricing();
      return res.json({
        tier: 'guest', coinBalance: user.coin_balance,
        giftedBalance: bal.gifted, spendableBalance: bal.total,
        giftedExpiresInDays: bal.giftedExpiresInDays,
        freeDMsPerMonth: 0, dailyDMCap: 0,
        overageCost,
        monthUsed: 0, freeRemaining: 0, todayUsed: 0, dailyRemaining: 0,
        nextIsFree: overageCost === 0, nextCost: overageCost,
        canSendMedia: user.can_send_media,
        chatBg: user.chat_bg,
        dndActive: chatDndActive,
      });
    }

    const { rows: allotRows } = await pool.query(
      `SELECT free_dms_used, free_dms_today, dms_date
       FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
      [req.user.userId, monthKey]
    );
    const allot      = allotRows[0] || { free_dms_used: 0, free_dms_today: 0, dms_date: null };
    const dmsDateStr = toDateStr(allot.dms_date);
    const todayUsed  = dmsDateStr === dayStr ? (allot.free_dms_today || 0) : 0;
    const monthUsed  = allot.free_dms_used || 0;
    const freeRem    = Math.max(0, config.freeDMsPerMonth - monthUsed);
    const dailyRem   = Math.max(0, config.dailyDMCap - todayUsed);
    const nextIsFreeAllotment = freeRem > 0 && dailyRem > 0;

    const hasCustomOverride = pricing.mode !== 'tier_default';
    const overageCost = nextCostUnderCustomPricing();
    const nextIsFree  = hasCustomOverride ? overageCost === 0 : nextIsFreeAllotment;

    res.json({
      tier: userTier, coinBalance: user.coin_balance,
      giftedBalance: bal.gifted, spendableBalance: bal.total,
      giftedExpiresInDays: bal.giftedExpiresInDays,
      freeDMsPerMonth: config.freeDMsPerMonth, dailyDMCap: config.dailyDMCap,
      overageCost: hasCustomOverride ? overageCost : overageCost,
      monthUsed, freeRemaining: freeRem,
      todayUsed, dailyRemaining: dailyRem,
      nextIsFree, nextCost: nextIsFree ? 0 : overageCost,
      canSendMedia: user.can_send_media,
      chatBg: user.chat_bg,
      dndActive: chatDndActive,
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
  const { content, mediaUrl, mediaType, parentId } = req.body;

  if (!content?.trim() && !mediaUrl) {
    return res.status(400).json({ error: 'Message or media is required' });
  }
  if (content && content.length > 2000) {
    return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
  }

  const artistId = process.env.ARTIST_USER_ID;
  if (!artistId) return res.status(500).json({ error: 'Artist account not configured' });

  try {
    await assertNotBlocked(req.user.userId);
    await assertNotMuted(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT u.tier, u.membership_expires_at, u.membership_started_at, u.coin_balance, u.timezone,
              u.display_name, u.email, u.renewal_streak,
              fs.custom_chat_price, fs.custom_messages_per_token, fs.messages_since_charge,
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
    // The tier's message allowance, then the member's own.
    //
    // Renewing early raises the monthly count on the same schedule as gallery
    // opens. Only the monthly figure moves: the daily cap is a rate limit
    // rather than an allowance, and raising it would defeat what it is for.
    const tierDm   = await getDmConfigForTier(userTier);
    const config   = { ...tierDm, freeDMsPerMonth: effectiveDmFree(tierDm.freeDMsPerMonth, user) };
    const monthKey = getAllotmentPeriodKey(user.membership_started_at);
    const dayStr   = getLocalDateStr(user.timezone);

    if (mediaUrl && !req.user.isArtist && !user.can_send_media) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Media sending is not enabled for your account' });
    }

    const pricing = resolveCustomPricing(user, config.overageCost);
    let tokensCharged = 0;
    let useFreeDM     = false;

    if (pricing.mode === 'per_token_block') {
      await client.query(
        `INSERT INTO fan_settings (user_id, messages_since_charge)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [req.user.userId]
      );

      const sinceCharge = (user.messages_since_charge || 0) + 1;
      if (sinceCharge >= pricing.blockSize) {
        tokensCharged = 1;
        await client.query(`UPDATE fan_settings SET messages_since_charge = 0 WHERE user_id = $1`, [req.user.userId]);
      } else {
        tokensCharged = 0;
        await client.query(`UPDATE fan_settings SET messages_since_charge = $1 WHERE user_id = $2`, [sinceCharge, req.user.userId]);
      }
    } else if (pricing.mode === 'flat') {
      tokensCharged = pricing.flatCost;
    } else if (userTier === 'guest') {
      tokensCharged = pricing.flatCost;
    } else {
      await client.query(
        `INSERT INTO monthly_allotments (user_id, month_key)
         VALUES ($1, $2)
         ON CONFLICT (user_id, month_key) DO NOTHING`,
        [req.user.userId, monthKey]
      );

      const { rows: allotRows } = await client.query(
        `SELECT free_dms_used, free_dms_today, dms_date
         FROM monthly_allotments
         WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      const allot      = allotRows[0];
      const dmsDateStr = toDateStr(allot.dms_date);
      const todayUsed  = dmsDateStr === dayStr ? (allot.free_dms_today || 0) : 0;
      const freeRem    = Math.max(0, config.freeDMsPerMonth - (allot.free_dms_used || 0));
      const dailyRem   = Math.max(0, config.dailyDMCap - todayUsed);
      useFreeDM        = freeRem > 0 && dailyRem > 0;
      tokensCharged    = useFreeDM ? 0 : pricing.flatCost;

      await client.query(
        `UPDATE monthly_allotments
         SET free_dms_used  = free_dms_used + $1,
             free_dms_today = $2,
             dms_date       = $3::date
         WHERE user_id = $4 AND month_key = $5`,
        [useFreeDM ? 1 : 0, todayUsed + 1, dayStr, req.user.userId, monthKey]
      );
    }

    let newBalance = user.coin_balance;
    // A token is the atomic unit — there is no such thing as a quarter of one.
    // A fractional price entered in Settings reached the ledger as 1.25 and the
    // insert failed, so every fan lost the ability to send while Jinal, whose
    // messages are free, saw nothing wrong. Rounded up here so a bad config
    // value degrades to a slightly higher price rather than a broken chat.
    tokensCharged = Math.ceil(Number(tokensCharged) || 0);

    if (tokensCharged > 0) {
      try {
        const spend = await spendTokens(client, {
          userId: req.user.userId,
          amount: tokensCharged,
          type:   'dm_charge',
          label:  userTier === 'guest' ? 'Direct message — guest rate' : 'Direct message — overage',
        });
        newBalance = spend.newPurchased;
      } catch (err) {
        if (err.code === 'INSUFFICIENT_TOKENS') {
          await client.query('ROLLBACK');
          return res.status(402).json(err.httpBody);
        }
        throw err;
      }
    }

    const { rows: msgRows } = await client.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, media_url, media_type, tokens_charged, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, sender_id, recipient_id, content, media_url, media_type, tokens_charged, created_at, parent_id`,
      [req.user.userId, artistId, content?.trim() || null, mediaUrl || null, mediaType || null, tokensCharged, parentId || null]
    );

    await client.query(
      `INSERT INTO artist_notifications (type, fan_id, payload)
       VALUES ('new_dm', $1, $2)`,
      // clip() counts characters, not UTF-16 units, so an emoji sitting on the
      // 80th boundary is kept whole instead of being cut into a lone surrogate
      // that Postgres rejects. That rejection used to roll the whole
      // transaction back and refuse the member's message.
      [req.user.userId, jsonForPg({ preview: clip(content, 80) || '[media]', tier: userTier })]
    );

    await client.query('COMMIT');

    const { rows: dndCheckRows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'dnd_chat_enabled'`);
    const chatDndActive = dndCheckRows[0]?.value === 'true';
    if (!chatDndActive) {
      // Name the sender. "A supreme member sent you a message" tells Jinal nothing
      // about who to reply to, and she cannot find out without opening every thread.
      const fanLabel = user.display_name?.trim()
        || user.email?.split('@')[0]
        || (userTier === 'guest' ? 'A guest' : `A ${userTier} member`);
      notifyArtist({
        title: `${fanLabel} · ${userTier === 'guest' ? 'guest' : userTier}`,
        body:  content?.trim()
          ? (content.trim().length > 90 ? content.trim().slice(0, 90) + '…' : content.trim())
          : 'Sent you media',
        // Names the conversation, so the notification opens it rather than
        // the list of all of them.
        url:   `/messages?fan=${req.user.userId}`,
      });
    }

    res.json({
      ok: true,
      message: { ...msgRows[0], is_mine: true },
      tokensCharged,
      usedFreeDM: useFreeDM,
      newBalance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('chat/send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    client.release();
  }
});

module.exports = router;