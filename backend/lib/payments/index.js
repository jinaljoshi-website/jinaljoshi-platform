// backend/lib/payments/index.js
// Dispatcher — the only file the rest of the app should import from for payments.
// Add new adapters here as gateways get approved, e.g.:
//   providers.fastspring = require('./fastspring')   // invoicingOwner: 'provider'
//   providers.verotel    = require('./verotel')      // invoicingOwner: 'us'

const razorpay = require('./razorpay');

const providers = {
  razorpay,
};

// Today Razorpay is the only live option. Once more exist, this is the one place
// that changes — e.g. route by currency, by detected country, or explicit user choice.
function selectProvider({ currency } = {}) {
  return providers.razorpay;
}

async function createOrder(params) {
  return selectProvider(params).createOrder(params);
}

async function verifyPayment(params) {
  return selectProvider(params).verifyPayment(params);
}

function describePaymentMethod(providerKeyUsed, paymentRaw) {
  const provider = providers[providerKeyUsed] || providers.razorpay;
  return provider.describePaymentMethod(paymentRaw);
}

function invoicingOwnerFor(providerKeyUsed) {
  const provider = providers[providerKeyUsed] || providers.razorpay;
  return provider.invoicingOwner;
}

module.exports = { providers, selectProvider, createOrder, verifyPayment, describePaymentMethod, invoicingOwnerFor };