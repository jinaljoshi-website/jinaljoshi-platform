// backend/routes/public.js
// Public endpoints — no auth required
// Used by the homepage to fetch live pricing

const router = require('express').Router();
const pool   = require('../db/pool');

// GET /api/public/config
// Returns pricing config visible on the homepage
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
         'config_published'
       )`
    );
    const config = {};
    rows.forEach((r) => { config[r.key] = r.value; });

    // Fallback defaults if not set
    const defaults = {
      token_rate_inr:          '66',
      community_monthly_cost:  '10',
      insider_monthly_cost:    '30',
      premium_monthly_cost:    '75',
      supreme_monthly_cost:    '150',
    };
    Object.entries(defaults).forEach(([k, v]) => {
      if (!config[k]) config[k] = v;
    });

    res.json({ config });
  } catch (err) {
    console.error('public/config error:', err);
    // Return defaults on error so homepage never breaks
    res.json({
      config: {
        token_rate_inr:         '66',
        community_monthly_cost: '10',
        insider_monthly_cost:   '30',
        premium_monthly_cost:   '75',
        supreme_monthly_cost:   '150',
      },
    });
  }
});

module.exports = router;