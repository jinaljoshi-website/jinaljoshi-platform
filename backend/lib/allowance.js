// backend/lib/allowance.js
//
// What a member's monthly allowances actually are, once early renewals are
// taken into account.
//
// ── Why this is derived rather than stored ──────────────────────────
//
// Nothing writes a member's cap anywhere. The tier cap is read from
// platform_config on every request and the only per-member number in the
// system is how many opens they have used. That is deliberate and worth
// keeping: a stored cap would have to be migrated every time a config value
// changed, and the two would drift.
//
// So the renewal bonus is stored as one integer on the member — how many
// early renewals they are credited with — and the raised numbers are worked
// out here, at the point of use, exactly as the base numbers already are.
//
// There is a second reason, and it is the one that would have bitten us. The
// monthly period is not a row with a start and an end: it is a string derived
// from membership_started_at, and /upgrade deliberately moves that date to
// reset the counter. A bonus recorded against a period would be lost or
// duplicated the moment somebody upgraded. Hung off the member, it follows
// them through every path.

// Ten percent per early renewal, three renewals deep, then it stops. Past
// that Community's 30 becomes 42 and the ladder below starts to disappear.
const BONUS_STEP      = 0.10;
const BONUS_MAX_STEPS = 3;

// How many renewals are actually counting toward the bonus.
//
// Clamped at both ends: a null streak on a member who has never renewed, and
// the ceiling for somebody who has renewed a dozen times.
function bonusSteps(user) {
  const n = Number(user && user.renewal_streak);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), BONUS_MAX_STEPS);
}

// 1, 1.1, 1.2 or 1.3.
function bonusMultiplier(user) {
  return 1 + BONUS_STEP * bonusSteps(user);
}

// Raise one allowance number, leaving the two special values alone.
//
// Zero and null both mean something other than "a limit of none": zero is
// "deliberately uncapped" and null is "we could not read the config". Neither
// may be multiplied — 0 × 1.3 is still 0, which looks harmless, but null × 1.3
// is NaN, and NaN flows straight past the Number.isFinite guard that stands
// between a config miss and giving the gallery away.
function raise(base, user) {
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0) return base;
  const steps = bonusSteps(user);
  if (!steps) return n;
  return Math.ceil(n * (1 + BONUS_STEP * steps));
}

// The whole open ladder, shifted.
//
// The bands are absolute positions — an extra open costs 1 token up to open
// 42 and 3 tokens up to 60 — so raising only the cap eats the cheap window
// instead of sitting above it. A Premium member who renews once would have a
// cap of 44, already past 42, and would lose the 1-token band completely:
// more free opens, but the next ones costing three times more. The reward
// would partly cancel itself.
//
// So the whole ladder moves by the same number of opens the cap gained, and
// every window stays exactly the size it was tuned to.
function applyRenewalBonus(bands, user) {
  const base = bands && bands.openCap;
  if (!Number.isFinite(base) || base <= 0) return bands;

  const raised = raise(base, user);
  const shift  = raised - base;
  if (!shift) return bands;

  return {
    ...bands,
    openCap:    raised,
    band2Until: Number.isFinite(bands.band2Until) ? bands.band2Until + shift : bands.band2Until,
    band3Until: Number.isFinite(bands.band3Until) ? bands.band3Until + shift : bands.band3Until,
  };
}

// The monthly free message count, raised on the same schedule.
//
// Only the monthly allowance moves. The daily cap is a rate limit rather than
// an allowance — it exists so a month's messages cannot arrive in one evening
// — and raising it would defeat the thing it is for.
function effectiveDmFree(baseFreePerMonth, user) {
  return raise(baseFreePerMonth, user);
}

// Every allowance this member actually has, config read included.
//
// The one place that answers "what are my numbers", so the membership page and
// the help page cannot drift apart from each other or from the gallery.
//
// Note the cap read does not simply trust getConfigNumber. These ladder keys
// are not in REQUIRED_PRICING, so a missing one comes back undefined rather
// than throwing, and a .catch() around it never fires — which is exactly the
// bug the help page has been carrying. Finite or null, nothing in between.
async function effectiveAllowances(user, tier) {
  if (!tier || tier === 'guest') return null;
  const { getConfigNumber, getDmConfigForTier } = require('./config');

  const [rawCap, dm] = await Promise.all([
    getConfigNumber(`tier_open_cap_${tier}`)
      .then((v) => (Number.isFinite(v) ? v : null))
      .catch(() => null),
    getDmConfigForTier(tier).catch(() => null),
  ]);

  const baseDm = dm ? dm.freeDMsPerMonth : null;

  return {
    // 0 stays 0, which means uncapped — Supreme has no set-open limit to raise.
    openCap:        raise(rawCap, user),
    openCapBase:    rawCap,
    dmFreePerMonth: raise(baseDm, user),
    dmFreeBase:     baseDm,
    // Unchanged on purpose: a daily cap is a rate limit, not an allowance.
    dmDailyCap:     dm ? dm.dailyDMCap : null,
  };
}

// What the fan app needs to explain the number it is showing.
//
// Sent alongside the raised figures so the page never has to recompute them
// and risk disagreeing with what the member is actually charged.
function renewalSummary(user) {
  const steps = bonusSteps(user);
  return {
    renewals:   steps,
    bonusPct:   Math.round(BONUS_STEP * steps * 100),
    atCeiling:  steps >= BONUS_MAX_STEPS,
    maxPct:     Math.round(BONUS_STEP * BONUS_MAX_STEPS * 100),
  };
}

// What renewing before expiry is actually worth to this member, in words.
//
// One place, because the push notification and the email say the same thing
// and a promise that differs between the two is worse than one that is only
// in one of them. Both read from here.
//
// It has to be true of the person reading it. Somebody already at the ceiling
// gains nothing further and is told what they would lose instead; a Supreme
// member's set opens are already unlimited, so the rise applies to their
// messages and the reward worth naming is the calls.
function renewalBenefits(user) {
  const { renewals, atCeiling, maxPct } = renewalSummary(user);
  const nextPct   = Math.min(Math.round(BONUS_STEP * (renewals + 1) * 100), maxPct);
  const isSupreme = user && user.tier === 'supreme';

  const { RENEWAL_GIFT_CALLS, FREE_CALL_MINUTES } = require('./freecalls');

  const lines = [];
  if (atCeiling) {
    lines.push(isSupreme
      ? 'Your allowances stay where they are. Let it lapse and they go back to the standard amount.'
      : 'Your raised set and message allowances stay as they are. Let it lapse and they reset.');
  } else {
    lines.push(isSupreme
      ? `Your monthly message allowance goes up ${nextPct}%. Set opens are already unlimited at your level.`
      : `Your monthly set opens and messages both go up ${nextPct}%, and again on the next renewal, up to ${maxPct}%.`);
  }

  if (isSupreme) {
    lines.push(`Next month includes ${RENEWAL_GIFT_CALLS + 1} calls instead of one, ${FREE_CALL_MINUTES} minutes each.`);
  }

  return {
    atCeiling,
    nextPct,
    isSupreme,
    headline: atCeiling
      ? 'Renew before it ends to keep what you have built up.'
      : `Renew before it ends and your allowances go up ${nextPct}%.`,
    lines,
  };
}

module.exports = {
  BONUS_STEP,
  BONUS_MAX_STEPS,
  bonusSteps,
  bonusMultiplier,
  raise,
  applyRenewalBonus,
  effectiveDmFree,
  effectiveAllowances,
  renewalSummary,
  renewalBenefits,
};