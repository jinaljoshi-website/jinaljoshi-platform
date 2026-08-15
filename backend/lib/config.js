// backend/lib/config.js
// Every Studio-configurable value is read here.
//
// There are deliberately NO fallbacks for anything that decides what a fan is
// charged. A hardcoded price copy drifts the moment Jinal changes one in Studio,
// and it does so silently — the platform would keep charging an old number with
// no error anywhere. Instead, a missing price throws: the request fails visibly,
// nothing is debited, and the cause is in the logs.
//
// Operational settings that merely affect timing keep defaults, because a wrong
// ring window is a nuisance where a wrong price is a refund.

const pool = require('../db/pool');
const { roundTokensUp } = require('./pricing');

// Timing and behaviour only. Nothing here decides an amount of money.
const DEFAULTS = {
  call_ring_window_seconds: 60,
  call_min_lead_hours:      6,
  fx_buffer_pct:            3,
};

// If any of these is missing, we refuse to price rather than guess. The startup
// check reports them all at once so a bad deploy is obvious immediately.
const REQUIRED_PRICING = new Set([
  'token_rate_inr',
  'guest_price_multiplier',
  'domestic_gst_rate_pct',
  'community_monthly_cost', 'insider_monthly_cost', 'premium_monthly_cost', 'supreme_monthly_cost',
  'community_discount_pct', 'insider_discount_pct', 'premium_discount_pct', 'supreme_discount_pct',
  'call_audio_per_min', 'call_video_per_min', 'call_priority_per_min',
  'dm_free_per_month_community', 'dm_free_per_month_insider', 'dm_free_per_month_premium', 'dm_free_per_month_supreme',
  'dm_daily_cap_community', 'dm_daily_cap_insider', 'dm_daily_cap_premium', 'dm_daily_cap_supreme',
  'dm_overage_cost_community', 'dm_overage_cost_insider', 'dm_overage_cost_premium', 'dm_overage_cost_supreme',
]);

function missingPricingError(key) {
  const err = new Error(`Pricing config missing: ${key}`);
  err.code = 'CONFIG_MISSING';
  err.configKey = key;
  return err;
}

// Reports every missing required key in one pass. Called at boot so config drift
// surfaces on deploy rather than on a fan's first purchase.
async function checkPricingConfig() {
  try {
    const { rows } = await pool.query(
      `SELECT key FROM platform_config WHERE key = ANY($1)`,
      [[...REQUIRED_PRICING]]
    );
    const present = new Set(rows.map((r) => r.key));
    const missing = [...REQUIRED_PRICING].filter((k) => !present.has(k));
    if (missing.length) {
      console.error('─'.repeat(70));
      console.error(`CONFIG WARNING: ${missing.length} required pricing key(s) missing from platform_config.`);
      console.error('Anything priced from these will fail rather than guess a value:');
      missing.forEach((k) => console.error(`  · ${k}`));
      console.error('─'.repeat(70));
    } else {
      console.log(`Pricing config OK — all ${REQUIRED_PRICING.size} required keys present.`);
    }
    return missing;
  } catch (err) {
    console.error('checkPricingConfig failed:', err.message);
    return null;
  }
}

