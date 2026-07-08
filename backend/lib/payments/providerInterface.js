// backend/lib/payments/providerInterface.js
// Documents the contract every payment provider adapter must implement.
//
// invoicingOwner: 'us' | 'provider'
//   'us'       — we remain the seller of record; our own GST/currency invoice logic applies (Razorpay, Verotel, Cashfree, etc.)
//   'provider' — the gateway is a Merchant of Record (e.g. FastSpring); they issue the real invoice,
//                we only log the net payout, no GST calculation happens on our side for these transactions
//
// createOrder({ amountInr, currency, tokens, discountPct, userId }) => Promise<{
//   orderId: string, providerKey: string, amount: number, currency: string,
// }>
//
// verifyPayment({ orderId, paymentId, signature }) => Promise<{
//   verified: boolean, amountInCurrency: number, currency: string, paymentRaw: object,
// }>
//
// describePaymentMethod(paymentRaw) => string

module.exports = {};