// backend/lib/collections.js
//
// Who can see the private collection, and how that is earned.
//
// Named plainly, everywhere: columns, routes, and the paths that ship in the
// bundle where anybody can read them. A section called collections draws no
// attention from somebody who cannot open it, and that is the whole of what a
// name can do — a path in a JavaScript bundle is never actually hidden.
//
// What keeps it shut is the server answering 404 to anybody without access, so
// there is nothing to find by looking and nothing to confirm by guessing.
//
// Three ways in. A Supreme membership carries it for as long as the membership
// runs. Money spent on the platform earns it in tranches — every full threshold
// paid adds a fixed span. And Jinal can grant it by hand, for as long as she
// likes, to whoever she likes.
//
// Nothing about it is advertised, and nothing about it is promised. A span that
// has been earned runs out on its own and is not renewed by anything except
// spending again. There is no floor to maintain and nothing to keep up with: a
// quiet month costs somebody nothing they already hold.

const { getConfigNumber } = require('./config');
const { effectiveMembership } = require('./membership');

// The tier that carries access on its own.
const CARRYING_TIER = 'supreme';

// Whether this person can see it, right now.
//
// Takes a row rather than an id so a caller that has already loaded the user —
// which is nearly all of them — does not go back to the database for it.
function hasCollectionsAccess(user, now = new Date()) {
  if (!user) return false;

  // The bar, read before any of the three ways in.
  //
  // This is the one thing that outranks a Supreme membership. Supreme reaches
  // the collection through the tier rather than through a stored grant, so
  // there was previously nothing to take away short of downgrading the
  // membership — which would also remove everything else they paid for, a far
  // larger punishment than the one intended. The flag removes the collection
  // and leaves the rest of the membership exactly as it was.
  //
  // Checked first deliberately: a later check could be skipped by an early
  // return above it, and the point of this flag is that nothing gets past it.
  //
  // A caller that has not selected the column sees undefined, which is falsy,
  // and the bar would silently not apply — so every query feeding this
  // function selects it. There are two, and both do.
  if (user.collections_barred_at) return false;

  // Supreme carries it while the membership is live. effectiveMembership is
  // used rather than the raw column so a trial at Supreme counts: somebody who
  // is Supreme this month is Supreme for this purpose too.
  const state = effectiveMembership(user, now);
  if (state.isActive && state.tier === CARRYING_TIER) return true;

  return Boolean(user.collections_until && new Date(user.collections_until) > now);
}

