// backend/routes/collections.js
//
// The private collection: what it serves, and to whom.
//
// Everything here is paid. There is no tier ladder and no allowance — a set is
// shut until it is bought, and the cover shows the same reduced version the
// gallery uses so there is something to see without giving it away.
//
// ── On being unlisted ───────────────────────────────────────────────
//
// A route name is not a secret. Whatever this were called, the path ships in
// the JavaScript bundle and anybody can read it in half a minute. So the name
// is only discretion — it draws no attention from somebody who has no access —
// and the actual protection is here:
//
//   Every route answers 404 to anybody without access.
//
// Not 403. A 403 says "this exists and you may not have it", which confirms
// what somebody guessing wanted to know and invites them to keep trying. A 404
// says there is nothing at this address, which is what the address means to
// them. There is nothing to find by looking and nothing to confirm by guessing.
//
// The fan app never asks whether this exists either. Access is folded into the
// membership status everybody already fetches, and the key is simply absent for
// anybody without it — so there is no request that reveals the feature, and no
// response that differs in a way worth noticing.

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { hasCollectionsAccess } = require('../lib/collections');
const { spendTokens } = require('../lib/tokens');
const { roundTokensUp } = require('../lib/pricing');
const { shuffleWithinBands } = require('../lib/shuffle');

const R2_PUBLIC = process.env.R2_PUBLIC_URL || '';
const toUrl = (key) => (!key ? null : String(key).startsWith('http') ? key : `${R2_PUBLIC}/${key}`);

// Nothing past this point exists for somebody without access.
router.use(authMid, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at,
              trial_tier, trial_started_at, trial_ends_at,
              collections_until, coin_balance
         FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user = rows[0];
    if (!user || !hasCollectionsAccess(user)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    req.fan = user;
    next();
  } catch (err) {
    console.error('collections/guard error:', err.message);
    // A failure to establish access is not access.
    res.status(404).json({ error: 'NOT_FOUND' });
  }
});

// ── The sets ──────────────────────────────────────────────
//
// Split into stills and moving pictures by what a set actually contains, rather
// than by a field somebody has to remember to set. A set holding any video is a
// video set; everything else is photographs.
router.get('/sets', async (req, res) => {
  try {
    const { rows: sets } = await pool.query(
      `SELECT s.id, s.title, s.description, s.price_coins, s.published_at, s.created_at,
              s.cover_blur,
              COALESCE(s.cover_key,
                (SELECT r2_key FROM set_items WHERE set_id = s.id
                  AND media_type <> 'video' ORDER BY position ASC, created_at ASC LIMIT 1)
              ) AS cover_key,
              (SELECT count(*)::int FROM set_items WHERE set_id = s.id) AS item_count,
              (SELECT count(*)::int FROM set_items
                WHERE set_id = s.id AND media_type = 'video')          AS video_count,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                 FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id)                                AS photographer,
              EXISTS (SELECT 1 FROM access_grants g
                       WHERE g.user_id = $1 AND g.set_id = s.id AND g.scope = 'collection') AS unlocked
         FROM sets s
        WHERE s.visible = TRUE AND s.is_collection = TRUE
        ORDER BY (s.pinned_at IS NULL), s.pinned_at DESC,
                 s.display_order ASC NULLS LAST,
                 COALESCE(s.published_at, s.created_at) DESC`,
      [req.user.userId]
    );

    const shaped = sets.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      photographer: s.photographer,
      itemCount: s.item_count,
      price: s.price_coins,
      unlocked: s.unlocked,
      // The real cover once it is bought; the reduced one until then. The
      // reduced one is a 24px image scaled back up, so there is no detail in it
      // to recover — the blur is the file, not a filter over the file.
      coverUrl: s.unlocked ? toUrl(s.cover_key) : (s.cover_blur || null),
      coverBlurred: !s.unlocked,
      isVideo: s.video_count > 0,
      publishedAt: s.published_at || s.created_at,
    }));

    res.json({
      photos: shaped.filter((s) => !s.isVideo),
      videos: shaped.filter((s) => s.isVideo),
      accessUntil: req.fan.collections_until || null,
      coinBalance: req.fan.coin_balance,
    });
  } catch (err) {
    console.error('collections/sets error:', err);
    res.status(500).json({ error: 'Could not load' });
  }
});

