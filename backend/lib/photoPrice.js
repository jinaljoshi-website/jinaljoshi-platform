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

module.exports = {
  DEFAULTS,
  PRICED_GRADES,
  KEY,
  listPriceFor,
  listPrices,
  priceForMember,
  pricesForMember,
};