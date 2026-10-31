// backend/routes/gallery.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const { effectiveMembership } = require('../lib/membership');
const { shuffleWithinBands } = require('../lib/shuffle');
const { upgradeOptions } = require('./membership');
const authMid = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { postSystemMessage } = require('./community');
const { notifyArtist } = require('../lib/notify');
const { getGuestMultiplier, getDiscountForTier, getConfigNumber } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');
const { getAllotmentPeriodKey } = require('../lib/time');
const { spendTokens } = require('../lib/tokens');
const { applyRenewalBonus, renewalSummary } = require('../lib/allowance');
const { pricesForMember, priceForMember, PRICED_GRADES,
        purchaseOnlyBlockPrice, purchaseOnlyOptions, purchaseOnlyDueFor,
        maxPurchaseOnlyPreview } = require('../lib/photoPrice');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

function meetsCategory(userTier, category) {
  if (category === 'free') return true;
  if (category === 'purchase_only') return false;
  // A photo with no tier has not been reviewed, and nobody sees it. Without
  // this, indexOf(null) is -1 and the comparison passes for everybody — the
  // most permissive possible answer to "who may see this", given to the one
  // photo nobody has looked at. Publishing is already blocked while any exist,
  // but a rule this cheap should not depend on another one holding.
  if (!category) return false;
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(category);
}

function applyDiscount(price, discountPct) {
  if (!discountPct) return roundTokensUp(price);
  return roundTokensUp(price * (1 - discountPct / 100));
}


// Which membership would open this set, if any.
//
// A set is split per item by tier_category, so a step up does not merely unlock
// this one thing — it moves those items out of the paid portion and into the
// allowance, here and in every other set at that level. The tier worth offering
// is therefore the highest one the set actually contains.
//
// purchase_only items never fall into any allowance, at any tier. A set made of
// them has no membership answer and is not given one: offering a step up that
// would leave the set still shut is worse than offering nothing.
//
// Where somebody already holds the tier and is only paying because the month's
// allowance is spent, no step up is offered at all. It used to offer Supreme,
// on the reasoning that an uncapped tier is the only thing that removes a cap —
// true, and a terrible thing to say to somebody looking at a one-token charge.
// A Premium member who has opened their twenty-five sets was being shown a
// four-hundred-token upgrade to avoid spending one. The set itself now reports
// that the allowance is spent, and the screen says so in a sentence instead.
function membershipTierFor(items, userTier) {
  const graded = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && TIER_ORDER.includes(i.tier_category));
  if (!graded.length) return null;

  const highest = graded
    .map((i) => i.tier_category)
    .reduce((a, b) => (TIER_ORDER.indexOf(b) > TIER_ORDER.indexOf(a) ? b : a));

  if (TIER_ORDER.indexOf(highest) > TIER_ORDER.indexOf(userTier)) return highest;
  return null;
}

// What the set is actually made of, and what each membership would open.
//
// Both halves of the same answer. The lock screen used to name one tier — the
// highest the set contained — and quote its price, so a single Supreme photo
// among forty-eight made Supreme the only membership a guest ever saw. The
// breakdown is what makes a cheaper tier arguable: a reader can see that most
// of the set sits at Community long before they see what Community costs.
const CATEGORY_ORDER = ['free', 'community', 'insider', 'premium', 'supreme'];

function setComposition(items) {
  const byCategory = {};
  let unsorted = 0, purchaseOnly = 0;

  for (const i of items) {
    const isVideo = i.media_type === 'video';
    const cat = i.tier_category;

    // A photo with no category is seen by nobody until it is reviewed. It is
    // still in the set, so it is still counted — otherwise the parts do not
    // add up to the whole and the header looks broken.
    if (cat === 'purchase_only') { purchaseOnly++; continue; }
    if (!CATEGORY_ORDER.includes(cat)) { unsorted++; continue; }

    byCategory[cat] = byCategory[cat] || { photos: 0, videos: 0, total: 0 };
    byCategory[cat][isVideo ? 'videos' : 'photos']++;
    byCategory[cat].total++;
  }

  // How many items a member at each tier would have included. Cumulative:
  // Premium covers everything at Premium and below. Free counts for everyone.
  const opensByTier = {};
  for (const tier of CATEGORY_ORDER) {
    if (tier === 'free') continue;
    opensByTier[tier] = CATEGORY_ORDER
      .slice(0, CATEGORY_ORDER.indexOf(tier) + 1)
      .reduce((sum, c) => sum + (byCategory[c]?.total || 0), 0);
  }

  return { byCategory, unsorted, purchaseOnly, opensByTier, total: items.length };
}

function isEffectivelyUnlocked(grantType, membershipCurrentlyActive) {
  if (!grantType) return false;
  if (grantType === 'unlock_credit') return membershipCurrentlyActive;
  return true;
}

