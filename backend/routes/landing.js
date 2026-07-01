// backend/routes/landing.js
const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const https   = require('https');

// ── Sun sign from DOB ─────────────────────────────────────────────────────────
function getSunSign(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const month = d.getUTCMonth() + 1;
  const day   = d.getUTCDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return 'aries';
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return 'taurus';
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return 'gemini';
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return 'cancer';
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return 'leo';
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return 'virgo';
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return 'libra';
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return 'scorpio';
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return 'sagittarius';
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return 'capricorn';
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return 'aquarius';
  return 'pisces';
}

const SIGN_EMOJI = {
  aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍',
  libra: '♎', scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓',
};

// ── Fetch horoscope from free API ─────────────────────────────────────────────
function fetchHoroscope(sign) {
  return new Promise((resolve) => {
    const url = `https://freehoroscopeapi.com/api/v1/get-horoscope/daily?sign=${sign}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json?.data?.horoscope || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
    // Timeout after 3 seconds
    setTimeout(() => resolve(null), 3000);
  });
}

// ── Daily rotation by date ────────────────────────────────────────────────────
function dayIndex() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

// ── GET /api/landing ──────────────────────────────────────────────────────────
router.get('/', authMid, async (req, res) => {
  try {
    // Get user profile
    const { rows: userRows } = await pool.query(
      `SELECT display_name, dob, email FROM users WHERE id = $1`,
      [req.user.userId]
    );
    const user    = userRows[0];
    const name    = user.display_name || user.email?.split('@')[0] || 'there';
    const sunSign = getSunSign(user.dob);
    const idx     = dayIndex();

    // Fetch all content in parallel
    const [quotesRes, thoughtsRes, jinalRes, horoscope] = await Promise.all([
      pool.query(`SELECT quote, author FROM daily_quotes ORDER BY id`),
      pool.query(`SELECT thought FROM daily_thoughts ORDER BY id`),
      pool.query(`SELECT quote FROM jinal_quotes WHERE active = TRUE ORDER BY id`),
      sunSign ? fetchHoroscope(sunSign) : Promise.resolve(null),
    ]);

    // Rotate by day
    const quotes   = quotesRes.rows;
    const thoughts = thoughtsRes.rows;
    const jinal    = jinalRes.rows;

    const quote   = quotes.length   ? quotes[idx % quotes.length]     : null;
    const thought = thoughts.length ? thoughts[idx % thoughts.length]  : null;
    const jq      = jinal.length    ? jinal[idx % jinal.length]        : null;

    // Greeting based on time of day (IST = UTC+5:30)
    const hour = (new Date().getUTCHours() + 5) % 24;
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    res.json({
      name,
      greeting,
      sunSign,
      sunSignEmoji: sunSign ? SIGN_EMOJI[sunSign] : null,
      horoscope,
      quote:   quote   ? { text: quote.quote,   author: quote.author } : null,
      thought: thought ? thought.thought  : null,
      jinalQuote: jq   ? jq.quote         : null,
    });
  } catch (err) {
    console.error('landing error:', err);
    res.status(500).json({ error: 'Failed to load landing data' });
  }
});

module.exports = router;