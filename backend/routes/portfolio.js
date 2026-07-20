// backend/routes/portfolio.js
// Public, unauthenticated — powers the live jinaljoshi.in site directly.
const router = require('express').Router();
const pool   = require('../db/pool');

const CATEGORY_ORDER = ['films', 'web_series', 'music_videos', 'ad_films', 'short_films', 'skits'];

router.get('/', async (req, res) => {
  try {
    const [{ rows: slides }, { rows: works }] = await Promise.all([
      pool.query(`SELECT image_key FROM portfolio_hero_slides WHERE visible = TRUE ORDER BY position ASC, created_at ASC`),
      pool.query(`SELECT category, title, year, character, watch_now_url, trailer_url, image_key
                  FROM portfolio_works WHERE visible = TRUE ORDER BY position ASC, created_at ASC`),
    ]);

    const worksByCategory = {};
    CATEGORY_ORDER.forEach((c) => { worksByCategory[c] = []; });
    works.forEach((w) => {
      if (!worksByCategory[w.category]) worksByCategory[w.category] = [];
      worksByCategory[w.category].push({
        title: w.title, year: w.year, character: w.character,
        watchNow: w.watch_now_url, trailer: w.trailer_url, image: w.image_key,
      });
    });

    res.json({ heroSlides: slides.map((s) => s.image_key), works: worksByCategory });
  } catch (err) {
    console.error('portfolio/get error:', err);
    res.status(500).json({ error: 'Failed to load portfolio data' });
  }
});

module.exports = router;