// ── One set ───────────────────────────────────────────────
//
// Items only once it is bought. An unbought set returns its cover and its price
// and nothing else — no keys, no count of what is inside beyond the number, no
// way to reconstruct it from the response.
router.get('/sets/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.description, s.price_coins, s.cover_blur, s.cover_key,
              (SELECT count(*)::int FROM set_items WHERE set_id = s.id) AS item_count,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                 FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id) AS photographer,
              EXISTS (SELECT 1 FROM access_grants g
                       WHERE g.user_id = $1 AND g.set_id = s.id AND g.scope = 'collection') AS unlocked
         FROM sets s
        WHERE s.id = $2 AND s.visible = TRUE AND s.is_collection = TRUE`,
      [req.user.userId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    const s = rows[0];

    let items = [];
    if (s.unlocked) {
      const { rows: itemRows } = await pool.query(
        `SELECT id, r2_key, media_type, position FROM set_items
          WHERE set_id = $1 ORDER BY position ASC, created_at ASC`,
        [req.params.id]
      );
      // A collection set has no tier bands, so this shuffles the whole of it —
      // and only ever runs once it has been bought, since an unbought set
      // returns no items at all.
      items = shuffleWithinBands(itemRows, req.query.seed, { coverKey: s.cover_key })
        .map((i) => ({ id: i.id, mediaType: i.media_type, mediaUrl: toUrl(i.r2_key) }));
    }

    res.json({
      id: s.id,
      title: s.title,
      description: s.description,
      photographer: s.photographer,
      itemCount: s.item_count,
      price: s.price_coins,
      unlocked: s.unlocked,
      coverUrl: s.unlocked ? toUrl(s.cover_key) : (s.cover_blur || null),
      coverBlurred: !s.unlocked,
      items,
    });
  } catch (err) {
    console.error('collections/set error:', err);
    res.status(500).json({ error: 'Could not load' });
  }
});

// ── Buying one ────────────────────────────────────────────
router.post('/unlock', async (req, res) => {
  const { setId } = req.body;
  if (!setId) return res.status(400).json({ error: 'A set is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: setRows } = await client.query(
      `SELECT id, title, price_coins FROM sets
        WHERE id = $1 AND visible = TRUE AND is_collection = TRUE`,
      [setId]
    );
    if (!setRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const set = setRows[0];

    const { rows: existing } = await client.query(
      `SELECT id FROM access_grants WHERE user_id = $1 AND set_id = $2 AND scope = 'collection'`,
      [req.user.userId, setId]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }

    const price = roundTokensUp(set.price_coins);
    let spend = null;
    if (price > 0) {
      try {
        spend = await spendTokens(client, {
          userId:      req.user.userId,
          amount:      price,
          type:        'content_unlock',
          label:       set.title,
          relatedId:   setId,
          // Not with gifted tokens.
          //
          // The gallery takes them and should: a gift is meant to be spent, and
          // that is content anybody's membership already reaches. The
          // collection is the one thing nobody reaches by default, and fans ask
          // for gifts specifically to open it — which turns a gesture into a
          // way in, and makes the exclusivity somebody paid ₹43,000 for
          // negotiable by asking nicely.
          allowGifted: false,
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_TOKENS') {
          await client.query('ROLLBACK');
          return res.status(402).json(err.httpBody);
        }
        throw err;
      }
    }

    await client.query(
      `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid, scope)
       VALUES ($1, $2, 'token_purchase', $3, 'collection')`,
      [req.user.userId, setId, price]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      coinsSpent: price,
      newBalance: spend ? spend.newPurchased : req.fan.coin_balance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('collections/unlock error:', err);
    res.status(500).json({
      error: 'UNLOCK_FAILED',
      message: 'That did not go through and nothing has been charged. Please try again.',
    });
  } finally {
    client.release();
  }
});

module.exports = router;