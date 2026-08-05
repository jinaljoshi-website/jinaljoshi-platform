// backend/lib/fx.js
// Charging an international fan in their own currency.
//
// This is not a discount. The price is the same value — 10 tokens is Rs 660
// whether that is billed as Rs 660 or as its equivalent in dollars. What changes
// is the tax treatment: an export paid in convertible foreign exchange is
// zero-rated, so the whole amount is taxable value at 0% rather than
// Rs 559 taxable plus Rs 101 of GST that goes to the government.
//
// The CA's three conditions must all hold: the recipient is outside India, the
// service is availed outside India, and payment is received in foreign
// exchange. The third is why this file exists — charging in INR to a foreign
// card fails it, however international the buyer.

const pool = require('../db/pool');
const { getConfigNumber } = require('./config');

const HOME = 'INR';

// The intersection of two lists: currencies Razorpay will settle and ones the
// rate source quotes. A currency in only one of those is useless — we could
// charge it and not know what to charge, or price it and have the payment
// rejected. Anything not in both is simply not offered, and the fan pays in USD
// or INR instead.
const RAZORPAY_CURRENCIES = new Set([
  'AED','ALL','AMD','ARS','AUD','AWG','BBD','BDT','BMD','BND','BOB','BSD','BWP','BZD',
  'CAD','CHF','CNY','COP','CRC','CUP','CZK','DKK','DOP','DZD','EGP','ETB','EUR','FJD',
  'GBP','GIP','GMD','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','JMD',
  'JPY','KES','KGS','KHR','KYD','KZT','LAK','LBP','LKR','LRD','LSL','MAD','MDL','MKD',
  'MMK','MNT','MOP','MUR','MVR','MWK','MXN','MYR','NAD','NGN','NIO','NOK','NPR','NZD',
  'PEN','PGK','PHP','PKR','PLN','QAR','RON','RUB','SAR','SCR','SEK','SGD','SLL','SOS',
  'SSP','SVC','SZL','THB','TTD','TZS','USD','UYU','UZS','YER','ZAR',
]);

// Where a country's own money is one we can actually charge in. A fan is
// offered their local currency, USD, or INR — three choices, not a list of a
// hundred. Anywhere not listed sees USD and INR.
const COUNTRY_CURRENCY = {
  'united states': 'USD', 'usa': 'USD',
  'united kingdom': 'GBP', 'uk': 'GBP', 'great britain': 'GBP', 'england': 'GBP',
  'united arab emirates': 'AED', 'uae': 'AED',
  'australia': 'AUD',
  'canada': 'CAD',
  'singapore': 'SGD',
  'hong kong': 'HKD',
  // Euro area
  'germany': 'EUR', 'france': 'EUR', 'italy': 'EUR', 'spain': 'EUR',
  'netherlands': 'EUR', 'belgium': 'EUR', 'ireland': 'EUR', 'austria': 'EUR',
  'portugal': 'EUR', 'finland': 'EUR', 'greece': 'EUR', 'luxembourg': 'EUR',
  'slovakia': 'EUR', 'slovenia': 'EUR', 'estonia': 'EUR', 'latvia': 'EUR',
  'lithuania': 'EUR', 'cyprus': 'EUR', 'malta': 'EUR', 'croatia': 'EUR',
  // Beyond the original eight, wherever both Razorpay and the rate source agree.
  'japan': 'JPY', 'china': 'CNY', 'switzerland': 'CHF', 'sweden': 'SEK',
  'norway': 'NOK', 'denmark': 'DKK', 'poland': 'PLN', 'czechia': 'CZK',
  'czech republic': 'CZK', 'hungary': 'HUF', 'romania': 'RON', 'israel': 'ILS',
  'new zealand': 'NZD', 'south africa': 'ZAR', 'thailand': 'THB',
  'malaysia': 'MYR', 'indonesia': 'IDR', 'philippines': 'PHP',
  'south korea': 'KRW', 'korea': 'KRW', 'turkey': 'TRY', 'mexico': 'MXN',
  'brazil': 'BRL', 'bulgaria': 'BGN', 'iceland': 'ISK',
};

