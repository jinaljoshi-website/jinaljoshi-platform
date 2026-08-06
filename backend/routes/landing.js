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
// A real horoscope is plain, readable English prose. If the API ever returns something
// broken, garbled, or nonsensical, we skip it entirely rather than show it to users.
function isPlausibleHoroscopeText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 30 || trimmed.length > 2000) return false;

  // Real prose has real word-length words and spaces; garbage tends to be one
  // enormous run with few/no spaces, or excessive repetition of a short fragment.
  const spaceRatio = (trimmed.match(/ /g) || []).length / trimmed.length;
  if (spaceRatio < 0.08) return false;

  const words = trimmed.split(/\s+/);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  if (words.length > 10 && uniqueWords.size / words.length < 0.3) return false; // too repetitive

  return true;
}

function fetchHoroscope(sign) {
  return new Promise((resolve) => {
    const url = `https://freehoroscopeapi.com/api/v1/get-horoscope/daily?sign=${sign}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json?.data?.horoscope;
          resolve(isPlausibleHoroscopeText(text) ? text : null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
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

    // Whether Jinal is reachable right now. Read live rather than cached — she
    // switches these from the dashboard when she walks into a shoot, and a card
    // saying she is available when she has just said otherwise is worse than a
    // card saying nothing.
    const { rows: dndRows } = await pool.query(
      `SELECT key, value FROM platform_config
       WHERE key IN ('artist_dnd_enabled', 'dnd_chat_enabled')`
    );
    const dnd = {};
    dndRows.forEach((r) => { dnd[r.key] = r.value === 'true'; });

    // What is waiting for them. Counted from the flag rather than a timestamp,
    // so a fan who opens the thread and scrolls past a message has genuinely
    // seen it.
    const { rows: unreadRows } = await pool.query(
      `SELECT count(*)::int AS n FROM direct_messages
       WHERE recipient_id = $1 AND sender_id = $2 AND read = FALSE`,
      [req.user.userId, process.env.ARTIST_USER_ID]
    );

    // Sets they have never opened. Counted against set_views rather than a
    // publication date, so a set posted last week that they still have not
    // looked at keeps counting — the question is what is waiting for them, not
    // what is recent.
    const { rows: newSets } = await pool.query(
      `SELECT count(*)::int AS n
       FROM sets s
       WHERE s.visible = TRUE AND s.is_vault = FALSE
         AND NOT EXISTS (SELECT 1 FROM set_views v WHERE v.set_id = s.id AND v.user_id = $1)`,
      [req.user.userId]
    );

    res.json({
      unseenSets: newSets[0].n,
      unreadMessages: unreadRows[0].n,
      chatLive:      !dnd.dnd_chat_enabled,
      callsAvailable: !dnd.artist_dnd_enabled,
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