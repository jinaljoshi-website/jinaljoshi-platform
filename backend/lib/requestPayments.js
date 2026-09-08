// backend/lib/requestPayments.js
//
// Paying for a commission in parts.
//
// ── Why in parts ────────────────────────────────────────────────────
//
// The whole price was taken the moment a request was made, so anything
// expensive had to be affordable in one go or not asked for at all.
//
// It is also the shape that gets a merchant account looked at. A single very
// large payment from one member is what put this platform under a risk audit,
// and spreading the same amount across a fortnight is both kinder to the member
// and quieter on the account.
//
// ── The rules ───────────────────────────────────────────────────────
//
// A tenth to place it. Anything after that, in any amount, until it is settled.
// Nothing is made until it is paid in full — the deposit reserves her time, not
// the work.
//
// And a ceiling: no single payment worth more than a lakh, and no more than a
// lakh towards commissions in any twenty-four hours. Both are in rupees rather
// than tokens, because the reason for them is the rupee figure that appears on
// a bank statement.

const { getConfigNumber } = require('./config');

// A tenth, and never less than that.
const DEPOSIT_FRACTION = 0.10;

// Written in rupees because that is the number anybody reviewing an account
// sees. Configurable, because a cap that cannot be moved is a cap that gets
// worked around.
async function limits() {
  const [perPayment, perDay, tokenRate] = await Promise.all([
    getConfigNumber('request_max_single_inr').catch(() => 100000),
    getConfigNumber('request_max_daily_inr').catch(() => 100000),
    getConfigNumber('token_rate_inr').catch(() => 66),
  ]);
  return {
    perPaymentInr: perPayment || 100000,
    perDayInr:     perDay || 100000,
    tokenRate:     tokenRate || 66,
  };
}

// What is still owed on a request.
function outstanding(request) {
  const agreed = Number(request.agreed_price_coins ?? request.offered_price_coins ?? 0);
  const paid   = Number(request.coins_charged ?? 0);
  return Math.max(0, agreed - paid);
}

// The smallest first payment that will place a request.
//
// Rounded up, so a request priced at 25 tokens asks for 3 rather than 2.5 and
// nobody has to think about halves of a token.
function depositFor(agreedCoins) {
  return Math.max(1, Math.ceil(Number(agreedCoins) * DEPOSIT_FRACTION));
}

// Whether a payment of this size may go through now.
//
// Returns a reason rather than a boolean, because "no" without "why" leaves
// somebody trying the same thing again in an hour.
async function checkPayment(db, userId, coins, { requestId = null } = {}) {
  const { perPaymentInr, perDayInr, tokenRate } = await limits();
  const valueInr = Math.round(Number(coins) * tokenRate);

  if (valueInr > perPaymentInr) {
    const maxCoins = Math.floor(perPaymentInr / tokenRate);
    return {
      ok: false,
      code: 'OVER_SINGLE_LIMIT',
      message: `A single payment towards a request cannot be more than ₹${perPaymentInr.toLocaleString('en-IN')}. That is about ${maxCoins} tokens. Pay this much now and the rest whenever suits.`,
      maxCoins,
    };
  }

  // What has already gone towards commissions since this time yesterday.
  //
  // A rolling window rather than a calendar day, so paying at eleven at night
  // and again at one in the morning is not two fresh allowances.
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(inr_value), 0) AS spent
       FROM request_payments
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  const spentToday = Number(rows[0].spent);

  if (spentToday + valueInr > perDayInr) {
    const leftInr = Math.max(0, perDayInr - spentToday);
    const leftCoins = Math.floor(leftInr / tokenRate);
    return {
      ok: false,
      code: 'OVER_DAILY_LIMIT',
      message: leftCoins > 0
        ? `You can put ₹${leftInr.toLocaleString('en-IN')} more towards requests today, about ${leftCoins} tokens. The rest can go in tomorrow.`
        : `You have reached the daily limit of ₹${perDayInr.toLocaleString('en-IN')} towards requests. Anything further can go in tomorrow.`,
      maxCoins: leftCoins,
      spentTodayInr: spentToday,
    };
  }

  return { ok: true, valueInr, tokenRate };
}

// Record a payment against a request, and say whether that settles it.
//
// The tokens are taken by the caller, inside its own transaction — this only
// writes what happened and works out where it leaves the balance.
async function recordPayment(db, { requestId, userId, coins, valueInr }) {
  await db.query(
    `INSERT INTO request_payments (request_id, user_id, coins, inr_value)
     VALUES ($1, $2, $3, $4)`,
    [requestId, userId, coins, valueInr]
  );

  const { rows } = await db.query(
    `UPDATE custom_requests
        SET coins_charged = COALESCE(coins_charged, 0) + $2
      WHERE id = $1
      RETURNING agreed_price_coins, offered_price_coins, coins_charged`,
    [requestId, coins]
  );
  const r = rows[0];
  const owed = outstanding(r);

  if (owed === 0) {
    await db.query(
      `UPDATE custom_requests SET paid_in_full_at = COALESCE(paid_in_full_at, NOW())
        WHERE id = $1`,
      [requestId]
    );
  }

  return { outstanding: owed, settled: owed === 0, paid: Number(r.coins_charged) };
}

module.exports = { DEPOSIT_FRACTION, limits, outstanding, depositFor, checkPayment, recordPayment };