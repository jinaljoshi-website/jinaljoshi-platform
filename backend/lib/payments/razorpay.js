// backend/lib/payments/razorpay.js
// Razorpay adapter — domestic, we remain seller of record (invoicingOwner: 'us')

const crypto = require('crypto');

const invoicingOwner = 'us';

function getClient() {
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

async function createOrder({ amountInr, tokens, discountPct, userId, clientIp, userCountry,
                             currency = 'INR', amountInCurrency }) {
  const razorpay = getClient();
  // Charged in the fan's own currency where they have chosen one. The INR value
  // is carried in the notes so the invoice records what the sale was worth here
  // regardless of what was billed.
  const charge = amountInCurrency ?? amountInr;
  const order = await razorpay.orders.create({
    amount:   Math.round(charge * 100),
    currency,
    // Razorpay echoes notes back in the webhook payload, which is the only way
    // the fan's IP and country survive to a server-to-server credit. Country
    // decides whether a supply is zero-rated, so losing it is not cosmetic.
    notes: {
      user_id:      userId,
      tokens:       String(tokens),
      discount:     String(discountPct),
      client_ip:    clientIp || '',
      user_country: userCountry || '',
      amount_inr:   String(amountInr),
    },
  });

  return {
    orderId:     order.id,
    providerKey: process.env.RAZORPAY_KEY_ID,
    amount:      amountInr * 100,
    currency:    'INR',
  };
}

async function verifyPayment({ orderId, paymentId, signature }) {
  const body     = orderId + '|' + paymentId;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature || '');
  const matches = expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
  if (!matches) return { verified: false };

  const razorpay   = getClient();
  const paymentRaw = await razorpay.payments.fetch(paymentId);

  // The signature proves this order and payment are genuine. It says nothing
  // about how many tokens were bought — that lives in the notes we ourselves
  // attached when the order was created, and it is the only trustworthy source.
  // Taking the quantity from the browser instead let a fan pay for one token and
  // claim ten thousand, with the invoice then recording money that never arrived.
  const orderRaw = await razorpay.orders.fetch(orderId);

  // A payment against a different order than the one signed would be a mismatch
  // we must not paper over.
  if (paymentRaw.order_id && paymentRaw.order_id !== orderId) {
    return { verified: false };
  }

  return {
    verified: true,
    amountInCurrency: Math.round(paymentRaw.amount / 100),
    currency: paymentRaw.currency || 'INR',
    // What the order says was bought, and what it was worth in rupees at the
    // moment it was created.
    orderTokens:   parseInt(orderRaw?.notes?.tokens, 10) || null,
    orderAmountInr: parseFloat(orderRaw?.notes?.amount_inr) || null,
    orderNotes:    orderRaw?.notes || {},
    paymentRaw,
    orderRaw,
  };
}

function describePaymentMethod(paymentRaw) {
  if (!paymentRaw) return 'Not provided';
  if (paymentRaw.method === 'card' && paymentRaw.card) {
    return `${paymentRaw.card.network || 'Card'} ****${paymentRaw.card.last4 || '----'}`;
  }
  if (paymentRaw.method === 'upi') return paymentRaw.vpa ? `UPI (${paymentRaw.vpa})` : 'UPI';
  if (paymentRaw.method === 'netbanking') return paymentRaw.bank ? `Net Banking (${paymentRaw.bank})` : 'Net Banking';
  if (paymentRaw.method === 'wallet') return paymentRaw.wallet ? `Wallet (${paymentRaw.wallet})` : 'Wallet';
  return paymentRaw.method || 'Not provided';
}

function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature);
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = { invoicingOwner, createOrder, verifyPayment, describePaymentMethod, verifyWebhookSignature };