// Money actually paid in, over the lifetime of the account.
//
// Read from the ledger's recorded rupee value rather than from tokens spent.
// What is being rewarded is contribution, and a token given away as a gift or a
// bonus was never anybody's money — counting it would hand out access for
// generosity that came from Jinal in the first place.
async function lifetimeMoneyIn(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(payment_amount_inr), 0)::float8 AS total
       FROM coin_ledger
      WHERE user_id = $1 AND type = 'recharge' AND direction = 'credit'`,
    [userId]
  );
  return rows[0].total || 0;
}

// Grants whatever new tranches this account has earned and extends the span.
//
// Idempotent by counter rather than by timing: collections_tranches records how many
// have already been paid out, so a webhook that arrives twice, or a verify call
// racing it, cannot grant the same span again. That mattered enough to design
// around — the two crediting paths for a payment both end up here.
//
// The extension runs from the existing expiry where one is still live, so
// spending again on the first day of a span adds to it rather than replacing
// it. Somebody who earns three tranches in a week holds the lot.
async function accrueCollectionsAccess(db, userId) {
  let threshold, span;
  try {
    threshold = await getConfigNumber('collections_threshold_inr');
    span      = await getConfigNumber('collections_days_per_tranche');
  } catch (err) {
    // Unconfigured means nobody earns access, which is the safe way to fail.
    // It must never be a reason a payment does not go through.
    console.error('collections: not configured —', err.message);
    return null;
  }
  if (!threshold || threshold <= 0 || !span || span <= 0) return null;

  const total = await lifetimeMoneyIn(db, userId);
  const earned = Math.floor(total / threshold);
  if (earned <= 0) return null;

  const { rows } = await db.query(
    `SELECT collections_tranches, collections_until FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (!rows.length) return null;

  const already = parseInt(rows[0].collections_tranches, 10) || 0;
  if (earned <= already) return null;

  // Earned, not granted.
  //
  // Spending enough now makes somebody eligible and tells Jinal so. It does not
  // open the collection. That is the one part of the platform where the whole
  // value is that not everybody is in it, and a threshold crossed by anybody
  // with a card is not much of a door.
  //
  // The tranche counter still moves, so the same spending is never offered
  // twice, and the days owed are held until she says yes. Her decision starts
  // the clock: somebody should not lose a fortnight of access to the time it
  // took her to see the message.
  const owedDays = (earned - already) * span;

  await db.query(
    `UPDATE users
        SET collections_tranches = $1,
            collections_days_owed = COALESCE(collections_days_owed, 0) + $2,
            collections_eligible_at = COALESCE(collections_eligible_at, NOW())
      WHERE id = $3`,
    [earned, owedDays, userId]
  );

  // Told, because a queue nobody looks at is not a decision anybody makes.
  //
  // Not awaited and its failure ignored: this runs inside the transaction that
  // credits a payment, and a push notification must never be the reason money
  // does not go through.
  try {
    const { notifyArtist } = require('./notify');
    const { rows: who } = await db.query(
      `SELECT display_name, email FROM users WHERE id = $1`, [userId]);
    const name = who[0]?.display_name || who[0]?.email || 'A member';
    notifyArtist({
      title: 'Someone has earned the collection',
      body:  `${name} has qualified for ${owedDays} days. Your call whether they get in.`,
      url:   '/collections',
      tag:   'collections-eligible',
    }).catch(() => {});
  } catch { /* never allowed to matter */ }

  return { granted: 0, eligible: true, tranches: earned, daysOwed: owedDays };
}

// A grant made by hand, for a chosen number of days. Extends a live span rather
// than replacing it, so a gift never takes away time already earned.
async function grantCollectionsAccess(db, userId, days) {
  const n = parseInt(days, 10);
  if (!n || n <= 0) return null;
  const { rows } = await db.query(
    `SELECT collections_until FROM users WHERE id = $1 FOR UPDATE`, [userId]
  );
  if (!rows.length) return null;
  const now  = new Date();
  const held = rows[0].collections_until ? new Date(rows[0].collections_until) : null;
  const from = held && held > now ? held : now;
  const until = new Date(from.getTime() + n * 86400000);
  await db.query(`UPDATE users SET collections_until = $1 WHERE id = $2`, [until, userId]);
  return { until };
}

// Letting somebody in, once she has decided to.
//
// The days they earned have been waiting; this is where they start counting.
// Deliberately the same helper a gift uses, because the difference between
// earning access and being given it is a matter of how it was decided, not of
// what happens afterwards.
async function approveCollectionsAccess(db, userId, daysOverride) {
  const { rows } = await db.query(
    `SELECT collections_days_owed FROM users WHERE id = $1 FOR UPDATE`, [userId]
  );
  if (!rows.length) return null;

  const days = parseInt(daysOverride, 10) || parseInt(rows[0].collections_days_owed, 10) || 0;
  if (days <= 0) return null;

  const granted = await grantCollectionsAccess(db, userId, days);

  // Cleared, so approving twice does not hand over the same fortnight again.
  await db.query(
    `UPDATE users
        SET collections_days_owed = 0,
            collections_approved_at = NOW()
      WHERE id = $1`,
    [userId]
  );

  return { ...granted, days };
}

module.exports = {
  approveCollectionsAccess,
  CARRYING_TIER,
  hasCollectionsAccess,
  lifetimeMoneyIn,
  accrueCollectionsAccess,
  grantCollectionsAccess,
};