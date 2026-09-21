// backend/lib/tokens.js
// Single place where token spending, gifting and refunding are decided.
//
// Three pots:
//   purchased — users.coin_balance, bought with real money, never expires
//   bonus     — users.bonus_balance, a discount given as quantity, never expires
//   gifted    — gifted_grants rows, granted by Jinal or on signup, expires
//
// Spent gifted first, then bonus, then purchased. Gifted goes first because it
// is the only pot that expires, so anything else would let a gift lapse while
// money the fan could have kept was spent instead.
//
// Bonus tokens are a discount expressed as quantity rather than price: paying
// full price for 500 and receiving 550 rather than paying 10% less for 500. The
// money collected and the tax on it are the same either way, which is why they
// are spendable anywhere purchased tokens are — but they are not revenue, so
// they must never reach a photographer's earnings or a charity's share.
//
// Gifted tokens remain limited to things with no outside cost: messages and
// gallery unlocks. Anything with a real-world obligation — merchandise,
// outfits, calls, custom requests, membership — needs money behind it.
const { getConfigNumber } = require('./config');

const GIFT_ELIGIBLE = new Set(['dm_charge', 'content_unlock', 'chat_media_unlock']);

function giftEligible(type) {
  return GIFT_ELIGIBLE.has(type);
}

// Live gifted balance is always derived, never cached, so it cannot drift and
// expiry needs no scheduled job to stay correct.
async function getBalances(db, userId) {
  const { rows: u } = await db.query(
    `SELECT coin_balance, COALESCE(bonus_balance, 0) AS bonus_balance FROM users WHERE id = $1`,
    [userId]
  );
  const { rows: g } = await db.query(
    `SELECT COALESCE(SUM(remaining), 0)::int AS gifted,
            MIN(expires_at) FILTER (WHERE remaining > 0) AS next_expiry
     FROM gifted_grants
     WHERE user_id = $1 AND remaining > 0 AND expires_at > NOW()`,
    [userId]
  );
  const purchased = u[0]?.coin_balance || 0;
  const bonus     = u[0]?.bonus_balance || 0;
  const gifted    = g[0]?.gifted || 0;
  const nextExpiry = g[0]?.next_expiry || null;
  return {
    purchased,
    bonus,
    gifted,
    // What can be spent on something with a real cost behind it.
    spendableAnywhere: purchased + bonus,
    total: purchased + bonus + gifted,
    giftedExpiresAt: nextExpiry,
    giftedExpiresInDays: nextExpiry
      ? Math.max(0, Math.ceil((new Date(nextExpiry) - Date.now()) / 86400000))
      : null,
  };
}

function insufficientError({ required, purchased, bonus = 0, gifted, allowGifted, spendType }) {
  const usable  = allowGifted ? purchased + bonus + gifted : purchased + bonus;
  const err     = new Error('INSUFFICIENT_TOKENS');
  err.code      = 'INSUFFICIENT_TOKENS';

  // Where the gifted tokens can go instead.
  //
  // Saying only that there are not enough leaves somebody staring at a balance
  // that looks sufficient. The old wording said gifted tokens work for messages
  // and content — true of the gallery, and no longer true of the collection, so
  // it needs to say which.
  const giftedNote = (!allowGifted && gifted > 0)
    ? spendType === 'content_unlock'
      ? ` Your ${gifted} gifted tokens can be spent in the gallery, but not here.`
      : ` Your ${gifted} gifted tokens can only be used for messages and content.`
    : '';

  err.httpBody  = {
    error:    'INSUFFICIENT_TOKENS',
    message:  `This costs ${required} tokens. You have ${usable}.${giftedNote}`,
    required,
    available:          usable,
    shortBy:            required - usable,
    purchasedAvailable: purchased,
    bonusAvailable:     bonus,
    giftedAvailable:    gifted,
    giftedUsableHere:   allowGifted,
  };
  return err;
}