// Reads one ladder number, treating "missing" and "unreadable" the same way.
//
// getConfigNumber does not throw for these keys — they are not in
// REQUIRED_PRICING — it returns undefined, so the .catch() that used to guard
// these reads never fired. The fallback has to happen here instead.
async function ladderNumber(key, fallback) {
  try {
    const v = await getConfigNumber(key);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// The per-tier cap, or null when it cannot be read. Null is deliberately not
// zero: zero means "deliberately uncapped" and null means "we do not know",
// and those two must never collapse into each other — see nextOpenCost.
async function readOpenCap(userTier) {
  const key = `tier_open_cap_${userTier}`;
  const cap = await ladderNumber(key, null);
  if (cap === null) console.error(`gallery: ${key} is missing or unreadable — charging full price for sets at this tier`);
  return cap;
}

// Every ladder number in one go, in the shape nextOpenCost expects.
//
// The member is passed in so an early-renewal bonus can be applied here, once,
// rather than at each of the three places that ask for bands. They must agree:
// the gallery quotes from one, the unlock quote from the second and the actual
// charge from the third, and a member shown one number and charged against
// another has every right to be annoyed.
//
// applyRenewalBonus moves the whole ladder rather than just the cap — see
// lib/allowance for why raising the cap alone would partly cancel the reward.
async function readBands(userTier, { isGuest = false, user = null } = {}) {
  const [openCap, band2Until, band2Cost, band3Until, band3Cost] = await Promise.all([
    isGuest ? 0 : readOpenCap(userTier),
    ladderNumber('tier_open_band2_until', 42),
    ladderNumber('tier_open_band2_cost',   1),
    ladderNumber('tier_open_band3_until', 60),
    ladderNumber('tier_open_band3_cost',   3),
  ]);
  const bands = { openCap, band2Until, band2Cost, band3Until, band3Cost };
  return isGuest ? bands : applyRenewalBonus(bands, user);
}

// What the next set at your own level costs, given how many you have already
// opened this period. A ladder rather than a cliff: generous where nearly
// everybody is, a little where somebody is reading a lot, and full price only
// where the membership has plainly stopped being a membership.
//
// A cap of 0 means uncapped, which is how a tier is exempted entirely.
//
// The guard on the first line matters more than it looks. This used to open
// with `if (!openCap) return 0`, and a cap that was missing from
// platform_config arrives here as undefined, which is falsy — so a missing
// config key did not fail, it handed every member in that tier the entire
// gallery for nothing, silently and indefinitely. "Not known" now costs full
// price: a member querying a charge is recoverable, a library given away is
// not.
function nextOpenCost(opened, bands, fullTierPrice) {
  const { openCap, band2Until, band2Cost, band3Until, band3Cost } = bands;

  if (!Number.isFinite(openCap)) return fullTierPrice;   // cap unknown
  if (openCap === 0)             return 0;               // deliberately uncapped
  if (opened < openCap)          return 0;               // included

  if (Number.isFinite(band2Until) && Number.isFinite(band2Cost) && opened < band2Until) return band2Cost;
  if (Number.isFinite(band3Until) && Number.isFinite(band3Cost) && opened < band3Until) return band3Cost;
  return fullTierPrice;                                 // no longer a membership
}

function computeSegments(items, userTier, basePrice, discountPct, isGuest, guestMultiplier, opensUsed = 0, bands = {}) {
  const total = items.length || 1;

  const freeItems        = items.filter((i) => i.tier_category === 'free');
  const tierEligibleItems = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && meetsCategory(userTier, i.tier_category));
  const higherTierItems   = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only' && !meetsCategory(userTier, i.tier_category));
  const purchaseOnlyItems = items.filter((i) => i.tier_category === 'purchase_only');

  const tierPortionCount   = tierEligibleItems.length;
  const upsellItems        = [...higherTierItems, ...purchaseOnlyItems];
  const upsellPortionCount = upsellItems.length;

  const rawTierPrice   = basePrice * (tierPortionCount / total);
  const rawUpsellPrice = basePrice * (upsellPortionCount / total);

  // A member's own level costs nothing — that is what the membership is. It is
  // still counted, and capped generously, so a single month cannot be used to
  // strip the library; past the cap a further set at your own level costs one
  // token. Guests have no tier to reach, so they pay the full price as before.
  const fullTierPrice = applyDiscount(rawTierPrice, discountPct);
  const tierPrice = isGuest
    ? roundTokensUp(rawTierPrice * guestMultiplier)
    : nextOpenCost(opensUsed, bands, fullTierPrice);

  // Anything above your tier is still bought, priced by how much of the set it
  // is, and discounted by your tier.
  const upsellPrice = isGuest ? roundTokensUp(rawUpsellPrice * guestMultiplier) : applyDiscount(rawUpsellPrice, discountPct);

  return {
    freeCount: freeItems.length,
    tierPortionCount,
    upsellPortionCount,
    hasUpsell: upsellPortionCount > 0,
    tierPrice,
    // What this portion would cost outright, used once somebody is far enough
    // past the allowance that the membership no longer covers it.
    tierFullPrice: fullTierPrice,
    tierIncluded: !isGuest && tierPrice === 0 && tierPortionCount > 0,
    upsellPrice,
    tierPreviewKey: tierEligibleItems[0]?.r2_key || null,
    upsellPreviewKey: upsellItems[0]?.r2_key || null,
  };
}

// ─────────────────────────────────────────────
// GET /api/gallery/sets
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// POST /api/gallery/items/:itemId/like
// ─────────────────────────────────────────────
//
// Liking a photograph, and unliking it.
//
// One person, one photograph, once — enforced by the primary key rather than by
// remembering to check, so a double tap on a slow connection cannot count
// twice.
//
// Only on a photograph somebody can actually see. Liking through a locked set
// would be a way to learn what is in one without paying for it.

// ─────────────────────────────────────────────
// POST /api/gallery/items/viewed
// ─────────────────────────────────────────────
//
// Which photographs somebody actually looked at.
//
// Set views counted people who opened a set, which put a number next to the
// likes that could never be compared with them: a hundred photographs might
// carry three hundred likes and twelve views, and the pair reads as broken even
// though both are right. Counting photographs on both sides makes them the same
// kind of number.
//
// Sent in batches as somebody scrolls rather than one request per photograph. A
// set of two hundred would otherwise be two hundred requests to record that
// somebody looked at it once.
//
// One row per person per photograph, ever. This is reach, not traffic: the
// question is how many people have seen a photograph, not how many times it has
// been on a screen.
router.post('/items/viewed', authMid, async (req, res) => {
  const ids = Array.isArray(req.body.itemIds) ? req.body.itemIds.slice(0, 300) : [];
  if (!ids.length) return res.json({ ok: true, recorded: 0 });

  try {
    // Only photographs the person can actually see. Without this, a script
    // could record views against a locked set and learn what is in it from the
    // counts.
    const { rows } = await pool.query(
      `INSERT INTO item_views (item_id, user_id)
       SELECT i.id, $2 FROM set_items i
         JOIN sets s ON s.id = i.set_id
        WHERE i.id = ANY($1) AND s.visible = TRUE
       ON CONFLICT DO NOTHING
       RETURNING item_id`,
      [ids, req.user.userId]
    );
    res.json({ ok: true, recorded: rows.length });
  } catch (err) {
    // Never allowed to matter. This is information about the photographs, and
    // it must not stand between a fan and looking at them.
    console.error('gallery/items/viewed error:', err.message);
    res.json({ ok: true, recorded: 0 });
  }
});

router.post('/items/:itemId/like', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.set_id, i.tier_category, s.is_collection
         FROM set_items i JOIN sets s ON s.id = i.set_id
        WHERE i.id = $1 AND s.visible = TRUE`,
      [req.params.itemId]
    );
    if (!rows.length) return res.status(404).json({ error: 'That photograph is not available' });

    const { rows: after } = await pool.query(
      `INSERT INTO item_likes (item_id, user_id) VALUES ($1, $2)
       ON CONFLICT (item_id, user_id) DO NOTHING
       RETURNING item_id`,
      [req.params.itemId, req.user.userId]
    );

    // Nothing inserted means it was already liked, so this tap is the undo.
    let liked = true;
    if (!after.length) {
      await pool.query(`DELETE FROM item_likes WHERE item_id = $1 AND user_id = $2`,
        [req.params.itemId, req.user.userId]);
      liked = false;
    }

    const { rows: counted } = await pool.query(
      `SELECT count(*)::int AS n FROM item_likes WHERE item_id = $1`, [req.params.itemId]);

    res.json({ liked, likes: counted[0].n });
  } catch (err) {
    console.error('gallery/like error:', err);
    res.status(500).json({ error: 'Could not register that' });
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/sets/:setId/fit-vote
// ─────────────────────────────────────────────
//
// Keep it or send it back.
//
// Open for a day from the moment the set went live, then the result stands. A
// vote nobody can change afterwards is the point: it is a first reaction, not a
// running tally to be gamed.
//
// Measured from published_at rather than created_at, because a set can sit as a
// draft for a week and a poll that closed before anybody saw it is not a poll.
router.post('/sets/:setId/fit-vote', authMid, async (req, res) => {
  const { verdict } = req.body;
  if (!['keep', 'return'].includes(verdict)) {
    return res.status(400).json({ error: 'Say keep or return' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, category, published_at, created_at FROM sets
        WHERE id = $1 AND visible = TRUE AND is_collection = FALSE`,
      [req.params.setId]
    );
    if (!rows.length) return res.status(404).json({ error: 'That set is not available' });
    const set = rows[0];

    if (set.category !== 'fit_check') {
      return res.status(400).json({ error: 'There is no vote on this set' });
    }

    const opened = new Date(set.published_at || set.created_at);
    const closes = new Date(opened.getTime() + 24 * 60 * 60 * 1000);
    if (Date.now() > closes.getTime()) {
      return res.status(409).json({ error: 'VOTING_CLOSED', message: 'Voting on this one has closed.' });
    }

    // Changing your mind is allowed while it is open. Somebody who sees the
    // rest of the photographs and thinks again should be able to say so.
    await pool.query(
      `INSERT INTO fit_votes (set_id, user_id, verdict) VALUES ($1, $2, $3)
       ON CONFLICT (set_id, user_id) DO UPDATE SET verdict = $3, created_at = NOW()`,
      [set.id, req.user.userId, verdict]
    );

    const { rows: tally } = await pool.query(
      `SELECT count(*) FILTER (WHERE verdict = 'keep')::int   AS keep,
              count(*) FILTER (WHERE verdict = 'return')::int AS ret
         FROM fit_votes WHERE set_id = $1`,
      [set.id]
    );

    res.json({ yours: verdict, keep: tally[0].keep, return: tally[0].ret, closesAt: closes });
  } catch (err) {
    console.error('gallery/fit-vote error:', err);
    res.status(500).json({ error: 'Could not register your vote' });
  }
});