function isChargeable(code) {
  return RAZORPAY_CURRENCIES.has(code);
}

function localCurrencyFor(country) {
  if (!country) return null;
  return COUNTRY_CURRENCY[country.trim().toLowerCase()] || null;
}

async function maxAgeHours() {
  return (await getConfigNumber('fx_max_age_hours')) || 48;
}

// Only currencies with a rate we still trust. A stale rate is worse than no
// option at all — the fan simply pays in INR, which always works.
async function listCurrencies() {
  const hours = await maxAgeHours();
  const { rows } = await pool.query(
    `SELECT currency, inr_per_unit, symbol, label, decimals, updated_at
     FROM fx_rates
     WHERE active = TRUE AND updated_at > NOW() - ($1 || ' hours')::interval
     ORDER BY currency`,
    [String(hours)]
  );
  return rows.map((r) => ({
    currency: r.currency,
    symbol:   r.symbol,
    label:    r.label,
    decimals: r.decimals,
    inrPerUnit: parseFloat(r.inr_per_unit),
  }));
}

async function getRate(currency) {
  if (!currency || currency === HOME) return null;
  const hours = await maxAgeHours();
  const { rows } = await pool.query(
    `SELECT currency, inr_per_unit, symbol, label, decimals
     FROM fx_rates
     WHERE currency = $1 AND active = TRUE
       AND updated_at > NOW() - ($2 || ' hours')::interval`,
    [currency, String(hours)]
  );
  if (!rows.length) return null;
  return { ...rows[0], inrPerUnit: parseFloat(rows[0].inr_per_unit) };
}

// Rounds up, never down. A half-paisa rounded the wrong way across thousands of
// transactions is a shortfall nobody notices until reconciliation.
function roundUpTo(amount, decimals) {
  const f = Math.pow(10, decimals);
  return Math.ceil(amount * f) / f;
}

// Converts an INR price into the fan's currency, with a buffer on top.
//
// The buffer absorbs movement between the moment we quote and the moment the
// money actually settles — which can be days. Without it, a rupee that weakens
// overnight means we banked less than the price we advertised.
async function quote(amountInr, currency) {
  const rate = await getRate(currency);
  if (!rate) {
    const err = new Error(`No usable rate for ${currency}`);
    err.code = 'NO_FX_RATE';
    throw err;
  }

  const bufferPct = (await getConfigNumber('fx_buffer_pct')) || 0;
  const effectiveInrPerUnit = rate.inrPerUnit / (1 + bufferPct / 100);
  const raw = amountInr / effectiveInrPerUnit;
  const amount = roundUpTo(raw, rate.decimals);

  return {
    currency:   rate.currency,
    symbol:     rate.symbol,
    decimals:   rate.decimals,
    amount,                                   // charged in the fan's currency
    amountInr,                                // the INR value it represents
    inrPerUnit: rate.inrPerUnit,
    bufferPct,
    // The invoice prints "1 INR = X {currency}", so the reciprocal is stored.
    exchangeRateUsed: +(amount / amountInr).toFixed(6),
    display: `${rate.symbol}${amount.toFixed(rate.decimals)}`,
  };
}

// Which currency to actually charge in. A stated preference always wins — the
// fan was asked, and a guess should never override an answer. Country is only
// used to decide whether to ask.
async function resolveForUser({ preferredCurrency, country }) {
  if (!preferredCurrency || preferredCurrency === HOME) {
    return { currency: HOME, isForeign: false, shouldAsk: isForeignCountry(country) && !preferredCurrency };
  }
  const rate = await getRate(preferredCurrency);
  // A preference we can no longer price falls back to INR rather than failing
  // the purchase outright.
  if (!rate) return { currency: HOME, isForeign: false, shouldAsk: false, rateUnavailable: true };
  return { currency: preferredCurrency, isForeign: true, shouldAsk: false };
}

