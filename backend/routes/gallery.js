// backend/routes/gallery.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const { effectiveMembership } = require('../lib/membership');
const { shuffleWithinBands } = require('../lib/shuffle');
const { upgradeOptions } = require('./membership');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { notifyArtist } = require('../lib/notify');
const { getGuestMultiplier, getDiscountForTier, getConfigNumber } = require('../lib/config');
const { assertNotBlocked } = require('../lib/moderation');
const { roundTokensUp } = require('../lib/pricing');
const { getAllotmentPeriodKey } = require('../lib/time');
const { spendTokens } = require('../lib/tokens');

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
// allowance is spent, the sole thing that changes that is a tier with no cap.
function membershipTierFor(items, userTier, tierPriceNow) {
  const graded = items.filter((i) => i.tier_category !== 'free' && i.tier_category !== 'purchase_only');
  if (!graded.length) return null;

  const highest = graded
    .map((i) => i.tier_category)
    .reduce((a, b) => (TIER_ORDER.indexOf(b) > TIER_ORDER.indexOf(a) ? b : a));

  if (TIER_ORDER.indexOf(highest) > TIER_ORDER.indexOf(userTier)) return highest;

  // Already high enough, so this is the allowance running out rather than the
  // tier being short. Only an uncapped tier answers that.
  if (tierPriceNow > 0) {
    const uncapped = 'supreme';
    if (TIER_ORDER.indexOf(uncapped) > TIER_ORDER.indexOf(userTier)) return uncapped;
  }
  return null;
}

function isEffectivelyUnlocked(grantType, membershipCurrentlyActive) {
  if (!grantType) return false;
  if (grantType === 'unlock_credit') return membershipCurrentlyActive;
  return true;
}

