// backend/routes/coins.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { postSystemMessage } = require('./community');
const { getClientIp, lookupIpCountry } = require('../lib/geoip');
const { issueInvoiceForPurchase, generateInvoicePdfBuffer } = require('../lib/invoice');
const payments = require('../lib/payments');
const { getConfigNumber, getConfigValue } = require('../lib/config');
const { getBalances, activeBonusOffer, bonusFor, grantBonusTokens } = require('../lib/tokens');
const { accrueCollectionsAccess } = require('../lib/collections');
const fx = require('../lib/fx');


async function getDiscountConfig() {
  const [tier1Threshold, tier1Pct, tier2Threshold, tier2Pct] = await Promise.all([
    getConfigNumber('recharge_discount_tier1_threshold'),
    getConfigNumber('recharge_discount_tier1_pct'),
    getConfigNumber('recharge_discount_tier2_threshold'),
    getConfigNumber('recharge_discount_tier2_pct'),
  ]);
  return {
    tier1Threshold: tier1Threshold || 500,
    tier1Pct:       tier1Pct ?? 5,
    tier2Threshold: tier2Threshold || 1000,
    tier2Pct:       tier2Pct ?? 10,
  };
}

async function calcDiscount(tokens) {
  const cfg = await getDiscountConfig();
  if (tokens >= cfg.tier2Threshold) return cfg.tier2Pct;
  if (tokens >= cfg.tier1Threshold) return cfg.tier1Pct;
  return 0;
}

// The offer an order was created under, looked up by the id stored in its notes.
//
// Deliberately not re-resolved through activeBonusOffer: an offer can end, or
// reach its usage limit, between somebody seeing a price and paying it. Honour
// what was quoted — the alternative is taking money on one promise and
// delivering another, over a difference of minutes.
async function offerFromOrder(db, notes) {
  const id = notes?.bonus_offer_id;
  if (!id) return null;
  try {
    const { rows } = await db.query(`SELECT * FROM bonus_offers WHERE id = $1`, [id]);
    return rows[0] || null;
  } catch (err) {
    console.error('coins/offerFromOrder error:', err.message);
    return null;
  }
}

async function calcPrice(tokens) {
  const pct  = await calcDiscount(tokens);
  const rate = await getConfigNumber('token_rate_inr');
  const base = tokens * rate;
  return Math.round(base * (1 - pct / 100));
}

// ─────────────────────────────────────────────
// GET /api/coins/balance
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// GET /api/coins/invoices  ·  GET /api/coins/invoices/:id/pdf
// ─────────────────────────────────────────────
//
// A member's own tax invoices, which they could not reach at all.
//
// One was raised for every purchase and stored, and there was no endpoint and
// no link — so a document issued in somebody's name existed only where they
// could not see it. A function to email them was written and never called, and
// nothing filled the gap.
//
// A ledger of purchases is not the same as a tax invoice. Anybody claiming this
// against business expenses, or asked by a bank to show what they paid for,
// needs the document itself.
router.get('/invoices', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.invoice_number, i.created_at, i.amount_inr_equivalent,
              i.tokens_purchased, i.currency, i.is_export
         FROM invoices i
        WHERE i.user_id = $1
        ORDER BY i.created_at DESC`,
      [req.user.userId]
    );
    res.json({
      invoices: rows.map((r) => ({
        id: r.id,
        number: r.invoice_number,
        at: r.created_at,
        amountInr: r.amount_inr_equivalent,
        tokens: r.tokens_purchased,
        currency: r.currency || 'INR',
      })),
    });
  } catch (err) {
    console.error('coins/invoices error:', err);
    res.status(500).json({ error: 'Could not load your invoices' });
  }
});

router.get('/invoices/:id/pdf', authMid, async (req, res) => {
  try {
    // Scoped to the person asking. An invoice carries a name, an email and an
    // amount, and the id is the only thing standing between one member's and
    // another's.
    const { rows } = await pool.query(
      `SELECT * FROM invoices WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });

    const pdf = await generateInvoicePdfBuffer(rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${String(rows[0].invoice_number).replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('coins/invoice pdf error:', err);
    res.status(500).json({ error: 'Could not produce the invoice' });
  }
});