async function getConfigValue(key) {
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = $1`, [key]);
    if (rows[0]) return rows[0].value;
  } catch (err) {
    console.error(`config/getConfigValue error for ${key}:`, err.message);
    if (REQUIRED_PRICING.has(key)) throw missingPricingError(key);
  }
  if (REQUIRED_PRICING.has(key)) throw missingPricingError(key);
  return DEFAULTS[key] !== undefined ? String(DEFAULTS[key]) : null;
}

async function getConfigNumber(key) {
  const raw = await getConfigValue(key);
  const num = parseFloat(raw);
  if (isNaN(num)) {
    if (REQUIRED_PRICING.has(key)) throw missingPricingError(key);
    return DEFAULTS[key];
  }
  return num;
}

async function getConfigNumbers(keys) {
  const { rows } = await pool.query(
    `SELECT key, value FROM platform_config WHERE key = ANY($1)`,
    [keys]
  );
  const map = {};
  rows.forEach((r) => { map[r.key] = r.value; });
  const result = {};
  keys.forEach((k) => {
    const num = map[k] !== undefined ? parseFloat(map[k]) : NaN;
    if (isNaN(num)) {
      if (REQUIRED_PRICING.has(k)) throw missingPricingError(k);
      result[k] = DEFAULTS[k];
    } else {
      result[k] = num;
    }
  });
  return result;
}

const DISCOUNT_KEYS = {
  community: 'community_discount_pct',
  insider:   'insider_discount_pct',
  premium:   'premium_discount_pct',
  supreme:   'supreme_discount_pct',
};

async function getDiscountForTier(tier) {
  if (!tier || tier === 'guest' || !DISCOUNT_KEYS[tier]) return 0;
  return getConfigNumber(DISCOUNT_KEYS[tier]);
}

const TIER_PRICE_KEYS = {
  community: 'community_monthly_cost',
  insider:   'insider_monthly_cost',
  premium:   'premium_monthly_cost',
  supreme:   'supreme_monthly_cost',
};

async function getTierPrice(tier) {
  if (!TIER_PRICE_KEYS[tier]) return null;
  return getConfigNumber(TIER_PRICE_KEYS[tier]);
}

async function getAllTierPrices() {
  const vals = await getConfigNumbers(Object.values(TIER_PRICE_KEYS));
  return {
    community: vals.community_monthly_cost,
    insider:   vals.insider_monthly_cost,
    premium:   vals.premium_monthly_cost,
    supreme:   vals.supreme_monthly_cost,
  };
}

// The per-tier monthly allowance this once read — gallery_unlocks_{tier} — was
// retired when the ladder replaced it with tier_open_cap_{tier}, and Studio has
// had no field for it since. Nothing calls it now, and the earnings maths that
// once divided by it no longer values membership unlocks at all.

async function getGuestMultiplier() {
  return getConfigNumber('guest_price_multiplier');
}

const DM_TIER_KEYS = ['community', 'insider', 'premium', 'supreme'];

async function getDmConfigForTier(tier) {
  if (tier === 'guest') {
    const [communityOverage, guestMultiplier] = await Promise.all([
      getConfigNumber('dm_overage_cost_community'),
      getGuestMultiplier(),
    ]);
    return {
      freeDMsPerMonth: 0,
      dailyDMCap: 0,
      // Rounded, because tokens are whole numbers and tokens_charged is an
      // integer column. This was the one price on the platform that applied a
      // multiplier without rounding — so a guest multiplier of 1.25 against a
      // 1-token message produced 1.25, Postgres rejected the insert outright,
      // and no guest could send a message at all. Members were unaffected,
      // which is why it looked like a permissions problem rather than a price.
      overageCost: roundTokensUp(communityOverage * guestMultiplier),
    };
  }
  if (!DM_TIER_KEYS.includes(tier)) {
    return { freeDMsPerMonth: 0, dailyDMCap: 0, overageCost: await getConfigNumber('dm_overage_cost_community') };
  }
  const vals = await getConfigNumbers([
    `dm_free_per_month_${tier}`,
    `dm_daily_cap_${tier}`,
    `dm_overage_cost_${tier}`,
  ]);
  return {
    freeDMsPerMonth: vals[`dm_free_per_month_${tier}`],
    dailyDMCap:      vals[`dm_daily_cap_${tier}`],
    overageCost:     vals[`dm_overage_cost_${tier}`],
  };
}

async function getCallRingWindowSeconds() {
  return getConfigNumber('call_ring_window_seconds');
}

async function getCallMinLeadHours() {
  return getConfigNumber('call_min_lead_hours');
}

async function getDndEnabled() {
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'artist_dnd_enabled'`);
    return rows[0]?.value === 'true';
  } catch (err) {
    console.error('config/getDndEnabled error:', err.message);
    return false;
  }
}

async function setDndEnabled(enabled) {
  await pool.query(
    `INSERT INTO platform_config (key, value) VALUES ('artist_dnd_enabled', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [enabled ? 'true' : 'false']
  );
}

module.exports = {
  DEFAULTS,
  REQUIRED_PRICING,
  checkPricingConfig,
  getConfigValue,
  getConfigNumber,
  getConfigNumbers,
  getDiscountForTier,
  getTierPrice,
  getAllTierPrices,
  getGuestMultiplier,
  getDmConfigForTier,
  getCallRingWindowSeconds,
  getCallMinLeadHours,
  getDndEnabled,
  setDndEnabled,
};