// What the next set at your own level costs, given how many you have already
// opened this period. A ladder rather than a cliff: generous where nearly
// everybody is, a little where somebody is reading a lot, and full price only
// where the membership has plainly stopped being a membership.
//
// A cap of 0 means uncapped, which is how a tier is exempted entirely.
function nextOpenCost(opened, bands, fullTierPrice) {
  const { openCap, band2Until, band2Cost, band3Until, band3Cost } = bands;
  if (!openCap)                 return 0;              // uncapped
  if (opened < openCap)         return 0;              // included
  if (opened < band2Until)      return band2Cost;
  if (opened < band3Until)      return band3Cost;
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

router.get('/sets', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance FROM users WHERE id = $1`,
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
    const [openCap, band2Until, band2Cost, band3Until, band3Cost] = await Promise.all([
      isGuest ? 0 : getConfigNumber(`tier_open_cap_${userTier}`).catch(() => 0),
      getConfigNumber('tier_open_band2_until').catch(() => 30),
      getConfigNumber('tier_open_band2_cost').catch(() => 1),
      getConfigNumber('tier_open_band3_until').catch(() => 50),
      getConfigNumber('tier_open_band3_cost').catch(() => 3),
    ]);
    const bands = { openCap, band2Until, band2Cost, band3Until, band3Cost };

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

    // Price sorting stopped meaning anything once membership became access —
    // a member pays nothing for their own level, so most sets cost the same and
    // the order came out identical to newest. What a fan actually wants to know
    // is which sets are open to them.
    const sortBy = ['newest', 'free_for_all', 'free_for_me', 'locked'].includes(req.query.sort)
      ? req.query.sort : 'newest';

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
              ) AS cover_key
       FROM sets s
       WHERE s.visible = TRUE AND s.is_collection = FALSE
       -- Ordered by when it became available, falling back to upload date for
       -- anything published before that was recorded.
       ORDER BY COALESCE(s.published_at, s.created_at) DESC`
    );

    const { rows: allItems } = await pool.query(
      `SELECT set_id, r2_key, media_type, tier_category FROM set_items`
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
        type: s.type,
        category: s.category,
        // A locked cover never sends the real image. Blurring it in CSS meant
        // the full photo was in the page and one Reader-mode keystroke away —
        // this sends a 24px version instead, which cannot be sharpened because
        // the detail was never there.
        cover_url: coverBlurred ? (s.cover_blur || null) : toUrl(s.cover_key),
        photoCount: counts.photos,
        videoCount: counts.videos,
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
          const t = membershipTierFor(items, userTier, segments.tierPrice);
          if (!t || !tierOpts[t]) return null;
          return { tier: t, ...tierOpts[t] };
        })(),

        tierPrice: segments.tierPrice,
        upsellPrice: segments.upsellPrice,
        tierPreviewUrl:   s.cover_blur || null,
        upsellPreviewUrl: s.cover_blur || null,

        coverBlurred,
      };
    });

    // Price sorting happens here rather than in SQL, because what a fan pays
    // depends on their tier and is only known after the per-fan calculation
    // above. The query's own ordering stands for 'newest'.
    // Open to them without paying: free to everyone, or within their tier.
    const freeToThem = (s) => s.isFreeForAll || (s.tierPortionCount > 0 && s.tierPrice === 0);
    if (sortBy === 'free_for_me')  setsWithData = setsWithData.filter(freeToThem);
    if (sortBy === 'free_for_all') setsWithData = setsWithData.filter((s) => s.isFreeForAll);
    // Anything with something still behind a wall for this fan — either the set
    // itself, or an exclusive portion of it they have not bought.
    if (sortBy === 'locked')       setsWithData = setsWithData.filter((s) => !freeToThem(s) || s.upsellPrice > 0);

    const freeForAll = setsWithData.filter((s) => s.isFreeForAll);
    const unlockable = setsWithData.filter((s) => !s.isFreeForAll);

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
      // One list, already in the requested order. freeForAll and unlockable are
      // kept for anything still reading them, but concatenating those two is
      // what put free sets last regardless of sort.
      sets: setsWithData,
      freeForAll,
      unlockable,
      userTier,
      isGuest,
      discountPct,
      coinBalance: user.coin_balance,
      opensRemaining,
      openCap,
      opensUsed,
      opensResetOn,
      bands: { openCap, band2Until, band2Cost, band3Until, band3Cost },
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
      `SELECT tier, membership_expires_at, membership_started_at, coin_balance, display_name FROM users WHERE id = $1 FOR UPDATE`,
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
    const monthKeyForCap = getAllotmentPeriodKey(user.membership_started_at);
    const [capForTier, overageForTier] = await Promise.all([
      isGuest ? 0 : getConfigNumber(`tier_open_cap_${userTier}`).catch(() => 0),
      getConfigNumber('tier_open_overage_cost').catch(() => 1),
    ]);
    const { rows: capRows } = await client.query(
      `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2`,
      [req.user.userId, monthKeyForCap]
    );
    const alreadyOpened = capRows[0]?.unlocks_used || 0;
    const atCap = !isGuest && capForTier > 0 && alreadyOpened >= capForTier;

    const segments = computeSegments(itemRows, userTier, set.price_coins, discountPct, isGuest, guestMultiplier, atCap, overageForTier);

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

    // Opening a set at your own level is included, and every open is recorded.
    // Past the included allowance the price climbs in bands rather than jumping
    // to one flat figure — the 16th set and the 60th are not the same thing.
    //
    // Counted only for members, and only for the tier scope: an upsell is bought
    // separately and has nothing to do with the allowance.
    if (scope === 'tier' && segments.tierPortionCount > 0 && !isGuest) {
      const monthKey = getAllotmentPeriodKey(user.membership_started_at);
      const [openCap, band2Until, band2Cost, band3Until, band3Cost] = await Promise.all([
        getConfigNumber(`tier_open_cap_${userTier}`).catch(() => 0),
        getConfigNumber('tier_open_band2_until').catch(() => 30),
        getConfigNumber('tier_open_band2_cost').catch(() => 1),
        getConfigNumber('tier_open_band3_until').catch(() => 50),
        getConfigNumber('tier_open_band3_cost').catch(() => 3),
      ]);

      const { rows: allotRows } = await client.query(
        `SELECT unlocks_used FROM monthly_allotments WHERE user_id = $1 AND month_key = $2 FOR UPDATE`,
        [req.user.userId, monthKey]
      );
      const used = allotRows[0]?.unlocks_used || 0;

      // Recomputed here rather than trusting what the gallery sent, so the
      // charge cannot be influenced by a stale page.
      price = nextOpenCost(used, { openCap, band2Until, band2Cost, band3Until, band3Cost },
                           segments.tierFullPrice);
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
      url:   '/content',
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
      `SELECT id, r2_key, media_type, position, tier_category
       FROM set_items WHERE set_id = $1 ORDER BY position ASC, created_at ASC`,
      [setId]
    );

    const visibleItems = items.filter((item) => {
      if (item.tier_category === 'free') return true;
      if (item.tier_category === 'purchase_only') return upsellUnlocked;
      const isTierReachable = meetsCategory(userTier, item.tier_category);
      if (isTierReachable) return tierUnlocked;
      return upsellUnlocked;
    });

    // Shuffled per viewing, within tier bands, cover first.
    //
    // Only what somebody can actually see is shuffled; the filter above has
    // already removed the rest. Unlocking more mid-visit leaves what was on
    // screen where it was and adds the new band shuffled among itself.
    const { rows: coverRows } = await pool.query(`SELECT cover_key FROM sets WHERE id = $1`, [setId]);
    const ordered = shuffleWithinBands(visibleItems, req.query.seed, {
      coverKey: coverRows[0]?.cover_key || null,
    });

    const itemsWithUrls = ordered.map((item) => ({ ...item, media_url: toUrl(item.r2_key) }));
    res.json({ items: itemsWithUrls });
  } catch (err) {
    console.error('gallery/items error:', err);
    res.status(500).json({ error: 'Failed to load set items' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/gallery/sets/:setId
// ─────────────────────────────────────────────

router.delete('/sets/:setId', authMid, async (req, res) => {
  if (req.user.email !== process.env.ARTIST_EMAIL) {
    return res.status(403).json({ error: 'Not authorised' });
  }

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