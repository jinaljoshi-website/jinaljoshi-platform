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
const { dueFor, optionsFor, maxPreviewPhotos } = require('../lib/collectionPreview');
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
              -- What this person has already paid to see, so the screen can
              -- offer the next step rather than the first one again.
              (SELECT level FROM collection_previews p
                WHERE p.set_id = s.id AND p.user_id = $1)                AS preview_level,
              (SELECT coins_paid FROM collection_previews p
                WHERE p.set_id = s.id AND p.user_id = $1)                AS preview_paid,
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
      // Where they have got to, and what the next step costs after crediting
      // what has already gone in.
      previewLevel: Number(s.preview_level || 0),
      previewOptions: s.unlocked ? [] : optionsFor({
        setPriceCoins: s.price_coins,
        itemCount: s.item_count,
        preview: s.preview_level ? { level: s.preview_level, coins_paid: s.preview_paid } : null,
      }),
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
              -- What this person has already paid to see, so the screen can
              -- offer the next step rather than the first one again.
              (SELECT level FROM collection_previews p
                WHERE p.set_id = s.id AND p.user_id = $1)                AS preview_level,
              (SELECT coins_paid FROM collection_previews p
                WHERE p.set_id = s.id AND p.user_id = $1)                AS preview_paid,
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

    // What this person may see: all of it, or the one or two they paid to
    // preview.
    //
    // This asked only whether the set had been bought, so a preview took the
    // tokens and returned nothing — the worst possible outcome, and entirely my
    // omission: the payment was built and the delivery never was.
    const { rows: prevRows } = await pool.query(
      `SELECT item_ids FROM collection_previews WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, req.params.id]
    ).catch(() => ({ rows: [] }));
    const previewIds = prevRows.length ? prevRows[0].item_ids : [];

    let items = [];
    if (s.unlocked || previewIds.length) {
      const { rows: itemRows } = await pool.query(
        `SELECT id, r2_key, media_type, position FROM set_items
          WHERE set_id = $1 ${s.unlocked ? '' : 'AND id = ANY($2)'}
          ORDER BY position ASC, created_at ASC`,
        s.unlocked ? [req.params.id] : [req.params.id, previewIds]
      );

      // A bought set is shuffled, because there are no bands in a collection
      // and the order should not give away the sequence they were shot in.
      //
      // A preview is not: two photographs paid for individually should be in
      // the order they were chosen, and shuffling two things is theatre.
      items = (s.unlocked
        ? shuffleWithinBands(itemRows, req.query.seed, { coverKey: s.cover_key })
        : itemRows
      ).map((i) => ({ id: i.id, mediaType: i.media_type, mediaUrl: toUrl(i.r2_key) }));
    }

    res.json({
      id: s.id,
      title: s.title,
      description: s.description,
      photographer: s.photographer,
      itemCount: s.item_count,
      price: s.price_coins,
      unlocked: s.unlocked,
      // Said plainly, so the page shows two photographs as two photographs
      // rather than as the whole set arriving short.
      previewing: !s.unlocked && previewIds.length > 0,
      previewCount: previewIds.length,
      // Where they have got to, and what the next step costs after crediting
      // what has already gone in.
      previewLevel: Number(s.preview_level || 0),
      previewOptions: s.unlocked ? [] : optionsFor({
        setPriceCoins: s.price_coins,
        itemCount: s.item_count,
        preview: s.preview_level ? { level: s.preview_level, coins_paid: s.preview_paid } : null,
      }),
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

// ─────────────────────────────────────────────
// POST /api/collections/preview
// ─────────────────────────────────────────────
//
// Buying a look at one or two photographs before the set.
//
// Collections carry the highest prices here and the least to go on. Every step
// credits what came before, so previewing and then buying costs exactly the
// price of the set.
router.post('/preview', async (req, res) => {
  const { setId, level } = req.body;
  if (!setId) return res.status(400).json({ error: 'Which set?' });

  // How many photographs, as a number.
  //
  // This used to read `Number(level) === 2 ? 2 : 1`, which silently turned
  // anything that was not a 2 into a 1 — including a 7, a 0 and a typo. Now
  // that any quantity is allowed, silently coercing a bad one would hide the
  // mistake and charge for something nobody asked for, so it is rejected
  // outright. The upper bound is checked below, where the set's size is known.
  const want = Number(level);
  if (!Number.isInteger(want) || want < 1) {
    return res.status(400).json({ error: 'How many photographs?' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sets } = await client.query(
      `SELECT id, title, price_coins FROM sets
        WHERE id = $1 AND is_collection = TRUE AND visible = TRUE`,
      [setId]
    );
    if (!sets.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That set is not available' }); }
    const set = sets[0];

    // Already bought outright — there is nothing left to preview.
    const { rows: owned } = await client.query(
      `SELECT 1 FROM access_grants WHERE user_id = $1 AND set_id = $2`, [req.user.userId, setId]);
    if (owned.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You already have this set.' }); }

    const { rows: items } = await client.query(
      `SELECT id FROM set_items WHERE set_id = $1 AND review_flag IS DISTINCT FROM 'remove'
        ORDER BY position ASC, created_at ASC`,
      [setId]
    );
    if (items.length < 2) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Too small to preview.' }); }

    // Never the whole set. The last photograph only ever comes with it, so a
    // collection cannot be assembled one preview at a time.
    const maxPhotos = maxPreviewPhotos(items.length);
    if (want > maxPhotos) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'TOO_MANY',
        message: `You can preview up to ${maxPhotos} of these. For all ${items.length}, unlock the set.`,
      });
    }

    const { rows: existing } = await client.query(
      `SELECT * FROM collection_previews WHERE user_id = $1 AND set_id = $2 FOR UPDATE`,
      [req.user.userId, setId]
    );
    const prior = existing[0] || null;
    if (prior && Number(prior.level) >= want) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You have already seen that much.' });
    }

    const due = dueFor(want, set.price_coins, items.length, prior ? prior.coins_paid : 0);
    if (due > 0) {
      try {
        await spendTokens(client, {
          userId: req.user.userId,
          amount: due,
          type: 'content_unlock',
          label: `${set.title}: preview of ${want} photograph${want === 1 ? '' : 's'}`,
          relatedId: setId,
          // Gifted tokens do not open collections, and a preview is a piece of
          // one rather than an exception to it.
          allowGifted: false,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === 'INSUFFICIENT_TOKENS') return res.status(402).json(err.httpBody);
        throw err;
      }
    }

    // The same photographs each time, with the second added to the first.
    //
    // A preview that shuffles is a preview nobody trusts, and somebody who paid
    // to see a particular photograph should find it there tomorrow.
    const chosen = prior
      ? [...prior.item_ids, ...items.map((i) => i.id).filter((id) => !prior.item_ids.includes(id)).slice(0, want - prior.item_ids.length)]
      : items.slice(0, want).map((i) => i.id);

    const paidTotal = (prior ? Number(prior.coins_paid) : 0) + due;

    await client.query(
      `INSERT INTO collection_previews (user_id, set_id, level, coins_paid, item_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, set_id) DO UPDATE
         SET level = $3, coins_paid = $4, item_ids = $5`,
      [req.user.userId, setId, want, paidTotal, chosen]
    );

    await client.query('COMMIT');
    res.json({ ok: true, level: want, paid: due, paidTotal, itemIds: chosen });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('collections/preview error:', err);
    res.status(500).json({ error: 'Could not open that preview' });
  } finally {
    client.release();
  }
});

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

    // Credit whatever a preview already took.
    //
    // Without this, somebody who paid to see two photographs and then bought
    // the set would pay a third more than its price — which would make a
    // preview a toll for looking rather than the first part of buying.
    const { rows: prev } = await client.query(
      `SELECT coins_paid FROM collection_previews WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    ).catch(() => ({ rows: [] }));
    const alreadyPaid = prev.length ? Number(prev[0].coins_paid) : 0;

    const price = Math.max(0, roundTokensUp(set.price_coins) - alreadyPaid);
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