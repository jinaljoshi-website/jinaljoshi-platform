// backend/lib/fx.js
// Fetches and caches live FX rates, with a configurable buffer applied on top.
// Rates are refreshed at most once per day and cached in platform_config to avoid
// hitting the external API on every request.

const pool = require('../db/pool');
const { getConfigNumber } = require('./config');

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'AED', 'SGD'];

const COUNTRY_TO_CURRENCY = {
  US: 'USD', GB: 'GBP', AU: 'AUD', CA: 'CAD', AE: 'AED', SG: 'SGD',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR',
  PT: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
};

function localCurrencyForCountryCode(countryCode) {
  return COUNTRY_TO_CURRENCY[countryCode] || null;
}

async function getCachedRates() {
  const { rows } = await pool.query(
    `SELECT value FROM platform_config WHERE key = 'fx_rates_cache'`
  );
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return null;
  }
}

async function refreshRatesIfStale() {
  const cached = await getCachedRates();
  const now = Date.now();

  if (cached && cached.fetchedAt && (now - cached.fetchedAt) < 24 * 60 * 60 * 1000) {
    return cached.rates; // still fresh, less than a day old
  }

  try {
    // Free tier, no API key needed, base currency USD
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    if (!data.rates) throw new Error('No rates in response');

    // We need INR-based rates (1 INR = X currency), API gives USD-based, so convert
    const usdToInr = data.rates.INR;
    const rates = { INR: 1 };
    for (const cur of SUPPORTED_CURRENCIES) {
      if (data.rates[cur]) {
        // 1 INR = (rate_cur / rate_inr) of that currency
        rates[cur] = data.rates[cur] / usdToInr;
      }
    }

    const payload = JSON.stringify({ rates, fetchedAt: now });
    await pool.query(
      `INSERT INTO platform_config (key, value) VALUES ('fx_rates_cache', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [payload]
    );

    return rates;
  } catch (err) {
    console.error('fx/refreshRatesIfStale error:', err.message);
    // Fall back to stale cache rather than failing entirely, if we have one
    return cached ? cached.rates : null;
  }
}

// Converts an INR amount to the target currency, with the configured buffer applied
async function convertInrToCurrency(inrAmount, currency) {
  if (currency === 'INR') return { amount: inrAmount, rate: 1 };

  const rates = await refreshRatesIfStale();
  if (!rates || !rates[currency]) {
    throw new Error(`Exchange rate unavailable for ${currency}`);
  }

  const bufferPct = await getConfigNumber('fx_buffer_pct');
  const baseRate = rates[currency];
  const bufferedRate = baseRate * (1 + bufferPct / 100);
  const amount = Math.round(inrAmount * bufferedRate * 100) / 100; // round to 2 decimals

  return { amount, rate: bufferedRate };
}

module.exports = {
  SUPPORTED_CURRENCIES,
  localCurrencyForCountryCode,
  refreshRatesIfStale,
  convertInrToCurrency,
};