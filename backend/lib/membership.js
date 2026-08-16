// backend/lib/membership.js
//
// One answer to "what tier is this person on, right now".
//
// Nothing writes users.tier back to guest when a membership lapses — the row
// keeps saying premium and every reader is expected to check the expiry itself.
// That worked while the only question was active or not, and it was already
// answered in ten separate places. A trial adds a second window on top, and ten
// copies of a two-window rule is nine chances for them to disagree about what
// somebody paid for.
//
// So it is answered here, once.

const TIER_ORDER = ['guest', 'community', 'insider', 'premium', 'supreme'];

// A trial sits above the base membership rather than replacing it. Somebody
// part-way through an annual Community term who wants Premium for a month keeps
// the term they bought: the trial runs alongside it and lapses on its own, and
// the base membership is still there underneath, undisturbed.
//
// Trials are only sold where the base term outlasts them, so a trial can never
// outlive the membership it sits on. That is enforced at the point of sale —
// but this reads the dates rather than assuming, because a gift or a refund
// could shorten a term after the fact.
function effectiveMembership(user, now = new Date()) {
  const baseTier    = user?.tier || 'guest';
  const baseExpires = user?.membership_expires_at ? new Date(user.membership_expires_at) : null;
  const baseActive  = Boolean(baseExpires && baseExpires > now);

  const trialTier  = user?.trial_tier || null;
  const trialEnds  = user?.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialLive  = Boolean(trialTier && trialEnds && trialEnds > now);

  // A trial only counts while the base membership does. Should a term be cut
  // short after a trial was sold, the trial goes with it rather than leaving
  // somebody on Premium with nothing underneath.
  const trialing = trialLive && baseActive
    && TIER_ORDER.indexOf(trialTier) > TIER_ORDER.indexOf(baseTier);

  return {
    isActive:  baseActive,
    tier:      baseActive ? (trialing ? trialTier : baseTier) : 'guest',
    baseTier:  baseActive ? baseTier : 'guest',
    expiresAt: baseExpires,
    trialing,
    trialTier: trialing ? trialTier : null,
    trialEndsAt: trialing ? trialEnds : null,
    // Where the allowance cycle starts. A trial buys a month at a higher tier,
    // and a month at a higher tier means that tier's allowance — so the count
    // runs from the day the trial began, not from a renewal date months back
    // that would arrive already spent.
    allowanceSince: trialing && user.trial_started_at
      ? new Date(user.trial_started_at)
      : (user?.membership_started_at ? new Date(user.membership_started_at) : null),
  };
}

// What is left of what they paid, at the rate they actually paid it.
//
// Deliberately their real rate rather than the tier's list price: an annual term
// is nine months' money for twelve, so crediting at list would hand back more
// than ever came in. A gifted membership has no paid tokens and is worth nothing
// here, which is right — nothing was paid for it.
function unusedValue(user, now = new Date()) {
  const paid = parseInt(user?.membership_paid_tokens, 10) || 0;
  const days = parseInt(user?.membership_term_days, 10) || 0;
  if (paid <= 0 || days <= 0) return 0;

  const expires = user?.membership_expires_at ? new Date(user.membership_expires_at) : null;
  if (!expires || expires <= now) return 0;

  const remaining = Math.max(0, Math.ceil((expires - now) / 86400000));
  return Math.min(paid, Math.floor((paid / days) * Math.min(remaining, days)));
}

function daysRemaining(user, now = new Date()) {
  const expires = user?.membership_expires_at ? new Date(user.membership_expires_at) : null;
  if (!expires || expires <= now) return 0;
  return Math.ceil((expires - now) / 86400000);
}

module.exports = { TIER_ORDER, effectiveMembership, unusedValue, daysRemaining };