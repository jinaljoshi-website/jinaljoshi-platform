// backend/lib/pricing.js
// Centralized rounding rule for every token amount computed via a multiplier, discount,
// or proportional split: ALWAYS round up. This guarantees a fan is never undercharged
// and Jinal never receives a fractional token, no matter where the calculation happens.
function roundTokensUp(rawAmount) {
  return Math.ceil(rawAmount);
}

module.exports = { roundTokensUp };