// Spends tokens and writes the ledger row in one step, so the split between pots
// is recorded everywhere without each caller having to remember. Must be called
// inside an open transaction — throws on insufficient funds, so the caller
// rolls back and returns err.httpBody.
async function spendTokens(client, { userId, amount, type, label, relatedId = null, allowGifted = null }) {
  const eligible = allowGifted === null ? giftEligible(type) : allowGifted;

  const { rows: uRows } = await client.query(
    `SELECT coin_balance, COALESCE(bonus_balance, 0) AS bonus_balance
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const purchased = uRows[0]?.coin_balance || 0;
  const bonus     = uRows[0]?.bonus_balance || 0;

  let grants = [];
  if (eligible) {
    const { rows } = await client.query(
      `SELECT id, remaining FROM gifted_grants
       WHERE user_id = $1 AND remaining > 0 AND expires_at > NOW()
       ORDER BY expires_at ASC
       FOR UPDATE`,
      [userId]
    );
    grants = rows;
  }
  const giftedAvailable = grants.reduce((s, g) => s + g.remaining, 0);

  // Gifted, then bonus, then purchased. Gifted expires, so spending it first is
  // the only order that does not let a gift lapse while money is spent instead.
  // Bonus before purchased for the same reason in reverse: purchased tokens are
  // the fan's own money and should be the last thing to go.
  const fromGifted    = eligible ? Math.min(amount, giftedAvailable) : 0;
  const afterGifted   = amount - fromGifted;
  const fromBonus     = Math.min(afterGifted, bonus);
  const fromPurchased = afterGifted - fromBonus;

  if (purchased < fromPurchased) {
    throw insufficientError({
      required: amount, purchased, bonus, gifted: giftedAvailable, allowGifted: eligible,
      spendType: type,
    });
  }

  let need = fromGifted;
  for (const g of grants) {
    if (need <= 0) break;
    const take = Math.min(need, g.remaining);
    await client.query(`UPDATE gifted_grants SET remaining = remaining - $1 WHERE id = $2`, [take, g.id]);
    need -= take;
  }

  if (fromBonus > 0) {
    await client.query(
      `UPDATE users SET bonus_balance = bonus_balance - $1 WHERE id = $2`,
      [fromBonus, userId]
    );
  }
  if (fromPurchased > 0) {
    await client.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
      [fromPurchased, userId]
    );
  }

  // Each pot recorded separately. Every revenue figure on the platform reads
  // from_purchased alone, so a bonus token can never be mistaken for money.
  const { rows: lRows } = await client.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id,
                              from_gifted, from_purchased, from_bonus)
     VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, type, amount, label, relatedId, fromGifted, fromPurchased, fromBonus]
  );

  return {
    ledgerId:      lRows[0].id,
    fromGifted,
    fromBonus,
    fromPurchased,
    newPurchased:  purchased - fromPurchased,
    newBonus:      bonus - fromBonus,
    newGifted:     giftedAvailable - fromGifted,
  };
}

// Adds a gift. Always creates a fresh grant with its own expiry.
async function grantGiftedTokens(client, { userId, amount, source = 'artist_gift', note = null, label = null }) {
  const days = (await getConfigNumber('gift_expiry_days')) || 30;
  const { rows } = await client.query(
    `INSERT INTO gifted_grants (user_id, amount, remaining, source, note, expires_at)
     VALUES ($1, $2, $2, $3, $4, NOW() + ($5 || ' days')::interval)
     RETURNING id, expires_at`,
    [userId, amount, source, note, String(days)]
  );
  await client.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, from_gifted, from_purchased)
     VALUES ($1, 'gift', 'credit', $2, $3, $2, 0)`,
    [userId, amount, label || `Gifted ${amount} tokens · expires in ${days} days`]
  );
  return rows[0];
}

// The single offer that applies right now.
//
// One offer, never two. A code and a sitewide push are alternatives, not
// ingredients -- adding a 20% code to a 20% sitewide offer would hand over 40%
// of a purchase, which is a loss dressed as a promotion.
//
// Where both exist the better one wins, even if that is the sitewide offer.
// Somebody who volunteered a code should never end up worse off than somebody
// who did nothing, and telling them their code "did not apply" when it in fact
// gave them more is a conversation nobody enjoys.
async function activeBonusOffer(db, code = null) {
  const { rows: universal } = await db.query(
    `SELECT * FROM bonus_offers
     WHERE active = TRUE AND code IS NULL
       AND starts_at <= NOW() AND ends_at > NOW()
       AND (max_uses IS NULL OR uses < max_uses)
     ORDER BY bonus_pct DESC LIMIT 1`
  );
  const sitewide = universal[0] || null;

  if (!code) return sitewide;

  const { rows: coded } = await db.query(
    `SELECT * FROM bonus_offers
     WHERE active = TRUE AND lower(code) = lower($1)
       AND starts_at <= NOW() AND ends_at > NOW()
       AND (max_uses IS NULL OR uses < max_uses)`,
    [String(code).trim()]
  );
  const coupon = coded[0] || null;

  if (!coupon)   return sitewide;
  if (!sitewide) return coupon;
  return parseFloat(coupon.bonus_pct) >= parseFloat(sitewide.bonus_pct) ? coupon : sitewide;
}