function isForeignCountry(country) {
  return Boolean(country && country !== 'Unknown' && country.trim().toLowerCase() !== 'india');
}

// Currencies that need no decimal places — quoting ¥7.73 is wrong, and a
// fraction of a yen does not exist.
const ZERO_DECIMAL = new Set(['JPY','KRW','VND','CLP','ISK','HUF','TWD','UGX','RWF','XAF','XOF']);

// Symbols worth showing. Anything else falls back to its code, which reads
// perfectly well — "MYR 32.00" is clearer than a symbol nobody recognises.
const SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', HKD: 'HK$', NZD: 'NZ$', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ',
  DKK: 'kr ', ZAR: 'R', BRL: 'R$', MXN: 'MX$', THB: '฿', PHP: '₱',
  ILS: '₪', KRW: '₩', TRY: '₺', PLN: 'zł ', AED: 'AED ', SAR: 'SAR ',
};

// Refreshes rates, and adds any currency the source quotes that Razorpay can
// also settle — so the list grows on its own rather than being hand-maintained.
//
// Failure is survivable: previous values stay and simply age out of use, rather
// than being replaced by something wrong.
async function refreshRates() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=INR');
    if (!res.ok) throw new Error(`rate service returned ${res.status}`);
    const data = await res.json();
    if (!data.rates) throw new Error('no rates in response');

    let updated = 0, added = 0;
    for (const [currency, perInr] of Object.entries(data.rates)) {
      if (!isChargeable(currency)) continue;      // Razorpay would refuse it
      const inrPerUnit = 1 / perInr;
      if (!isFinite(inrPerUnit) || inrPerUnit <= 0) continue;

      const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
      const { rowCount } = await pool.query(
        `INSERT INTO fx_rates (currency, inr_per_unit, symbol, label, decimals, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'frankfurter', NOW())
         ON CONFLICT (currency) DO UPDATE
           SET inr_per_unit = EXCLUDED.inr_per_unit,
               source = 'frankfurter',
               updated_at = NOW()`,
        [currency, inrPerUnit.toFixed(4), SYMBOLS[currency] || `${currency} `, currency, decimals]
      );
      updated += rowCount;
      if (!SYMBOLS[currency]) added += 0;
    }
    console.log(`fx: refreshed ${updated} rate(s) from frankfurter`);
    return { updated, added };
  } catch (err) {
    console.error('fx/refreshRates failed, keeping previous rates:', err.message);
    return { updated: 0, error: err.message };
  }
}

// The three things a fan abroad should be offered, in the order they should
// appear: their own currency where we support it, then USD, then INR.
//
// Local and USD are both paid in foreign exchange, so both make the sale a
// zero-rated export. INR does not — it stays a taxable inter-state supply and is
// offered because some people simply prefer to see the price in rupees, and
// because it always works when a rate is unavailable.
async function optionsForCountry(country) {
  const available = await listCurrencies();
  const byCode = new Map(available.map((c) => [c.currency, c]));

  const out = [];
  const local = localCurrencyFor(country);
  if (local && byCode.has(local)) {
    out.push({ ...byCode.get(local), isLocal: true, zeroRated: true });
  }
  if (local !== 'USD' && byCode.has('USD')) {
    out.push({ ...byCode.get('USD'), isLocal: false, zeroRated: true });
  }
  out.push({
    currency: HOME, symbol: '₹', label: 'Indian Rupee', decimals: 0,
    isLocal: false, zeroRated: false,
  });
  return out;
}

module.exports = { HOME, listCurrencies, getRate, quote, resolveForUser,
                   isForeignCountry, localCurrencyFor, optionsForCountry, refreshRates,
                   isChargeable, RAZORPAY_CURRENCIES };