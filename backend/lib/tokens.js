// backend/lib/tokens.js
// Single place where token spending, gifting and refunding are decided.
//
// Two pots:
//   purchased — users.coin_balance, bought with real money, never expires
//   gifted    — gifted_grants rows, granted by Jinal or on signup, expires
//
// Gifted tokens are spent first, oldest-expiring grant first, and only on things
// that create no outside cost: direct messages and gallery unlocks. Anything with
// a real-world obligation — merchandise, outfits, calls, custom requests,
// membership — must be paid for with purchased tokens.
const { getConfigNumber } = require('./config');

const GIFT_ELIGIBLE = new Set(['dm_charge', 'content_unlock', 'chat_media_unlock']);

function giftEligible(type) {
  return GIFT_ELIGIBLE.has(type);
}

// Live gifted balance is always derived, never cached, so it cannot drift and
// expiry needs no scheduled job to stay correct.
async function getBalances(db, userId) {
  const { rows: u } = await db.query(`SELECT coin_balance FROM users WHERE id = $1`, [userId]);
  const { rows: g } = await db.query(
    `SELECT COALESCE(SUM(remaining), 0)::int AS gifted,
            MIN(expires_at) FILTER (WHERE remaining > 0) AS next_expiry
     FROM gifted_grants
     WHERE user_id = $1 AND remaining > 0 AND expires_at > NOW()`,
    [userId]
  );
  const purchased = u[0]?.coin_balance || 0;
  const gifted    = g[0]?.gifted || 0;
  const nextExpiry = g[0]?.next_expiry || null;
  return {
    purchased,
    gifted,
    total: purchased + gifted,
    giftedExpiresAt: nextExpiry,
    giftedExpiresInDays: nextExpiry
      ? Math.max(0, Math.ceil((new Date(nextExpiry) - Date.now()) / 86400000))
      : null,
  };
}

function insufficientError({ required, purchased, gifted, allowGifted }) {
  const usable  = allowGifted ? purchased + gifted : purchased;
  const err     = new Error('INSUFFICIENT_TOKENS');
  err.code      = 'INSUFFICIENT_TOKENS';
  err.httpBody  = {
    error:    'INSUFFICIENT_TOKENS',
    message:  allowGifted
      ? `This costs ${required} tokens. You have ${usable}.`
      : `This costs ${required} purchased tokens. You have ${purchased}.${gifted > 0 ? ` Your ${gifted} gifted tokens can only be used for messages and content.` : ''}`,
    required,
    available:          usable,
    shortBy:            required - usable,
    purchasedAvailable: purchased,
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
    `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`, [userId]
  );
  const purchased = uRows[0]?.coin_balance || 0;

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

  const fromGifted    = eligible ? Math.min(amount, giftedAvailable) : 0;
  const fromPurchased = amount - fromGifted;

  if (purchased < fromPurchased) {
    throw insufficientError({ required: amount, purchased, gifted: giftedAvailable, allowGifted: eligible });
  }

  let need = fromGifted;
  for (const g of grants) {
    if (need <= 0) break;
    const take = Math.min(need, g.remaining);
    await client.query(`UPDATE gifted_grants SET remaining = remaining - $1 WHERE id = $2`, [take, g.id]);
    need -= take;
  }

  if (fromPurchased > 0) {
    await client.query(
      `UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2`,
      [fromPurchased, userId]
    );
  }

  const { rows: lRows } = await client.query(
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id, from_gifted, from_purchased)
     VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7) RETURNING id`,
    [userId, type, amount, label, relatedId, fromGifted, fromPurchased]
  );

  return {
    ledgerId:      lRows[0].id,
    fromGifted,
    fromPurchased,
    newPurchased:  purchased - fromPurchased,
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
  const fromPurchased = original.from_purchased || (fromGifted ? 0 : original.amount);

  if (fromPurchased > 0) {
    await client.query(
      `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
      [fromPurchased, original.user_id]
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
    `INSERT INTO coin_ledger (user_id, type, direction, amount, label, related_id, from_gifted, from_purchased)
     VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)`,
    [original.user_id, type, original.amount, label || `Refund: ${original.label || original.type}`,
     original.related_id, fromGifted, fromPurchased]
  );

  await client.query(`UPDATE coin_ledger SET refunded_at = NOW() WHERE id = $1`, [ledgerId]);

  return { fromGifted, fromPurchased, userId: original.user_id, amount: original.amount };
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
  refundLedgerEntry,
  refundByRelated,
};