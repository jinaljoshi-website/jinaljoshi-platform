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

async function createOrder({ amountInr, tokens, discountPct, userId }) {
  const razorpay = getClient();
  const order = await razorpay.orders.create({
    amount:   amountInr * 100,
    currency: 'INR',
    notes: {
      user_id:  userId,
      tokens:   String(tokens),
      discount: String(discountPct),
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

  if (expected !== signature) return { verified: false };

  const razorpay   = getClient();
  const paymentRaw = await razorpay.payments.fetch(paymentId);

  return {
    verified: true,
    amountInCurrency: Math.round(paymentRaw.amount / 100),
    currency: paymentRaw.currency || 'INR',
    paymentRaw,
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
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

module.exports = { invoicingOwner, createOrder, verifyPayment, describePaymentMethod, verifyWebhookSignature };