// backend/routes/public.js
const router = require('express').Router();
const pool   = require('../db/pool');

router.get('/config', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key IN (
         'token_rate_inr',
         'community_monthly_cost',
         'insider_monthly_cost',
         'premium_monthly_cost',
         'supreme_monthly_cost',
         'config_published',
         'recharge_discount_tier1_threshold',
         'recharge_discount_tier1_pct',
         'recharge_discount_tier2_threshold',
         'recharge_discount_tier2_pct',
         'legal_registered_address',
         'legal_gstin'
       )`
    );
    const raw = {};
    rows.forEach((r) => { raw[r.key] = r.value; });

    // Map to the standard names the frontend expects
    const config = {
      token_rate_inr:          raw.token_rate_inr          || '66',
      community_monthly_cost:  raw.community_monthly_cost || '10',
      insider_monthly_cost:    raw.insider_monthly_cost   || '20',
      premium_monthly_cost:    raw.premium_monthly_cost   || '40',
      supreme_monthly_cost:    raw.supreme_monthly_cost   || '110',
      config_published:        raw.config_published         || 'false',
    };

    res.json({ config });
  } catch (err) {
    console.error('public/config error:', err);
    res.json({
      config: {
        token_rate_inr:         '66',
        community_monthly_cost: '10',
        insider_monthly_cost:   '20',
        premium_monthly_cost:   '40',
        supreme_monthly_cost:   '110',
      },
    });
  }
});

module.exports = router;