router.get('/sets', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance, renewal_streak FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const isGuest   = userTier === 'guest';
    const [guestMultiplier, discountPct] = await Promise.all([
      isGuest ? getGuestMultiplier() : 1,
      isGuest ? 0 : getDiscountForTier(userTier),
    ]);

    // How many sets they have opened at their own level this period. The count
    // is not a budget being spent — everything at their tier is included — it
    // is a ceiling high enough that no ordinary month reaches it, and low
    // enough that a single month cannot be used to take the whole library.
    const monthKey = getAllotmentPeriodKey(user.membership_started_at);
    const bands = await readBands(userTier, { isGuest, user });
    const { openCap, band2Until, band2Cost, band3Until, band3Cost } = bands;

    let opensUsed = 0;
    if (!isGuest) {
      const { rows: allotRows } = await pool.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
        [req.user.userId, monthKey]
      );
      opensUsed = allotRows[0]?.unlocks_used || 0;
    }
    // A cap of 0 means uncapped, which is how a tier is exempted.
    const capReached = !isGuest && openCap > 0 && opensUsed >= openCap;
    const opensRemaining = openCap > 0 ? Math.max(0, openCap - opensUsed) : null;

    // The period runs from the day they joined, not from the 1st — so "resets
    // next month" would be wrong for everyone who did not join on a 1st. The
    // actual date is both correct and more useful than a vague promise.
    let opensResetOn = null;
    if (!isGuest && user.membership_started_at) {
      const start = new Date(user.membership_started_at);
      const day   = start.getUTCDate();
      let y = now.getUTCFullYear(), m = now.getUTCMonth();
      // Built from year and month rather than by adding months to a date —
      // adding a month to the 31st rolls into the following one, so someone who
      // joined on the 31st would be told their allowance resets on the 3rd.
      const build = (yy, mm) => {
        const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
        return new Date(Date.UTC(yy, mm, Math.min(day, lastDay),
          start.getUTCHours(), start.getUTCMinutes()));
      };
      let next = build(y, m);
      if (next <= now) { m += 1; if (m > 11) { m = 0; y += 1; } next = build(y, m); }
      opensResetOn = next.toISOString();
    }

    // Two questions that used to share one parameter. `sort` held both an
    // ordering (newest) and three filters (free_for_all, free_for_me, locked),
    // so choosing a filter silently threw away the ordering and there was no way
    // to ask for the free sets newest first.
    //
    // Now `sort` only orders and `show` only filters. The filter names are still
    // honoured when they arrive on `sort`, so a bundle sitting in a cache keeps
    // working through the deploy.
    //
    // Price ordering is by the set's own price, not by what this fan pays. A
    // member pays nothing for their own level, so ordering by their price would
    // collapse most of the library to one value and come out looking like date
    // order — which is why an earlier attempt at a price sort was dropped.
    const SORTS = ['newest', 'oldest', 'price_high', 'price_low'];
    const SHOWS = ['all', 'free_for_all', 'free_for_me', 'locked', 'purchase_only'];

    const rawSort = String(req.query.sort || '');
    const rawShow = String(req.query.show || '');

    const sortBy = SORTS.includes(rawSort) ? rawSort : 'newest';
    const showBy = SHOWS.includes(rawShow)                        ? rawShow
                 : SHOWS.includes(rawSort) && rawSort !== 'all'   ? rawSort
                 : 'all';

    const { rows: sets } = await pool.query(
      `SELECT s.id, s.title, s.description, s.type, s.category, s.price_coins,
              s.created_at, s.published_at,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id) AS photographer,
              -- Falls back to the first item so a set never shows a blank card.
              s.cover_blur,
              COALESCE(s.cover_key,
                (SELECT r2_key FROM set_items WHERE set_id = s.id
                 AND media_type <> 'video' ORDER BY position ASC, created_at ASC LIMIT 1)
              ) AS cover_key,
              -- How many people opened it, and how many likes its photographs
              -- have between them. Counted rather than kept in a column: a
              -- counter drifts the first time something fails halfway, and then
              -- nobody can say whether the number is real.
              -- Photographs looked at, not sets opened, so this and the likes
              -- beside it are the same kind of number.
              (SELECT count(*)::int FROM item_views vi
                 JOIN set_items i ON i.id = vi.item_id
                WHERE i.set_id = s.id)                                          AS view_count,
              (SELECT count(*)::int FROM item_likes l
                 JOIN set_items i ON i.id = l.item_id
                WHERE i.set_id = s.id)                                          AS like_count,
              s.published_at
       FROM sets s
       WHERE s.visible = TRUE AND s.is_collection = FALSE
       -- Ordered by when it became available, falling back to upload date for
       -- anything published before that was recorded.
       -- Pinned first, then the arranged sequence. display_order is assigned
       -- on creation so a new set lands at the top rather than needing to be
       -- dragged there, and the date is only a tiebreak for anything that
       -- predates the column.
       ORDER BY (s.pinned_at IS NULL), s.pinned_at DESC,
                s.display_order ASC NULLS LAST,
                COALESCE(s.published_at, s.created_at) DESC`
    );

    // Scoped to the sets just fetched. This read every media row on the platform
    // and then threw away the ones that did not belong to a visible set, which
    // cost nothing while the library was small and would have cost everything
    // later.
    const { rows: allItems } = await pool.query(
      `SELECT set_id, r2_key, media_type, tier_category
         FROM set_items WHERE set_id = ANY($1::uuid[])`,
      [sets.map((s) => s.id)]
    );
    const itemsBySet = {};
    allItems.forEach((item) => {
      if (!itemsBySet[item.set_id]) itemsBySet[item.set_id] = [];
      itemsBySet[item.set_id].push(item);
    });

    const { rows: grants } = await pool.query(
      `SELECT set_id, scope, grant_type FROM access_grants WHERE user_id = $1`,
      [req.user.userId]
    );
    const grantsBySet = {};
    grants.forEach((g) => {
      if (!grantsBySet[g.set_id]) grantsBySet[g.set_id] = {};
      grantsBySet[g.set_id][g.scope] = g.grant_type;
    });

    // What they have spent on individual photographs, per set.
    //
    // Loaded here with the grants, in one query for the whole library rather
    // than one per set, because this list is 235 sets long. It comes off the
    // upsell price below so the card quotes what the unlock will actually
    // charge — the same figure the charge itself works out.
    const { rows: photoPaidRows } = await pool.query(
      `SELECT set_id, coins_paid FROM item_purchases WHERE user_id = $1`,
      [req.user.userId]
    );
    const photosPaidBySet = {};
    photoPaidRows.forEach((r) => { photosPaidBySet[r.set_id] = Number(r.coins_paid) || 0; });

    // Priced once for the whole request by the same code the membership page
    // uses, so a set and that page can never quote different numbers for the
    // same step up.
    const { rows: meRows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at,
              membership_paid_tokens, membership_term_days,
              trial_tier, trial_started_at, trial_ends_at
         FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const meState  = effectiveMembership(meRows[0], new Date());
    const tierOpts = await upgradeOptions(meRows[0], meState, new Date());

    let setsWithData = sets.map((s) => {
      const items = itemsBySet[s.id] || [];
      const counts = { photos: 0, videos: 0 };
      items.forEach((i) => { if (i.media_type === 'video') counts.videos++; else counts.photos++; });

      const segments = computeSegments(items, userTier, s.price_coins, discountPct, isGuest, guestMultiplier, opensUsed, bands);

      const tierGrant   = grantsBySet[s.id]?.tier;
      const upsellGrant = grantsBySet[s.id]?.upsell;

      const tierUnlocked   = tierGrant && isEffectivelyUnlocked(tierGrant, isActive);
      const tierLapsed     = tierGrant === 'unlock_credit' && !isActive;
      const upsellUnlocked = upsellGrant && isEffectivelyUnlocked(upsellGrant, true);

      // "Genuinely unlocked" for the fan's Unlocked Media tab means a real credit or token
      // was spent — a set made entirely of free items never counts, even if viewed.
      const isGenuinelyUnlocked = !!tierUnlocked || !!upsellUnlocked;

      // The cover is the set's first item, so a set with nothing free shows a
      // photo nobody has paid for. Blurred until they have — being in the fan's
      // tier is not the same as having unlocked it, which the previous test
      // treated as equivalent and so left most covers exposed.
      const coverBlurred = segments.freeCount === 0 && !isGenuinelyUnlocked;

      return {
        id: s.id,
        title: s.title,
        description: s.description,
        photographer: s.photographer,
        // Carried through so the price sort can fall back to date on a tie.
        publishedAt: s.published_at || s.created_at,
        // The set's own price, before anything about this fan is applied. What
        // the price sort orders by, and the only price that is the same for
        // everybody looking at the library.
        basePrice: Number(s.price_coins) || 0,
        type: s.type,
        category: s.category,
        // A locked cover never sends the real image. Blurring it in CSS meant
        // the full photo was in the page and one Reader-mode keystroke away —
        // this sends a 24px version instead, which cannot be sharpened because
        // the detail was never there.
        cover_url: coverBlurred ? (s.cover_blur || null) : toUrl(s.cover_key),
        photoCount: counts.photos,
        videoCount: counts.videos,
        // Fetched by the query above and, until now, dropped here. The columns
        // were being selected and thrown away, so the card had nothing to show
        // however carefully it asked.
        view_count: s.view_count || 0,
        like_count: s.like_count || 0,
        isFreeForAll: items.length > 0 && items.every((i) => i.tier_category === 'free'),

        freeCount: segments.freeCount,
        tierPortionCount: segments.tierPortionCount,
        hasUpsell: segments.hasUpsell,
        upsellPortionCount: segments.upsellPortionCount,

        tierUnlocked: !!tierUnlocked,
        tierLapsed: !!tierLapsed,
        upsellUnlocked: !!upsellUnlocked,
        isGenuinelyUnlocked,

        // The second way in. Null where a membership would not help — a
        // purchase-only set, or somebody already on the top tier — and the
        // gallery shows nothing rather than something untrue.
        membershipOffer: (() => {
          const t = membershipTierFor(items, userTier);
          if (!t || !tierOpts[t]) return null;
          return { tier: t, ...tierOpts[t] };
        })(),

        // What the set holds, by category, and how far each tier would get.
        composition: setComposition(items),

        // Their tier already covers this set; they are paying because the
        // month's allowance is spent. Distinct from "your tier is too low",
        // and the two need different sentences on screen.
        capExhausted: !isGuest && segments.tierPortionCount > 0
                      && segments.tierPrice > 0
                      && !membershipTierFor(items, userTier),

        tierPrice: segments.tierPrice,
        // Less whatever single photographs have already been paid for in this
        // set, so the card and the charge agree.
        upsellPrice: Math.max(0, segments.upsellPrice - (photosPaidBySet[s.id] || 0)),
        upsellPriceBeforeCredit: segments.upsellPrice,
        photosPaid: photosPaidBySet[s.id] || 0,
        // tierPreviewUrl and upsellPreviewUrl used to sit here, both assigned
        // the same value — the same 1.7 KB base64 image, twice, on every set in
        // the library. Together they were about 720 KB of a 2.2 MB response,
        // and the app only ever drew one of them, for the single set a fan had
        // opened. It now arrives with that set, from /sets/:setId/items.

        coverBlurred,
      };
    });

    // Filter down to what was asked for, then order what is left. Both happen
    // here rather than in SQL because what a fan pays depends on their tier and
    // is only known after the per-fan calculation above.
    //
    // Open to them without paying: free to everyone, or within their tier.
    const freeToThem = (s) => s.isFreeForAll || (s.tierPortionCount > 0 && s.tierPrice === 0);

    if (showBy === 'free_for_me')   setsWithData = setsWithData.filter(freeToThem);
    if (showBy === 'free_for_all')  setsWithData = setsWithData.filter((s) => s.isFreeForAll);
    // Anything with something still behind a wall for this fan — either the set
    // itself, or an exclusive portion of it they have not bought.
    if (showBy === 'locked')        setsWithData = setsWithData.filter((s) => !freeToThem(s) || s.upsellPrice > 0);
    // Sets holding something no membership ever covers, at any tier.
    if (showBy === 'purchase_only') setsWithData = setsWithData.filter((s) => (s.composition?.purchaseOnly || 0) > 0);

    // 'newest' is the order the query already returned — pinned first, then the
    // arranged sequence — so it is left alone.
    //
    // The other three re-sort the whole list, which costs a pinned set its
    // place. That is deliberate: pinning says "look at this first", and somebody
    // who has just asked for the cheapest set has said something more specific.
    const at = (s) => new Date(s.publishedAt || 0).getTime();
    if (sortBy === 'oldest') {
      setsWithData.sort((a, b) => at(a) - at(b));
    } else if (sortBy === 'price_high') {
      setsWithData.sort((a, b) => (b.basePrice - a.basePrice) || (at(b) - at(a)));
    } else if (sortBy === 'price_low') {
      setsWithData.sort((a, b) => (a.basePrice - b.basePrice) || (at(b) - at(a)));
    }

    // freeForAll and unlockable used to be built here and returned alongside
    // `sets`.
    //
    // They were kept "so an older bundle held in a cache does not lose its
    // gallery" during the deploy that introduced `sets`, and then left in. They
    // were not a different view of the library — every object in them was a
    // byte-for-byte copy of one already in `sets`, so the response carried the
    // whole library twice. At 235 sets that was about half of a 2.2 MB payload,
    // paid for on every gallery load, on a phone, on mobile data.
    //
    // The app has preferred `sets` since that deploy and only fell back to
    // concatenating these when it was absent, which it never is.

    // What the library holds, and how much of it this fan has been inside.
    //
    // Counted against every visible set, not only the ones at their level. A
    // Community member seeing they have opened 12% is the honest number and it
    // is also the argument for the next tier; showing 90% of what happens to be
    // open to them would be flattering and say nothing.
    const { rows: libRows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM set_items i JOIN sets s2 ON s2.id = i.set_id
           WHERE s2.visible = TRUE AND s2.is_collection = FALSE AND i.media_type <> 'video')  AS photos,
         (SELECT count(*)::int FROM set_items i JOIN sets s2 ON s2.id = i.set_id
           WHERE s2.visible = TRUE AND s2.is_collection = FALSE AND i.media_type = 'video')   AS videos,
         (SELECT count(*)::int FROM sets s2
           WHERE s2.visible = TRUE AND s2.is_collection = FALSE)                              AS total_sets,
         (SELECT count(*)::int FROM set_views v JOIN sets s2 ON s2.id = v.set_id
           WHERE v.user_id = $1 AND s2.visible = TRUE AND s2.is_collection = FALSE)           AS seen_sets`,
      [req.user.userId]
    );
    const lib = libRows[0];

    res.json({
      library: {
        photos:    lib.photos,
        videos:    lib.videos,
        totalSets: lib.total_sets,
        seenSets:  lib.seen_sets,
        seenPct:   lib.total_sets ? Math.round((lib.seen_sets / lib.total_sets) * 100) : 0,
      },
      sort: sortBy,
      show: showBy,
      // One list, already filtered and in the requested order.
      sets: setsWithData,
      userTier,
      isGuest,
      discountPct,
      coinBalance: user.coin_balance,
      opensRemaining,
      openCap,
      opensUsed,
      opensResetOn,
      bands: { openCap, band2Until, band2Cost, band3Until, band3Cost },
      // Why their cap is what it is. Sent from here rather than worked out in
      // the page, so the banner can never quote a number the charge disagrees
      // with. Absent for guests, who have no renewals to speak of.
      renewalBonus: isGuest ? null : renewalSummary(user),
      // Kept under the old names so anything still reading them keeps working
      // through the deploy.
      creditsRemaining: opensRemaining,
      creditsMax: openCap,
    });
  } catch (err) {
    console.error('gallery/sets error:', err);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/unlock
// ─────────────────────────────────────────────

router.post('/unlock', authMid, async (req, res) => {
  const { setId, scope } = req.body;
  if (!setId) return res.status(400).json({ error: 'setId is required' });
  if (!['tier', 'upsell'].includes(scope)) return res.status(400).json({ error: 'scope must be "tier" or "upsell"' });

  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance, display_name, renewal_streak FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user      = userRows[0];
    const now       = new Date();
    const isActive  = user.membership_expires_at && new Date(user.membership_expires_at) > now;
    const userTier  = isActive ? user.tier : 'guest';
    const isGuest   = userTier === 'guest';
    const fanLabel  = user.display_name || 'A member';
    const [guestMultiplier, discountPct] = await Promise.all([
      isGuest ? getGuestMultiplier() : 1,
      isGuest ? 0 : getDiscountForTier(userTier),
    ]);

    const { rows: setRows } = await client.query(
      `SELECT s.*,
              (SELECT string_agg(p.name, ', ' ORDER BY p.name)
                FROM set_photographers spx JOIN photographers p ON p.id = spx.photographer_id
                WHERE spx.set_id = s.id) AS photographer
       FROM sets s
       WHERE s.id = $1 AND s.visible = TRUE AND s.is_collection = FALSE`, [setId]);
    if (!setRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }
    const set = setRows[0];

    const { rows: itemRows } = await client.query(`SELECT r2_key, media_type, tier_category FROM set_items WHERE set_id = $1`, [setId]);
    // Recomputed with the cap state so the price charged matches what the
    // gallery showed.
    // The same bands the gallery quoted from, in the same shape.
    //
    // This passed (atCap, overageForTier) — a boolean and a number — where
    // computeSegments expects (opensUsed, bands). Destructuring a number gives
    // undefined for every band, so nextOpenCost saw no openCap and returned
    // zero every time: the gallery quoted a token and the unlock took nothing.
    // Every set opened past the monthly allowance has been free.
    const monthKeyForCap = getAllotmentPeriodKey(user.membership_started_at);
    const bandsForCap = await readBands(userTier, { isGuest, user });

    const { rows: capRows } = await client.query(
      `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
      [req.user.userId, monthKeyForCap]
    );
    const alreadyOpened = capRows[0]?.unlocks_used || 0;

    const segments = computeSegments(itemRows, userTier, set.price_coins, discountPct, isGuest, guestMultiplier, alreadyOpened, bandsForCap);

    if (scope === 'upsell' && !segments.hasUpsell) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'There is nothing further to unlock in this set' });
    }

    const { rows: existingGrants } = await client.query(
      `SELECT id, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2 AND scope = $3`,
      [req.user.userId, setId, scope]
    );
    const existing = existingGrants[0];

    if (existing && isEffectivelyUnlocked(existing.grant_type, scope === 'upsell' ? true : isActive) && existing.grant_type !== 'unlock_credit') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }
    if (existing && existing.grant_type === 'unlock_credit' && isActive) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already unlocked' });
    }

    let useCredit = false;
    let price = scope === 'tier' ? segments.tierPrice : segments.upsellPrice;

    // Photographs already bought one at a time come off the block.
    //
    // Without this a member who bought three supreme photographs and then
    // decided to take the rest would pay for those three twice — which makes
    // buying one first a penalty for changing your mind, and teaches people
    // not to start. The same rule collections run on: every step credits what
    // came before, so the total is the price of the thing, once.
    //
    // Only against the upsell. The tier portion is content they could already
    // reach, so nothing bought above their grade has any bearing on it.
    let photosCredited = 0;
    if (scope === 'upsell') {
      const { rows: paidRows } = await client.query(
        `SELECT coins_paid FROM item_purchases WHERE user_id = $1 AND set_id = $2`,
        [req.user.userId, setId]
      );
      photosCredited = Number(paidRows[0]?.coins_paid) || 0;
      if (photosCredited > 0) price = Math.max(0, price - photosCredited);
    }

    // Opening a set at your own level is included, and every open is recorded.
    // Past the included allowance the price climbs in bands rather than jumping
    // to one flat figure — the 16th set and the 60th are not the same thing.
    //
    // Counted only for members, and only for the tier scope: an upsell is bought
    // separately and has nothing to do with the allowance.
    if (scope === 'tier' && segments.tierPortionCount > 0 && !isGuest) {
      const monthKey = getAllotmentPeriodKey(user.membership_started_at);
      const chargeBands = await readBands(userTier, { user });

      const { rows: allotRows } = await client.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2 FOR UPDATE`,
        [req.user.userId, monthKey]
      );
      const used = allotRows[0]?.unlocks_used || 0;

      // Recomputed here rather than trusting what the gallery sent, so the
      // charge cannot be influenced by a stale page.
      price = nextOpenCost(used, chargeBands, segments.tierFullPrice);
      useCredit = price === 0;

      // Recorded either way — what it cost does not change the fact that they
      // opened it, and the count is what a later cap would be measured against.
      await client.query(
        `INSERT INTO monthly_allotments (user_id, month_key, unlocks_used)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, month_key)
         DO UPDATE SET unlocks_used = monthly_allotments.unlocks_used + 1`,
        [req.user.userId, monthKey]
      );
    }

    // Declared out here because the unlock may be free, in which case nothing
    // is spent and the balance is unchanged.
    let spend = null;
    if (price > 0) {
      try {
        spend = await spendTokens(client, {
          userId:    req.user.userId,
          amount:    price,
          type:      'content_unlock',
          label:     `Content unlock: ${set.title} (${scope})`,
          relatedId: setId,
        });
      } catch (err) {
        if (err.code === 'INSUFFICIENT_TOKENS') {
          await client.query('ROLLBACK');
          return res.status(402).json(err.httpBody);
        }
        throw err;
      }
    }

    // What was paid does not decide whether access persists — what was bought
    // does. A token spent at the fair usage ceiling buys a bypass, not the set:
    // the photos are still tier content, and tier content belongs to the
    // membership. Only the upsell portion is genuinely purchased, and only that
    // survives a lapse.
    const grantType = scope === 'upsell' ? 'token_purchase' : 'unlock_credit';

    if (existing) {
      await client.query(
        `UPDATE access_grants SET grant_type = $1, coins_paid = $2, granted_at = NOW() WHERE id = $3`,
        [grantType, price, existing.id]
      );
    } else {
      await client.query(
        `INSERT INTO access_grants (user_id, set_id, grant_type, coins_paid, scope)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.userId, setId, grantType, price, scope]
      );
    }

    await client.query('COMMIT');

    postSystemMessage(`🔓 ${fanLabel} unlocked "${set.title}"!`, { kind: 'activity', name: fanLabel });

    // Told after the transaction commits, so an unlock that rolled back is never
    // announced. How it was paid for matters as much as the fact of it — a
    // membership credit is engagement, tokens spent are revenue, and they read
    // very differently.
    const mode = useCredit
      ? 'membership credit'
      : `${price} token${price === 1 ? '' : 's'}`;
    notifyArtist({
      title: `🔓 ${fanLabel} unlocked a set`,
      body:  `${set.title} · ${scope === 'upsell' ? 'exclusive' : 'their tier'} · ${mode}`,
      // Member activity, not the set. Jinal owns the set already — what is
      // worth seeing is who opened it and what else they have been doing.
      url:   `/activity?who=${encodeURIComponent(fanLabel)}`,
      tag:   `unlock-${setId}`,
    });

    // Read back from the spend rather than subtracted from what was loaded
    // earlier: an unlock can draw on gifted or bonus tokens, neither of which
    // sits in coin_balance, so subtracting the price from it understated what
    // the fan actually holds.
    res.json({ ok: true, coinsSpent: price, usedCredit: useCredit,
               newBalance: spend ? spend.newPurchased : user.coin_balance, scope });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gallery/unlock error:', err);
    // Tell the fan the one thing that actually matters when a purchase fails:
    // that it did not go through and they have not paid. The transaction rolled
    // back above, so that is true.
    res.status(500).json({
      error: 'UNLOCK_FAILED',
      message: 'That did not go through and nothing has been charged. Please try again.',
    });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/items/preview
