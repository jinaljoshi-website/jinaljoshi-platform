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

  // The ladder's per-tier cap. Public because the fan app decides from it
  // whether a tier is uncapped, and says so in the perk list. Without it
  // cfgNum() returned null, null === 0 was never true, and Supreme — the one
  // uncapped tier — advertised itself as merely included and lost its "no fair
  // usage limit" line entirely.
  'tier_open_cap_community', 'tier_open_cap_insider',
  'tier_open_cap_premium',   'tier_open_cap_supreme',

  'dm_free_per_month_community', 'dm_free_per_month_insider',
  'dm_free_per_month_premium',   'dm_free_per_month_supreme',

  'dm_daily_cap_community', 'dm_daily_cap_insider',
  'dm_daily_cap_premium',   'dm_daily_cap_supreme',

  'dm_overage_cost_community', 'dm_overage_cost_insider',
  'dm_overage_cost_premium',   'dm_overage_cost_supreme',

  'guest_community_cost',

  'recharge_discount_tier1_threshold', 'recharge_discount_tier1_pct',
  'recharge_discount_tier2_threshold', 'recharge_discount_tier2_pct',

  'domestic_gst_rate_pct',
  'auction_starting_bid_pct',
  'auction_buynow_bid_multiplier',
  'auction_buynow_base_multiplier',
  'auction_duration_hours',
  'auction_claim_hours',
  'auction_cooldown_days',
  'auction_handling_fee',
  'auction_min_balance_to_bid',
  'auction_max_bid_balance_multiple',

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