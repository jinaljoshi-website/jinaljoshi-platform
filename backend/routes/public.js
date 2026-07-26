// backend/routes/public.js
const router = require('express').Router();
const pool   = require('../db/pool');

// Key NAMES only — never values. Every price lives in platform_config and is set
// from Studio. This list exists purely to stop non-public config from leaking.
const PUBLIC_KEYS = [
  'token_rate_inr',
  'guest_price_multiplier',
  'config_published',

  'community_monthly_cost', 'insider_monthly_cost',
  'premium_monthly_cost',   'supreme_monthly_cost',

  'community_discount_pct', 'insider_discount_pct',
  'premium_discount_pct',   'supreme_discount_pct',

  'gallery_unlocks_community', 'gallery_unlocks_insider',
  'gallery_unlocks_premium',   'gallery_unlocks_supreme',

  'dm_free_per_month_community', 'dm_free_per_month_insider',
  'dm_free_per_month_premium',   'dm_free_per_month_supreme',

  'dm_daily_cap_community', 'dm_daily_cap_insider',
  'dm_daily_cap_premium',   'dm_daily_cap_supreme',

  'dm_overage_cost_community', 'dm_overage_cost_insider',
  'dm_overage_cost_premium',   'dm_overage_cost_supreme',

  'guest_community_cost',

  'recharge_discount_tier1_threshold', 'recharge_discount_tier1_pct',
  'recharge_discount_tier2_threshold', 'recharge_discount_tier2_pct',

  'quarterly_billing_months', 'annual_billing_months',

  'legal_registered_address', 'legal_gstin',
];

// Last known-good read. Survives a database blip; never invents a value.
let lastGood = null;

router.get('/config', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM platform_config WHERE key = ANY($1)`,
      [PUBLIC_KEYS]
    );
    const config = {};
    rows.forEach((r) => { if (r.value !== null) config[r.key] = r.value; });
    lastGood = config;
    res.json({ config });
  } catch (err) {
    console.error('public/config error:', err.message);
    if (lastGood) return res.json({ config: lastGood, stale: true });
    res.status(503).json({ error: 'Configuration unavailable' });
  }
});

module.exports = router;