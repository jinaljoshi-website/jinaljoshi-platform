// backend/lib/photoPrice.js
//
// What one photograph costs when it sits above the member's tier.
//
// ── Why a flat price per grade ──────────────────────────────────────
//
// The gallery has always priced a set's contents pro-rata: base price divided
// by how many photographs it holds. That means a supreme-graded photograph and
// a free one in the same set cost exactly the same, and a supreme photograph
// in a cheap set costs less than an insider photograph in an expensive one.
// Grade decided what you could reach, never what it was worth.
//
// So these are flat, by grade, and independent of the set's own price. They
// are calibrated against the membership ladder rather than against set prices,
// because what a single photograph competes with is upgrading: at these
// figures it takes about five insider photographs to equal a month of Insider,
// and eight or nine supreme ones to equal a month of Supreme. Buy a couple, or
// upgrade — which is the choice we want a member to be making.
//
// ── Not required config ─────────────────────────────────────────────
//
// Deliberately absent from REQUIRED_PRICING. A key in that set throws at the
// point of use when it is missing, and a missing price here would break the
// gallery for everybody rather than quietly falling back. These read from
// config when present and use the figures below when not, so the feature works
// the moment the code lands and becomes tunable from Studio afterwards.

const { getConfigNumber, getDiscountForTier } = require('./config');
const { roundTokensUp } = require('./pricing');

const DEFAULTS = {
  insider: 3,
  premium: 10,
  supreme: 50,
};

// The grades a photograph can carry that are buyable one at a time.
//
// 'free' and 'community' are not here: every member reaches community content,
// so there is nothing to sell. 'purchase_only' is not here either — it sits
// outside the tier ladder entirely and wants a price of its own, which is a
// conversation still to be had.
const PRICED_GRADES = ['insider', 'premium', 'supreme'];

const KEY = (grade) => `photo_price_${grade}`;

// One grade's list price, before any member discount.
async function listPriceFor(grade) {
  if (!PRICED_GRADES.includes(grade)) return null;
  try {
    const v = await getConfigNumber(KEY(grade));
    return Number.isFinite(v) && v > 0 ? v : DEFAULTS[grade];
  } catch {
    return DEFAULTS[grade];
  }
}

// Every grade at once, which is what a set page needs — it may hold all three.
async function listPrices() {
  const vals = await Promise.all(PRICED_GRADES.map(listPriceFor));
  return PRICED_GRADES.reduce((acc, g, i) => { acc[g] = vals[i]; return acc; }, {});
}

// What this member pays for one photograph of this grade.
//
// Their tier discount applies, as it does to everything else they buy. Guests
// are not offered this at all — buying a photograph is a membership feature,
// and a guest has no tier for anything to sit above.
async function priceForMember(grade, userTier, { isGuest = false } = {}) {
  if (isGuest) return null;
  const list = await listPriceFor(grade);
  if (list === null) return null;
  const discountPct = await getDiscountForTier(userTier).catch(() => 0);
  return discountPct ? roundTokensUp(list * (1 - discountPct / 100)) : roundTokensUp(list);
}

// Every price this member would pay, keyed by grade.
async function pricesForMember(userTier, { isGuest = false } = {}) {
  if (isGuest) return {};
  const [list, discountPct] = await Promise.all([
    listPrices(),
    getDiscountForTier(userTier).catch(() => 0),
  ]);
  const out = {};
  for (const g of PRICED_GRADES) {
    out[g] = discountPct ? roundTokensUp(list[g] * (1 - discountPct / 100)) : roundTokensUp(list[g]);
  }
  return out;
}

// ── Purchase-only, bought a few at a time ───────────────────────────
//
// Purchase-only content sits outside the tier ladder: no membership reaches
// it at any level, which is why none of the flat grade prices above apply to
// it. Until now the only way in was the whole set.
//
// So it gets what the private collection gets — a quantity, priced per
// photograph with the same fifth on top for breaking the set open. The markup
// does the same job here: every photograph bought singly comes to 120% of the
// block, so taking the set whole is always the better deal and it cannot be
// assembled out of previews.
//
// Priced against the purchase-only portion rather than the whole set, so a
// set holding free photographs alongside them charges for what is actually
// being sold.
const { PREVIEW_MARKUP, maxPreviewPhotos, priceFor, dueFor } = require('./collectionPreview');

// What the purchase-only part of a set is worth to this member, before any
// preview markup: the set's own price, pro-rated by how much of it that part
// is, then their discount or the guest surcharge.
function purchaseOnlyBlockPrice({ setPriceCoins, totalItems, purchaseOnlyCount, discountPct = 0, guestMultiplier = 1, isGuest = false }) {
  const base  = Number(setPriceCoins) || 0;
  const total = Math.max(1, Number(totalItems) || 1);
  const share = base * (Math.max(0, Number(purchaseOnlyCount) || 0) / total);
  return isGuest ? share * guestMultiplier : share * (1 - (Number(discountPct) || 0) / 100);
}

// The quantities on offer and what each costs, in the shape the collections
// dropdown already uses — so one component can render either.
function purchaseOnlyOptions({ blockPrice, purchaseOnlyCount, alreadyPaid = 0 }) {
  const max = maxPreviewPhotos(purchaseOnlyCount);
  const out = [];
  for (let n = 1; n <= max; n++) {
    const price = priceFor(n, blockPrice, purchaseOnlyCount);
    out.push({
      kind: 'preview',
      photos: n,
      price,
      due: Math.max(0, price - alreadyPaid),
      setIsBetter: price >= Math.ceil(blockPrice),
    });
  }
  return out;
}

module.exports = {
  PREVIEW_MARKUP,
  purchaseOnlyBlockPrice,
  purchaseOnlyOptions,
  purchaseOnlyPriceFor: priceFor,
  purchaseOnlyDueFor: dueFor,
  maxPurchaseOnlyPreview: maxPreviewPhotos,
  DEFAULTS,
  PRICED_GRADES,
  KEY,
  listPriceFor,
  listPrices,
  priceForMember,
  pricesForMember,
};