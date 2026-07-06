// backend/lib/config.js
// Centralized reads for all Studio-configurable pricing and limits, with sensible fallbacks

const pool = require('../db/pool');

const DEFAULTS = {
  token_rate_inr: 66,

  community_monthly_cost: 10,
  insider_monthly_cost:   30,
  premium_monthly_cost:   75,
  supreme_monthly_cost:   150,

  community_discount_pct: 5,
  insider_discount_pct:   10,
  premium_discount_pct:   15,
  supreme_discount_pct:   20,

  community_daily_free_messages:       1,
  community_tokens_per_credit_block:   1,
  community_messages_per_credit_block: 3,

  gallery_unlocks_community: 1,
  gallery_unlocks_insider:   4,
  gallery_unlocks_premium:   7,
  gallery_unlocks_supreme:   10,

  call_audio_per_min:    8,
  call_video_per_min:    15,
  call_priority_per_min: 22,
};

async function getConfigValue(key) {
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = $1`, [key]);
    if (rows[0]) return rows[0].value;
  } catch (err) {
    console.error(`config/getConfigValue error for ${key}:`, err.message);
  }
  return DEFAULTS[key] !== undefined ? String(DEFAULTS[key]) : null;
}

async function getConfigNumber(key) {
  const raw = await getConfigValue(key);
  const num = parseFloat(raw);
  return isNaN(num) ? DEFAULTS[key] : num;
}

// Fetch multiple values in a single query, each falling back independently
async function getConfigNumbers(keys) {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM platform_config WHERE key = ANY($1)`,
      [keys]
    );
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });
    const result = {};
    keys.forEach((k) => {
      const num = map[k] !== undefined ? parseFloat(map[k]) : NaN;
      result[k] = isNaN(num) ? DEFAULTS[k] : num;
    });
    return result;
  } catch (err) {
    console.error('config/getConfigNumbers error:', err.message);
    const result = {};
    keys.forEach((k) => { result[k] = DEFAULTS[k]; });
    return result;
  }
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

const GALLERY_UNLOCK_KEYS = {
  community: 'gallery_unlocks_community',
  insider:   'gallery_unlocks_insider',
  premium:   'gallery_unlocks_premium',
  supreme:   'gallery_unlocks_supreme',
};

async function getGalleryUnlocksForTier(tier) {
  if (!GALLERY_UNLOCK_KEYS[tier]) return 0;
  return getConfigNumber(GALLERY_UNLOCK_KEYS[tier]);
}

module.exports = {
  DEFAULTS,
  getConfigValue,
  getConfigNumber,
  getConfigNumbers,
  getDiscountForTier,
  getTierPrice,
  getAllTierPrices,
  getGalleryUnlocksForTier,
};