// How many bonus tokens a purchase earns. Always rounded down: 11.99 is 11.
// Rounding up would mean giving away a token nobody paid for on most purchases,
// and the difference is invisible per sale and real across thousands.
function bonusFor(tokens, offer) {
  if (!offer) return 0;
  if (tokens < (offer.min_tokens || 0)) return 0;
  return Math.floor((tokens * parseFloat(offer.bonus_pct)) / 100);
}

// Adds bonus tokens alongside a purchase. Recorded as its own credit so the
// ledger shows what was bought and what was given, rather than one inflated
// number that would later be mistaken for revenue.
async function grantBonusTokens(client, { userId, amount, offer, label = null }) {
  if (!amount || amount < 1) return null;
  await client.query(
    `UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + $1 WHERE id = $2`,
    [amount, userId]
  );
  await client.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label,
                              from_gifted, from_purchased, from_bonus, bonus_offer_id)
     VALUES ($1, 'bonus', 'credit', $2, $3, 0, 0, $2, $4)`,
    [userId, amount,
     // A manual grant carries no offer, and reading offer.bonus_pct off an
     // undefined offer would throw before the label was ever used.
     label || (offer
       ? `${offer.label || `${parseFloat(offer.bonus_pct)}% bonus`} — ${amount} extra tokens`
       : `${amount} bonus tokens`),
     offer?.id || null]
  );
  if (offer?.id) {
    await client.query(`UPDATE bonus_offers SET uses = uses + 1 WHERE id = $1`, [offer.id]);
  }
  return { amount, offerId: offer?.id || null };
}

// Returns a previous spend to the pots it originally came from. Gifted portions
// come back as a fresh grant with a new expiry window — the fan did not receive
// what they paid for, but a gift should not quietly become cash-equivalent.
async function refundLedgerEntry(client, { ledgerId, label, type = 'refund' }) {
  const { rows } = await client.query(
    `SELECT * FROM coin_ledger WHERE id = $1 FOR UPDATE`, [ledgerId]
  );
  if (!rows.length) throw new Error('Original transaction not found');
  const original = rows[0];
  if (original.direction !== 'debit') throw new Error('Only a spend can be refunded');
  if (original.refunded_at)          throw new Error('This transaction has already been refunded');

  const fromGifted    = original.from_gifted    || 0;
  const fromBonus     = original.from_bonus     || 0;
  const fromPurchased = original.from_purchased || ((fromGifted || fromBonus) ? 0 : original.amount);

  if (fromPurchased > 0) {
    await client.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
      [fromPurchased, original.user_id]
    );
  }
  // Bonus tokens go back as bonus tokens. Returning them as purchased would
  // turn a discount into money the platform never received.
  if (fromBonus > 0) {
    await client.query(
      `UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + $1 WHERE id = $2`,
      [fromBonus, original.user_id]
    );
  }
  if (fromGifted > 0) {
    const days = (await getConfigNumber('gift_expiry_days')) || 30;
    await client.query(
      `INSERT INTO gifted_grants (user_id, amount, remaining, source, note, expires_at)
       VALUES ($1, $2, $2, 'refund', $3, NOW() + ($4 || ' days')::interval)`,
      [original.user_id, fromGifted, `Refund of ${original.label || original.type}`, String(days)]
    );
  }

  await client.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id,
                              from_gifted, from_purchased, from_bonus)
     VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7, $8)`,
    [original.user_id, type, original.amount, label || `Refund: ${original.label || original.type}`,
     original.related_id, fromGifted, fromPurchased, fromBonus]
  );

  await client.query(`UPDATE coin_ledger SET refunded_at = NOW() WHERE id = $1`, [ledgerId]);

  return { fromGifted, fromBonus, fromPurchased, userId: original.user_id, amount: original.amount };
}

// Most refunds start from the thing being refunded — a call, a request, an order —
// rather than a ledger id. This finds the original spend for that thing and reverses
// it, so callers never have to store ledger ids alongside their own records.
async function refundByRelated(client, { userId, type, relatedId, label, refundType = 'refund' }) {
  const { rows } = await client.query(
    `SELECT id FROM coin_ledger
     WHERE user_id = $1 AND type = $2 AND related_id = $3
       AND direction = 'debit' AND refunded_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId, type, relatedId]
  );
  if (!rows.length) return null;   // nothing to reverse — already refunded, or never charged
  return refundLedgerEntry(client, { ledgerId: rows[0].id, label, type: refundType });
}

module.exports = {
  GIFT_ELIGIBLE,
  giftEligible,
  getBalances,
  spendTokens,
  grantGiftedTokens,
  activeBonusOffer,
  bonusFor,
  grantBonusTokens,
  refundLedgerEntry,
  refundByRelated,
};