router.get('/balance', authMid, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      `SELECT coin_balance FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const { rows: ledger } = await pool.query(
      `SELECT id, type, direction, amount, label, created_at
       FROM coin_ledger WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [req.user.userId]
    );
    const discountConfig = await getDiscountConfig();
    const bal = await getBalances(pool, req.user.userId);

    res.json({
      balance: userRows[0]?.coin_balance || 0,
      bonusBalance: bal.bonus,
      giftedBalance: bal.gifted,
      giftedExpiresInDays: bal.giftedExpiresInDays,
      spendableBalance: bal.total,
      ledger,
      discountConfig,
    });
  } catch (err) {
    console.error('coins/balance error:', err);
    res.status(500).json({ error: 'Failed to load balance' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/initiate
// Creates an order through whichever payment provider the dispatcher selects
// Body: { tokens }
// ─────────────────────────────────────────────

// What currency this fan can pay in, and whether we should be asking.
router.get('/currencies', authMid, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT preferred_currency FROM users WHERE id = $1`, [req.user.userId]
    );
    const { country } = await lookupIpCountry(getClientIp(req));

    // Recorded whenever we see it. Everyone who joined before this existed has
    // no country against them, so this is what eventually places them — and it
    // gives Jinal a real picture of where her audience is.
    if (country && country !== 'Unknown') {
      pool.query(`UPDATE users SET detected_country = $1 WHERE id = $2`,
                 [country, req.user.userId]).catch(() => {});
    }
    let resolved = await fx.resolveForUser({
      preferredCurrency: rows[0]?.preferred_currency, country,
    });

    // Somebody abroad who has never chosen gets their own currency, rather than
    // a picker they have to find first. Nothing about it is hidden: the picker
    // says what was chosen for them and that it can be changed, and the choice
    // is written down so it survives the next visit.
    //
    // Only where none exists. A stored preference is an answer, and an answer
    // is never overridden by a guess from an IP address -- including a
    // deliberate choice of INR while abroad.
    let autoSelected = null;
    if (!rows[0]?.preferred_currency && fx.isForeignCountry(country)) {
      const local = fx.localCurrencyFor(country);
      if (local && await fx.getRate(local)) {
        await pool.query(`UPDATE users SET preferred_currency = $1 WHERE id = $2`,
                         [local, req.user.userId]);
        autoSelected = local;
        resolved = await fx.resolveForUser({ preferredCurrency: local, country });
      }
    }

    // Nothing is offered while the feature is off — showing a currency picker
    // that cannot be honoured is worse than not showing one.
    const abroad = fx.isForeignCountry(country)
      && (await getConfigValue('international_payments_live')) === 'true';
    res.json({
      current: resolved.currency,
      isForeign: resolved.isForeign,
      // Asked once, when we first see them from abroad and they have not
      // answered. A guess from an IP address should never override a choice.
      shouldAsk: resolved.shouldAsk,
      // Set for them just now, so the interface can say so once rather than
      // changing every price without explanation.
      autoSelected,
      detectedCountry: abroad ? country : null,
      // Their own currency, USD, and INR. Three choices rather than a list.
      options: abroad ? await fx.optionsForCountry(country) : [],
      bufferPct: await getConfigNumber('fx_buffer_pct'),
    });
  } catch (err) {
    console.error('coins/currencies error:', err);
    res.status(500).json({ error: 'Could not load currencies' });
  }
});

router.post('/currency', authMid, async (req, res) => {
  const { currency } = req.body;
  try {
    // INR is always available; anything else must be priceable right now.
    if (currency && currency !== fx.HOME) {
      const rate = await fx.getRate(currency);
      if (!rate) return res.status(400).json({ error: 'That currency is not available at the moment' });
    }
    await pool.query(`UPDATE users SET preferred_currency = $1 WHERE id = $2`,
                     [currency || fx.HOME, req.user.userId]);
    res.json({ ok: true, currency: currency || fx.HOME });
  } catch (err) {
    console.error('coins/currency error:', err);
    res.status(500).json({ error: 'Could not save your choice' });
  }
});

router.post('/recharge/initiate', authMid, async (req, res) => {
  const { tokens } = req.body;
  const amount     = parseInt(tokens);

  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Token amount is required' });
  }
  if (amount > 10000) {
    return res.status(400).json({ error: 'Maximum 10,000 tokens per transaction' });
  }

  const priceINR    = await calcPrice(amount);
  const discountPct = await calcDiscount(amount);

  // Captured here, at the only moment the fan's own request reaches us. The
  // webhook is a server-to-server call from Razorpay with no fan IP attached, so
  // without carrying these through the order they would be lost on any payment
  // credited that way — and country is what decides zero-rating for exports.
  const clientIp = getClientIp(req);
  const { country: ipCountry } = await lookupIpCountry(clientIp);

  // Off until Razorpay have enabled international payments on the account.
  // Sending a USD order before then is rejected at their end, which would fail
  // the purchase rather than quietly falling back — so the whole path stays
  // dormant behind a switch.
  const fxLive = (await getConfigValue('international_payments_live')) === 'true';

  // The fan's stated currency, not a guess from their address. Charging in
  // foreign exchange is what makes an international sale an export — the price
  // is the same value either way, but paid in rupees it stays taxable, and the
  // FIRC Razorpay issues is what evidences the foreign remittance.
  const { rows: prefRows } = await pool.query(
    `SELECT preferred_currency FROM users WHERE id = $1`, [req.user.userId]
  );
  const resolved = await fx.resolveForUser({
    preferredCurrency: prefRows[0]?.preferred_currency, country: ipCountry,
  });

  let fxQuote = null;
  if (fxLive && resolved.isForeign) {
    try {
      fxQuote = await fx.quote(priceINR, resolved.currency);
    } catch (err) {
      // No usable rate means charging in INR rather than refusing the sale.
      // The fan pays the same value; only the tax treatment differs.
      console.error('fx quote failed, falling back to INR:', err.message);
    }
  }

  try {
    // Resolved before the order is created, not after, so the offer that is
    // quoted on the button is the offer recorded against the payment. It used
    // to be worked out afterwards and then thrown away, which left the coupon
    // knowable only to the browser — and the webhook, which normally credits
    // first, had no way to learn it.
    const offer = await activeBonusOffer(pool, req.body.bonusCode);
    const bonus = bonusFor(amount, offer);

    const order = await payments.createOrder({
      amountInr:   priceINR,
      tokens:      amount,
      discountPct,
      userId:      req.user.userId,
      clientIp,
      userCountry: ipCountry,
      currency:         fxQuote ? fxQuote.currency : 'INR',
      amountInCurrency: fxQuote ? fxQuote.amount   : priceINR,
      bonusOfferId: offer?.id || null,
      bonusTokens:  bonus,
    });

    res.json({
      orderId:     order.orderId,
      bonusTokens: bonus,
      bonusPct:    offer ? parseFloat(offer.bonus_pct) : 0,
      bonusLabel:  offer?.label || null,
      totalTokens: amount + bonus,
      amount:      fxQuote ? fxQuote.amount : priceINR,
      amountInr:   priceINR,
      currency:    fxQuote ? fxQuote.currency : 'INR',
      display:     fxQuote ? fxQuote.display  : null,
      isExport:    !!fxQuote,
      tokens:      amount,
      discountPct,
      razorpayKey: order.providerKey, // field name kept for frontend compatibility; represents whichever provider is active
    });
  } catch (err) {
    console.error('coins/recharge/initiate error:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/verify
// Verifies payment through the dispatcher, credits tokens, and issues a tax invoice
// (only when the active provider is one where we remain the seller of record)
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, tokens }
// ─────────────────────────────────────────────

router.post('/recharge/verify', authMid, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, tokens } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !tokens) {
    return res.status(400).json({ error: 'Payment verification data is incomplete' });
  }

  const claimedAmount = parseInt(tokens);
  if (!claimedAmount || claimedAmount < 1) return res.status(400).json({ error: 'Invalid token amount' });

  try {
    const result = await payments.verifyPayment({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!result.verified) {
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // The signature proves the payment is real; it does not prove what was
    // bought. The quantity comes from the order's own notes, written by this
    // server when the order was created — never from the browser, which is free
    // to claim any number it likes. The webhook has always done it this way;
    // this path was the one that did not, and it was creditable to anybody
    // willing to send a larger number alongside a genuine signature.
    const amount = result.orderTokens;
    if (!amount || amount < 1) {
      console.error(`recharge/verify: order ${razorpay_order_id} carries no token count in notes`);
      return res.status(400).json({ error: 'Could not confirm what this payment was for. Nothing has been charged twice — please contact support.' });
    }
    if (amount !== claimedAmount) {
      // Not fatal — the order is the truth and we proceed on it — but a
      // disagreement is either a stale tab or somebody probing, and both are
      // worth seeing in the logs.
      console.warn(`recharge/verify: browser claimed ${claimedAmount} tokens, order ${razorpay_order_id} says ${amount}. Using the order.`);
    }

    // The webhook reliably arrives before this client-side call in practice (it's a direct
    // server-to-server request, with no browser round-trip to wait on). That's expected,
    // not an error — if the payment's already credited, confirm success using the existing
    // result instead of treating the fan's own successful payment as a failure.
    const { rows: existing } = await pool.query(
      `SELECT amount FROM coin_ledger WHERE payment_id = $1`,
      [razorpay_payment_id]
    );
    if (existing.length) {
      const { rows: userRows } = await pool.query(`SELECT coin_balance FROM users WHERE id = $1`, [req.user.userId]);
      return res.json({
        ok: true,
        tokens: existing[0].amount,
        newBalance: userRows[0].coin_balance,
        message: `${existing[0].amount} tokens added to your balance!`,
      });
    }

    const priceINR    = await calcPrice(amount);
    const discountPct = await calcDiscount(amount);
    const paymentMethodDisplay = payments.describePaymentMethod('razorpay', result.paymentRaw);
    const invoicingOwner = payments.invoicingOwnerFor('razorpay');

    const clientIp = getClientIp(req);
    const { country: userCountry } = await lookupIpCountry(clientIp);

    const { rows: userRows0 } = await pool.query(`SELECT email FROM users WHERE id = $1`, [req.user.userId]);
    const userEmail = userRows0[0]?.email;

    const client = await pool.connect();
    let coinLedgerId, newBalance;
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`,
        [amount, req.user.userId]
      );

      const { rows: ledgerRows } = await client.query(
        `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
         VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)
         RETURNING id`,
        [req.user.userId, amount, `Recharge ${amount} tokens${discountPct > 0 ? ` (${discountPct}% off)` : ''}`, razorpay_payment_id, priceINR]
      );
      coinLedgerId = ledgerRows[0].id;

      // Granted as its own credit rather than added to the purchase, so the
      // ledger says plainly what was bought and what was given. Every revenue
      // figure reads from_purchased, so a bonus can never be counted as money.
      // Taken from the order, exactly as the token count is. Re-resolving from
      // the browser's coupon code here would let the two crediting paths
      // disagree, and would trust a value the fan can change after the price
      // was fixed.
      const offer = await offerFromOrder(client, result.orderNotes);
      const bonus = parseInt(result.orderNotes?.bonus_tokens, 10) || 0;
      if (bonus > 0) {
        await grantBonusTokens(client, { userId: req.user.userId, amount: bonus, offer });
      }

      // Money in can earn a span in the private collection. Inside the same
      // transaction as the credit, so a payment and what it earned cannot come
      // apart — and idempotent by counter, so the webhook arriving after this
      // does not grant the same span twice.
      await accrueCollectionsAccess(client, req.user.userId).catch((e) => {
        console.error('collections accrual (verify):', e.message);
      });

      const { rows: userRows } = await client.query(`SELECT coin_balance FROM users WHERE id = $1`, [req.user.userId]);
      newBalance = userRows[0].coin_balance;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    postSystemMessage('🪙 Someone just recharged their J Tokens!');

    // Only run our own GST invoice logic if we're the seller of record for this provider.
    // A future Merchant-of-Record gateway (e.g. FastSpring) would skip this entirely —
    // their own invoice is the real one, we'd just log the net payout instead.
    let invoiceNumber = null;
    if (invoicingOwner === 'us') {
      const invoice = await issueInvoiceForPurchase({
        userId: req.user.userId,
        userEmail,
        userCountry,
        ipAddress: clientIp,
        coinLedgerId,
        tokensPurchased: amount,
        amountInrEquivalent: priceINR,
        currency: result.currency,
        amountInCurrency: result.amountInCurrency,
        exchangeRateUsed: null,
        paymentMethodDisplay,
      });
      invoiceNumber = invoice?.invoice_number || null;
    }

    res.json({
      ok:         true,
      tokens:     amount,
      priceINR,
      discountPct,
      newBalance,
      invoiceNumber,
      message:    `${amount} tokens added to your balance!`,
    });
  } catch (err) {
    console.error('coins/recharge/verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// ─────────────────────────────────────────────
// POST /api/coins/recharge/webhook
// Razorpay webhook (backup in case verify is missed)
// ─────────────────────────────────────────────

router.post('/recharge/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const { verifyWebhookSignature } = payments.providers.razorpay;

  if (!verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature)) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event   = req.body;
  const payment = event?.payload?.payment?.entity;
  console.log(`Razorpay webhook OK: ${event?.event} · payment ${payment?.id}`);

  if (event.event !== 'payment.captured' || !payment) {
    return res.json({ ok: true });
  }

  const userId    = payment.notes?.user_id;
  const tokens    = parseInt(payment.notes?.tokens);
  const paymentId = payment.id;

  if (!userId || !tokens) return res.json({ ok: true });

  try {
    const { rows: existing } = await pool.query(`SELECT id FROM coin_ledger WHERE payment_id = $1`, [paymentId]);
    if (existing.length) return res.json({ ok: true });

    // What was actually charged, in whatever currency it was charged in.
    const paidCurrency  = payment.currency || 'INR';
    const amountCharged = Math.round(payment.amount / 100);

    // The rupee value of the sale. For a foreign payment the charged amount is
    // dollars or euros, so treating it as rupees recorded 25 USD as ₹25 — wrong
    // revenue, and a wrong invoice. The true INR value was written into the
    // order notes when the order was created; that is what belongs here.
    const priceINR = paidCurrency === 'INR'
      ? amountCharged
      : (parseFloat(payment.notes?.amount_inr) || null);

    if (!priceINR) {
      // Without the rupee value we cannot raise a correct tax invoice, and a
      // wrong one is worse than a late one. Credit nothing and let the retry
      // (or the fan's own verify call) handle it, rather than book a bad figure.
      console.error(`webhook: payment ${paymentId} in ${paidCurrency} has no amount_inr in order notes — not credited`);
      return res.status(400).json({ error: 'Missing INR value for a foreign payment' });
    }

    await pool.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2`, [tokens, userId]);
    const { rows: ledgerRows } = await pool.query(
      `INSERT INTO coin_ledger (user_id, type, direction, amount, label, payment_id, payment_amount_inr)
       VALUES ($1, 'recharge', 'credit', $2, $3, $4, $5)
       RETURNING id`,
      [userId, tokens, `Recharge via webhook — ${tokens} tokens`, paymentId, priceINR]
    );

    // The webhook is the backstop for a payment whose confirmation never
    // reached us. Somebody in that position must still get their bonus, or a
    // dropped connection quietly costs them the offer.
    try {
      // From the order's own notes. This once called activeBonusOffer with no
      // code at all, so a fan who entered a coupon and was quoted a bonus got
      // whatever sitewide offer happened to be running instead — or nothing.
      // Since the webhook usually wins the race against the browser's own
      // confirmation, a coupon could go its whole life never being honoured.
      const offer = await offerFromOrder(pool, payment.notes);
      const bonus = parseInt(payment.notes?.bonus_tokens, 10) || 0;
      if (bonus > 0) {
        // In a transaction of its own.
        //
        // grantBonusTokens raises the balance and then writes the ledger row.
        // Run on the pool directly, a failure at the second step left the first
        // one standing — sixty-five tokens really in an account with nothing at
        // all recording them, and the offer's own counter never moving because
        // it comes after the insert. The balance and the ledger then disagreed
        // permanently and nothing would ever have reconciled them.
        //
        // All three succeed together or none of them do.
        const bonusClient = await pool.connect();
        try {
          await bonusClient.query('BEGIN');
          await grantBonusTokens(bonusClient, { userId, amount: bonus, offer });
          await bonusClient.query('COMMIT');
        } catch (e) {
          await bonusClient.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          bonusClient.release();
        }
      }
    } catch (e) { console.error('bonus grant via webhook failed:', e.message); }

    // Separately caught. Neither the bonus nor this may take down a credit that
    // has already happened — the money is in and the tokens are given, and an
    // access span is not worth failing that over.
    try {
      await accrueCollectionsAccess(pool, userId);
    } catch (e) { console.error('collections accrual (webhook):', e.message); }

    postSystemMessage('🪙 Someone just recharged their J Tokens!');

    try {
      const { rows: userRows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      const paymentMethodDisplay = payments.describePaymentMethod('razorpay', payment);
      await issueInvoiceForPurchase({
        userId,
        userEmail: userRows[0]?.email,
        // Recovered from the order notes. Previously null here, which meant every
        // webhook-credited payment lost the country that decides export status.
        userCountry: payment.notes?.user_country || null,
        ipAddress:   payment.notes?.client_ip || null,
        coinLedgerId: ledgerRows[0].id,
        tokensPurchased: tokens,
        amountInrEquivalent: priceINR,
        // The currency actually received, not an assumption of rupees. Zero
        // rating requires payment in convertible foreign exchange, so hardcoding
        // INR here made determineIsExport false for every webhook-credited
        // payment — and charged 18% GST on sales that were zero-rated exports.
        currency:         paidCurrency,
        amountInCurrency: amountCharged,
        exchangeRateUsed: paidCurrency === 'INR' ? null : priceINR / amountCharged,
        paymentMethodDisplay,
      });
    } catch (err) {
      console.error('webhook invoice error:', err.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// What is on offer right now, so the interface can say so before somebody
// reaches the checkout rather than surprising them at it.
router.get('/bonus-offer', authMid, async (req, res) => {
  try {
    let offer = await activeBonusOffer(pool, req.query.code);

    // Nothing sitewide? Then look for a coded offer and hand the code over.
    //
    // A code that has to be known to be used only rewards whoever happened to
    // read the announcement. The offer is running either way, and somebody
    // paying full price because they never saw a post is not a saving — it is
    // a member who will find out later. Offered plainly, applying it is one
    // tap; not applying it is then their own choice rather than an accident.
    if (!offer && !req.query.code) {
      const { rows } = await pool.query(
        `SELECT * FROM bonus_offers
          WHERE active = TRUE AND code IS NOT NULL
            -- Only the ones meant to be seen.
            --
            -- This handed out every active code to everybody, so a coupon made
            -- for one person — an apology, an email, a single member — was
            -- platform-wide the moment it existed. A quiet one still works when
            -- typed; it is simply not advertised.
            AND announced = TRUE
            AND starts_at <= NOW() AND ends_at >= NOW()
            AND (max_uses IS NULL OR uses < max_uses)
          ORDER BY bonus_pct DESC LIMIT 1`
      );
      offer = rows[0] || null;
    }

    if (!offer) return res.json({ offer: null });
    res.json({
      offer: {
        bonusPct:  parseFloat(offer.bonus_pct),
        label:     offer.label,
        endsAt:    offer.ends_at,
        minTokens: offer.min_tokens || 0,
        hasCode:   !!offer.code,
        // The code itself, so an announced one can be offered rather than
        // guessed at. A quiet one is echoed back only because the person
        // already typed it — it is never volunteered.
        code:      offer.announced === false ? (req.query.code || null) : (offer.code || null),
      },
    });
  } catch (err) {
    console.error('coins/bonus-offer error:', err);
    res.json({ offer: null });
  }
});

module.exports = router;