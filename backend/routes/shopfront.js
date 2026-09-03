// backend/routes/shopfront.js
//
// What shop.jinaljoshi.in reads.
//
// Separate from routes/shop.js, which serves the merchandise tab that used to
// live inside Personal Space. That one prices in tokens and is being retired;
// this one prices in rupees, because the shop settles in real money.
//
// The same database, the same members, the same membership discounts. Only the
// storefront and the currency are new.

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const fx      = require('../lib/fx');
const { getConfigNumber } = require('../lib/config');

// Who is asking, if anybody.
//
// A shop that demands a login before showing a photograph is a shop nobody
// browses, so this never refuses. It only reports whether there is a member
// behind the request, because that decides the price.
async function optionalUser(req) {
  try {
    const jwtLib = require('jsonwebtoken');
    const header = req.headers.authorization;
    const raw = (header && header.startsWith('Bearer '))
      ? header.split(' ')[1]
      : (req.headers.cookie || '')
          .split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith('jj_session='))
          ?.slice('jj_session='.length);
    if (!raw) return null;

    const decoded = jwtLib.verify(decodeURIComponent(raw), process.env.JWT_SECRET);
    const { rows } = await pool.query(
      `SELECT u.id, u.tier, u.email, u.display_name, u.membership_expires_at
         FROM users u WHERE u.id = $1 AND u.closed_at IS NULL`,
      [decoded.userId]
    );
    return rows[0] || null;
  } catch {
    return null;   // an unreadable token is a guest, not an error
  }
}

// What a member saves, and nothing more.
//
// The discount is the one they already have on Personal Space. Keeping it the
// same number in both places means a membership means one thing, rather than
// one thing here and another there.
async function discountPctFor(user) {
  if (!user?.tier || user.tier === 'guest') return 0;
  const active = user.membership_expires_at && new Date(user.membership_expires_at) > new Date();
  if (!active) return 0;
  return await getConfigNumber(`${user.tier}_discount_pct`).catch(() => 0) || 0;
}

// ─────────────────────────────────────────────
// GET /api/shopfront/items
// ─────────────────────────────────────────────
router.get('/items', async (req, res) => {
  try {
    const user        = await optionalUser(req);
    const discountPct = await discountPctFor(user);

    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.description, m.img_key, m.price_inr,
              m.source, m.remaining, m.created_at
         FROM merchandise m
        WHERE m.visible = TRUE
          AND m.price_inr IS NOT NULL
        ORDER BY m.created_at DESC`
    );

    // The currency the reader actually thinks in, using the same conversion
    // Personal Space uses, so a price does not change meaning between sites.
    const money = await fx.resolveForUser({
      preferredCurrency: req.query.currency,
      country: req.query.country,
    }).catch(() => null);

    const priced = await Promise.all(rows.map(async (r) => {
      const listInr   = Number(r.price_inr);
      const payInr    = Math.round(listInr * (1 - discountPct / 100));
      const converted = money && money.currency !== 'INR'
        ? await fx.quote(payInr, money.currency).catch(() => null)
        : null;

      return {
        id: r.id,
        title: r.title,
        description: r.description,
        image: r.img_key,
        source: r.source,                    // 'wardrobe' or 'print'
        // One of one, and once it is gone it is gone. A printed item has no
        // such limit, so a count would only invite the question.
        remaining: r.source === 'wardrobe' ? r.remaining : null,
        listInr,
        payInr,
        savedInr: listInr - payInr,
        local: converted,
      };
    }));

    res.json({
      items: priced,
      you: user ? { tier: user.tier, discountPct, signedIn: true }
                : { tier: 'guest', discountPct: 0, signedIn: false },
      currency: money?.currency || 'INR',
    });
  } catch (err) {
    console.error('shopfront/items error:', err);
    res.status(500).json({ error: 'Could not load the shop' });
  }
});

// ─────────────────────────────────────────────
// GET /api/shopfront/items/:id
// ─────────────────────────────────────────────
router.get('/items/:id', async (req, res) => {
  try {
    const user        = await optionalUser(req);
    const discountPct = await discountPctFor(user);

    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.description, m.img_key, m.price_inr,
              m.source, m.remaining, m.qikink_sku
         FROM merchandise m
        WHERE m.id = $1 AND m.visible = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'That item is not available' });
    const r = rows[0];

    const { rows: images } = await pool.query(
      `SELECT img_key FROM merchandise_images WHERE merch_id = $1 ORDER BY position ASC`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    const listInr = Number(r.price_inr);
    const payInr  = Math.round(listInr * (1 - discountPct / 100));

    res.json({
      item: {
        id: r.id, title: r.title, description: r.description,
        image: r.img_key,
        images: images.map((i) => i.img_key),
        source: r.source,
        remaining: r.source === 'wardrobe' ? r.remaining : null,
        listInr, payInr, savedInr: listInr - payInr,
      },
      you: user ? { tier: user.tier, discountPct, signedIn: true }
                : { tier: 'guest', discountPct: 0, signedIn: false },
    });
  } catch (err) {
    console.error('shopfront/item error:', err);
    res.status(500).json({ error: 'Could not load that item' });
  }
});

// ─────────────────────────────────────────────
// GET /api/shopfront/me
// ─────────────────────────────────────────────
//
// Whether the cookie from Personal Space is being seen, and what it is worth.
// The shop asks this once on load so it can say "your membership saves you 15%"
// rather than making somebody discover it at checkout.
router.get('/me', async (req, res) => {
  const user = await optionalUser(req);
  if (!user) return res.json({ signedIn: false });
  res.json({
    signedIn: true,
    name: user.display_name || user.email,
    tier: user.tier,
    discountPct: await discountPctFor(user),
  });
});

module.exports = router;