// ─────────────────────────────────────────────
//
// A few photographs from a purchase-only set, rather than all of it.
//
// Purchase-only content sits outside the tier ladder — no membership reaches
// it at any level — so none of the flat grade prices apply and the only way
// in has been the whole set. This gives it what the private collection has:
// pick a number, see the price, pay the difference.
//
// Cumulative, like the collection previews. Asking for five when you already
// have two charges the difference between two and five, never five again.
router.post('/items/preview', authMid, async (req, res) => {
  const { setId, photos } = req.body;
  if (!setId) return res.status(400).json({ error: 'setId is required' });

  const want = Number(photos);
  if (!Number.isInteger(want) || want < 1) {
    return res.status(400).json({ error: 'How many photographs?' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user?.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    const isGuest  = !isActive;
    const userTier = isActive ? user.tier : 'guest';

    const { rows: setRows } = await client.query(
      `SELECT id, title, price_coins FROM sets
        WHERE id = $1 AND visible = TRUE AND is_collection = FALSE`,
      [setId]
    );
    if (!setRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That set is not available' }); }
    const set = setRows[0];

    const { rows: allItems } = await client.query(
      `SELECT id, tier_category FROM set_items
        WHERE set_id = $1 AND review_flag IS DISTINCT FROM 'remove'
        ORDER BY position ASC, created_at ASC`,
      [setId]
    );
    const poItems = allItems.filter((i) => i.tier_category === 'purchase_only');
    if (poItems.length < 2) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'TOO_SMALL', message: 'There is nothing to preview in this set.' });
    }

    // Nothing to sell piecemeal to somebody who already has the lot.
    const { rows: grantRows } = await client.query(
      `SELECT scope, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    if (grantRows.some((g) => g.scope === 'upsell' && isEffectivelyUnlocked(g.grant_type, true))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_UNLOCKED', message: 'You already have all of this set.' });
    }

    const { rows: boughtRows } = await client.query(
      `SELECT item_ids, coins_paid FROM item_purchases
        WHERE user_id = $1 AND set_id = $2 FOR UPDATE`,
      [req.user.userId, setId]
    );
    const owned     = boughtRows[0]?.item_ids || [];
    const paidSoFar = Number(boughtRows[0]?.coins_paid) || 0;

    // Never the last one — a set cannot be assembled a photograph at a time.
    const maxPhotos = maxPurchaseOnlyPreview(poItems.length);
    const target    = owned.length + want;
    if (target > maxPhotos) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'BUY_THE_SET',
        message: `You can take up to ${maxPhotos} of these. For all ${poItems.length}, unlock the set.`,
      });
    }

    const [discountPct, guestMultiplier] = await Promise.all([
      isGuest ? 0 : getDiscountForTier(userTier),
      isGuest ? getGuestMultiplier() : 1,
    ]);
    const blockPrice = purchaseOnlyBlockPrice({
      setPriceCoins: set.price_coins, totalItems: allItems.length,
      purchaseOnlyCount: poItems.length, discountPct, guestMultiplier, isGuest,
    });

    const due = purchaseOnlyDueFor(target, blockPrice, poItems.length, paidSoFar);
    if (due <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'NOTHING_DUE', message: 'You already have that many.' });
    }

    let spend;
    try {
      spend = await spendTokens(client, {
        userId:    req.user.userId,
        amount:    due,
        type:      'content_unlock',
        label:     `${set.title}: ${want} photograph${want === 1 ? '' : 's'}`,
        relatedId: setId,
        allowGifted: false,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === 'INSUFFICIENT_TOKENS') return res.status(402).json(err.httpBody);
      throw err;
    }

    // The next ones in her order, added to what they have.
    //
    // Deterministic and never reshuffled: somebody who paid to see a
    // particular photograph should find it there tomorrow, and the order of
    // the set is hers to decide.
    const taken = poItems
      .map((i) => i.id)
      .filter((id) => !owned.includes(id))
      .slice(0, want);

    await client.query(
      `INSERT INTO item_purchases (user_id, set_id, item_ids, coins_paid)
       VALUES ($1, $2, $3::uuid[], $4)
       ON CONFLICT (user_id, set_id) DO UPDATE
         SET item_ids   = item_purchases.item_ids || EXCLUDED.item_ids,
             coins_paid = EXCLUDED.coins_paid,
             updated_at = NOW()`,
      [req.user.userId, setId, taken, paidSoFar + due]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      photos: want,
      photosOwned: owned.length + taken.length,
      coinsSpent: due,
      photosPaid: paidSoFar + due,
      newBalance: spend.newPurchased,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('gallery/items/preview error:', err);
    res.status(500).json({
      error: 'UNLOCK_FAILED',
      message: 'That did not go through and nothing has been charged. Please try again.',
    });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// POST /api/gallery/items/unlock
// ─────────────────────────────────────────────
//
// One photograph, above your tier, bought on its own.
//
// Until now the only way past your grade was the whole upsell block: a member
// who wanted one supreme photograph out of a set had to buy every above-tier
// photograph in it. Most did not, and we sold nothing.
//
// The price is flat by grade and has nothing to do with the set's own price —
// see lib/photoPrice for why. What stops this cannibalising the set is that
// the last one is never for sale: a member can buy up to one fewer than the
// set holds above their tier, and the rest only ever comes as the block.
router.post('/items/unlock', authMid, async (req, res) => {
  const { setId, itemId } = req.body;
  if (!setId || !itemId) return res.status(400).json({ error: 'setId and itemId are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.userId]
    );
    const user     = userRows[0];
    const isActive = user?.membership_expires_at && new Date(user.membership_expires_at) > new Date();
    if (!isActive) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'MEMBERS_ONLY',
        message: 'Buying a single photograph is part of a membership.',
      });
    }
    const userTier = user.tier;

    const { rows: setRows } = await client.query(
      `SELECT id, title, price_coins FROM sets WHERE id = $1 AND visible = TRUE AND is_collection = FALSE`,
      [setId]
    );
    if (!setRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That set is not available' }); }
    const set = setRows[0];

    const { rows: allItems } = await client.query(
      `SELECT id, tier_category FROM set_items WHERE set_id = $1`, [setId]
    );
    const item = allItems.find((i) => i.id === itemId);
    if (!item) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That photograph is not in this set' }); }

    // Only what sits above their grade is sold this way. Anything at or below
    // it either comes with the membership or comes with opening the set.
    const grade = item.tier_category;
    if (!PRICED_GRADES.includes(grade) || meetsCategory(userTier, grade)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'NOT_FOR_SALE',
        message: 'That photograph is not sold on its own.',
      });
    }

    const { rows: grantRows } = await client.query(
      `SELECT scope, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    if (grantRows.some((g) => g.scope === 'upsell' && isEffectivelyUnlocked(g.grant_type, true))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_UNLOCKED', message: 'You already have all of this set.' });
    }

    const { rows: boughtRows } = await client.query(
      `SELECT item_ids, coins_paid FROM item_purchases
        WHERE user_id = $1 AND set_id = $2 FOR UPDATE`,
      [req.user.userId, setId]
    );
    const owned = boughtRows[0]?.item_ids || [];
    if (owned.includes(itemId)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_OWNED', message: 'You already have that one.' });
    }

    // Never the last one. A set cannot be assembled a photograph at a time.
    const aboveTier = allItems.filter(
      (i) => PRICED_GRADES.includes(i.tier_category) && !meetsCategory(userTier, i.tier_category)
    );
    if (owned.length + 1 >= aboveTier.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'BUY_THE_SET',
        message: `That would be the last one. Unlock the rest of the set instead.`,
      });
    }

    const price = await priceForMember(grade, userTier);
    if (!Number.isFinite(price) || price <= 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'NO_PRICE', message: 'That photograph has no price set.' });
    }

    let spend;
    try {
      // Gifted tokens do not buy content here, the same rule collections use.
      spend = await spendTokens(client, {
        userId:    req.user.userId,
        amount:    price,
        type:      'content_unlock',
        label:     `${set.title}: one ${grade} photograph`,
        relatedId: setId,
        allowGifted: false,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === 'INSUFFICIENT_TOKENS') return res.status(402).json(err.httpBody);
      throw err;
    }

    const paidTotal = (Number(boughtRows[0]?.coins_paid) || 0) + price;
    await client.query(
      `INSERT INTO item_purchases (user_id, set_id, item_ids, coins_paid)
       VALUES ($1, $2, ARRAY[$3::uuid], $4)
       ON CONFLICT (user_id, set_id) DO UPDATE
         SET item_ids   = item_purchases.item_ids || EXCLUDED.item_ids,
             coins_paid = EXCLUDED.coins_paid,
             updated_at = NOW()`,
      [req.user.userId, setId, itemId, paidTotal]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      itemId,
      grade,
      coinsSpent: price,
      newBalance: spend.newPurchased,
      photosOwned: owned.length + 1,
      photosPaid: paidTotal,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('gallery/items/unlock error:', err);
    res.status(500).json({
      error: 'UNLOCK_FAILED',
      message: 'That did not go through and nothing has been charged. Please try again.',
    });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// GET /api/gallery/sets/:setId/items
// ─────────────────────────────────────────────

router.get('/sets/:setId/items', authMid, async (req, res) => {
  const { setId } = req.params;
  try {
    const { rows: userRows } = await pool.query(`SELECT tier, membership_expires_at FROM users WHERE id = $1`, [req.user.userId]);
    const now = new Date();
    const isActive = userRows[0]?.membership_expires_at && new Date(userRows[0].membership_expires_at) > now;
    const userTier = isActive ? userRows[0].tier : 'guest';

    // Recorded once per fan per set. A free set produces no unlock and no
    // transaction, so without this nothing at all was known about the sets most
    // people actually look at. Not awaited, and failure is ignored — this is
    // information, and it must never stand between a fan and the photos.
    pool.query(
      `INSERT INTO set_views (user_id, set_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.userId, setId]
    ).catch(() => {});

    const { rows: grants } = await pool.query(
      `SELECT scope, grant_type FROM access_grants WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    const tierGrant   = grants.find((g) => g.scope === 'tier');
    const upsellGrant = grants.find((g) => g.scope === 'upsell');
    const tierUnlocked   = tierGrant && isEffectivelyUnlocked(tierGrant.grant_type, isActive);
    const upsellUnlocked = upsellGrant && isEffectivelyUnlocked(upsellGrant.grant_type, true);

    const { rows: items } = await pool.query(
      `SELECT id, r2_key, thumb_key, blur_key, media_type, position, tier_category
       FROM set_items WHERE set_id = $1 ORDER BY position ASC, created_at ASC`,
      [setId]
    );

    // Which individual photographs this member has bought outright.
    //
    // Per-photograph purchases live in their own table rather than in
    // access_grants, which records one row per member per set and has no room
    // for "these four of the twenty".
    const { rows: boughtRows } = await pool.query(
      `SELECT item_ids, coins_paid FROM item_purchases WHERE user_id = $1 AND set_id = $2`,
      [req.user.userId, setId]
    );
    const ownedItemIds = new Set(boughtRows[0]?.item_ids || []);

    const canSee = (item) => {
      if (item.tier_category === 'free') return true;
      if (ownedItemIds.has(item.id)) return true;
      if (item.tier_category === 'purchase_only') return upsellUnlocked;
      const isTierReachable = meetsCategory(userTier, item.tier_category);
      if (isTierReachable) return tierUnlocked;
      return upsellUnlocked;
    };

    // Everything in the set, or only what can be seen.
    //
    // The new set page shows the whole set graded, with what a member cannot
    // reach blurred rather than absent, so they can see what is there and what
    // reaching it would cost. What they may not have is the photograph itself,
    // and that is enforced below where the URLs are attached: a locked row
    // carries its blurred placeholder and nothing else. Being able to see that
    // a photograph exists is not the same as being able to see it.
    //
    // Behind a flag because the page that knows how to draw a locked tile
    // ships separately. Without it this would hand the current page rows with
    // no image URL, and it would draw them as broken tiles. Default stays
    // exactly as it has always been.
    const includeLocked = req.query.includeLocked === '1';
    const visibleItems = includeLocked ? items : items.filter(canSee);

    // Shuffled per viewing, within tier bands, cover first.
    //
    // Only what somebody can actually see is shuffled; the filter above has
    // already removed the rest. Unlocking more mid-visit leaves what was on
    // screen where it was and adds the new band shuffled among itself.
    // cover_blur comes along for the lock panel's preview. It is a base64 data
    // URI of around 1.7 KB, and it used to be sent on the list for every set on
    // the platform — twice, under two names — when it is only ever drawn for
    // the one set a fan actually opens. Fetched here instead, with the set.
    const { rows: coverRows } = await pool.query(`SELECT cover_key, cover_blur FROM sets WHERE id = $1`, [setId]);
    const ordered = shuffleWithinBands(visibleItems, req.query.seed, {
      coverKey: coverRows[0]?.cover_key || null,
    });

    // Likes on each photograph, and whether this person put one there.
    //
    // Fetched in one query rather than one per photograph: a set of two hundred
    // would otherwise be two hundred round trips to draw a heart.
    const itemIds = ordered.map((i) => i.id);
    const likeCounts = new Map();
    const viewCounts = new Map();
    const mine = new Set();
    if (itemIds.length) {
      const [lc, vc] = await Promise.all([
        pool.query(
          `SELECT item_id, count(*)::int AS n, bool_or(user_id = $2) AS mine
             FROM item_likes WHERE item_id = ANY($1) GROUP BY item_id`,
          [itemIds, req.user.userId]),
        pool.query(
          `SELECT item_id, count(*)::int AS n
             FROM item_views WHERE item_id = ANY($1) GROUP BY item_id`,
          [itemIds]),
      ]);
      for (const r of lc.rows) {
        likeCounts.set(r.item_id, r.n);
        if (r.mine) mine.add(r.item_id);
      }
      for (const r of vc.rows) viewCounts.set(r.item_id, r.n);
    }

    // The grid gets a thumbnail, the lightbox gets the real thing.
    //
    // Falling back to the original when there is no thumbnail yet is what
    // makes this safe to deploy before the backfill has finished, and what
    // makes a failed derivation degrade to the old behaviour rather than to a
    // broken tile. Videos have no derivatives at all and fall through here for
    // the same reason.
    // What a member may buy one at a time, and for how much.
    const photoPrices = await pricesForMember(userTier, { isGuest: userTier === 'guest' });

    // Purchase-only content is sold by the handful instead.
    //
    // It sits outside the tier ladder, so none of the grade prices reach it
    // and the only way in used to be the whole set. These are the quantities
    // on offer and what each costs, priced against the purchase-only portion
    // rather than the whole set so a set holding free photographs alongside
    // them charges for what is actually being sold.
    const poItems = items.filter((i) => i.tier_category === 'purchase_only');
    let purchasePreview = null;
    if (poItems.length >= 2 && !upsellUnlocked) {
      const guest = userTier === 'guest';
      const [discountPct, guestMultiplier] = await Promise.all([
        guest ? 0 : getDiscountForTier(userTier).catch(() => 0),
        guest ? getGuestMultiplier().catch(() => 1) : 1,
      ]);
      const { rows: setPriceRows } = await pool.query(
        `SELECT price_coins FROM sets WHERE id = $1`, [setId]);
      const blockPrice = purchaseOnlyBlockPrice({
        setPriceCoins: setPriceRows[0]?.price_coins, totalItems: items.length,
        purchaseOnlyCount: poItems.length, discountPct, guestMultiplier, isGuest: guest,
      });
      purchasePreview = {
        total:     poItems.length,
        owned:     poItems.filter((i) => ownedItemIds.has(i.id)).length,
        max:       maxPurchaseOnlyPreview(poItems.length),
        blockPrice: Math.ceil(blockPrice),
        options:   purchaseOnlyOptions({
          blockPrice,
          purchaseOnlyCount: poItems.length,
          alreadyPaid: Number(boughtRows[0]?.coins_paid) || 0,
        }).filter((o) => o.photos > (poItems.filter((i) => ownedItemIds.has(i.id)).length)),
      };
    }

    // The whole set is returned, so this is the line that decides what a
    // locked photograph actually hands over. It must stay a whitelist: build
    // the safe shape first and add the real keys only once canSee has passed.
    // Spreading the row and then deleting fields would mean one new column in
    // the SELECT could quietly ship the original to somebody who has not paid.
    const itemsWithUrls = ordered.map((item) => {
      const unlocked = canSee(item);
      const grade    = item.tier_category || 'unsorted';
      const base = {
        id: item.id,
        media_type: item.media_type,
        position: item.position,
        tier_category: grade,
        locked: !unlocked,
        owned: ownedItemIds.has(item.id),
        likes: likeCounts.get(item.id) || 0,
        views: viewCounts.get(item.id) || 0,
        likedByMe: mine.has(item.id),
      };

      if (unlocked) {
        return {
          ...base,
          media_url: toUrl(item.r2_key),
          thumb_url: toUrl(item.thumb_key) || toUrl(item.r2_key),
        };
      }

      // Locked: the blurred placeholder, the grade, and what one costs. No
      // key, no original, no thumbnail. A photograph with no blur yet — the
      // backfill has not reached it, or it is a video — sends nothing at all
      // and the page draws its own placeholder.
      //
      // A price only where there is something to sell.
      //
      // Everything at or below a member's own grade is locked before the set
      // is opened and included the moment it is, so quoting a price for it
      // would be charging for what the membership already covers. An Insider
      // looking at an unopened set should see a bare lock on the community
      // and insider photographs and a price only on premium and supreme. A
      // Supreme member should see no price anywhere.
      //
      // withinTier travels with the row so the panel can say which of the two
      // it is: "open the set" or "this is above your grade".
      const withinTier = meetsCategory(userTier, grade);
      return {
        ...base,
        blur_url: toUrl(item.blur_key),
        withinTier,
        price: withinTier ? null : (photoPrices[grade] ?? null),
      };
    });

    // The vote, if this set is one of the fit checks.
    let fitCheck = null;
    const { rows: setRows } = await pool.query(
      `SELECT category, published_at, created_at FROM sets WHERE id = $1`, [setId]);
    if (setRows[0]?.category === 'fit_check') {
      const opened = new Date(setRows[0].published_at || setRows[0].created_at);
      const closes = new Date(opened.getTime() + 24 * 60 * 60 * 1000);
      const { rows: v } = await pool.query(
        `SELECT count(*) FILTER (WHERE verdict = 'keep')::int   AS keep,
                count(*) FILTER (WHERE verdict = 'return')::int AS ret,
                max(verdict) FILTER (WHERE user_id = $2)        AS yours
           FROM fit_votes WHERE set_id = $1`,
        [setId, req.user.userId]
      );
      fitCheck = {
        open: Date.now() <= closes.getTime(),
        closesAt: closes,
        // When the look was posted, so the card can date itself. A fit check is
        // about a particular day, and one from last Tuesday reads differently
        // from one from this morning.
        postedAt: opened,
        keep: v[0].keep,
        return: v[0].ret,
        yours: v[0].yours || null,
      };
    }

    res.json({
      items: itemsWithUrls,
      fitCheck,
      previewUrl: coverRows[0]?.cover_blur || null,
      // What a single photograph costs at each grade, for this member, with
      // their discount already applied. Sent once rather than on every tile.
      photoPrices,
      purchasePreview,
      // What they have already spent on photographs from this set, which comes
      // off the price of unlocking the rest.
      photosOwned: ownedItemIds.size,
      photosPaid:  Number(boughtRows[0]?.coins_paid) || 0,
      userTier,
    });
  } catch (err) {
    console.error('gallery/items error:', err);
    res.status(500).json({ error: 'Failed to load set items' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/gallery/sets/:setId
// ─────────────────────────────────────────────

// Guarded the way every other artist-only route is guarded.
//
// This compared `req.user.email` against an ARTIST_EMAIL environment variable,
// and the token carries no email at all — only userId, sessionId and isArtist.
// So the comparison was `undefined` against the variable, and the behaviour
// depended entirely on whether that variable happened to be set on the API
// service: set, and it refused everybody, leaving the route dead; unset, and
// `undefined !== undefined` is false, so the guard admitted any signed-in fan
// to a handler that deletes a set, its media rows, and every access_grant
// recording what fans paid for it.
//
// It was set, so this was the dead version rather than the open one. Either way
// the test was never meaningful; isArtist is the claim the middleware actually
// issues and the one every other protected route reads.
router.delete('/sets/:setId', authMid, artistOnly, async (req, res) => {

  const { setId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query(`SELECT r2_key FROM set_items WHERE set_id = $1`, [setId]);
    await client.query(`DELETE FROM set_items WHERE set_id = $1`, [setId]);
    await client.query(`DELETE FROM access_grants WHERE set_id = $1`, [setId]);
    await client.query(`DELETE FROM sets WHERE id = $1`, [setId]);
    await client.query('COMMIT');
    res.json({ ok: true, deletedItems: items.length, r2Keys: items.map((i) => i.r2_key) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('gallery/delete error:', err);
    res.status(500).json({ error: 'Failed to delete set' });
  } finally {
    client.release();
  }
});

module.exports = router;