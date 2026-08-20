// backend/routes/traffic.js
//
// Counting visits and clicks, on both sites, without anybody else's help.
//
// ── Why this exists at all ──────────────────────────────────────────
//
// The platform knows exactly what happened after somebody signed up and paid,
// and nothing whatsoever about how many people arrived. Seventy-two registered
// and eleven paid, and there is no way to say whether that is a good ratio or a
// terrible one, because the number it divides into was never counted.
//
// ── What is not counted here ────────────────────────────────────────
//
// Everything that reaches the API already: a set opened, a message sent, tokens
// bought. Those are recorded properly elsewhere, and counting them again would
// give two numbers that drift apart and no way to tell which is right.
//
// What is counted is what the server never hears about — somebody moving
// between sections, looking at a locked set and not buying it, opening the
// top-up modal and closing it, or a page throwing an error nobody reports.
// Abandoned intent is the whole point: the platform records what succeeded, and
// this records what was considered.
//
// ── Anonymous by construction ───────────────────────────────────────
//
// A signed-in fan is recorded by id, because knowing what a member browsed
// before subscribing is a fair question to ask of one's own platform. Everybody
// else gets a hash of their address and browser, salted per day: enough to tell
// two visits apart within a day, impossible to reverse, and gone by tomorrow.
// No IP is stored. Nothing follows anyone off the site.

const router = require('express').Router();
const crypto = require('crypto');
const pool   = require('../db/pool');
const { getClientIp, lookupIpCountry } = require('../lib/geoip');

// Country, looked up once a day per visitor rather than once a pageview.
//
// The lookup is a free-tier service with a rate limit, and a pageview counter
// can fire hundreds of times an hour — calling it per view would exhaust the
// quota by lunchtime and start returning nothing, which is how a column ends up
// quietly empty. Cached in memory against the visitor's own daily hash: the
// first view of a visit pays for the lookup and the rest are free.
//
// Held in the process, so it is lost on deploy. That costs one extra lookup per
// visitor afterwards, which is a fair price for not adding a table.
const countryCache = new Map();

async function countryFor(req, key) {
  if (countryCache.has(key)) return countryCache.get(key);
  // Cloudflare's header if it is ever put behind one; otherwise look it up.
  const header = req.headers['cf-ipcountry'];
  if (header) { countryCache.set(key, header); return header; }
  try {
    const { country } = await lookupIpCountry(getClientIp(req));
    countryCache.set(key, country || null);
    // A day's worth is plenty, and the map should not grow without bound.
    if (countryCache.size > 5000) countryCache.clear();
    return country || null;
  } catch { return null; }
}

// The only events that count. Anything not named here is ignored.
//
// A closed list rather than an open one: an endpoint that accepts any label
// fills up with typos and one-off experiments, and a year later nobody can say
// what half the rows meant.
const EVENTS = new Set([
  'nav_click',       // moved between sections
  'work_click',      // opened a piece of work on the portfolio
  'set_preview',     // looked at a locked set without buying
  'topup_opened',    // opened the top-up modal
  'topup_abandoned', // ...and closed it without paying
  'call_started',    // chose a call type
  'gallery_scroll',  // reached the bottom of a gallery
  'outbound',        // followed a link away
  'error',           // something threw
]);

const SITES = new Set(['ps', 'portfolio']);

// Rotates at midnight UTC, so a visitor cannot be followed across days.
function visitorHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  const ip  = req.headers['cf-connecting-ip'] || req.ip || '';
  const ua  = req.headers['user-agent'] || '';
  return crypto.createHash('sha256')
    .update(`${day}:${ip}:${ua}:${process.env.JWT_SECRET || 'salt'}`)
    .digest('hex').slice(0, 32);
}

// The host only. Enough to know somebody came from Instagram, not enough to
// know which post — which is the line between a channel and a profile.
function referrerHost(ref) {
  if (!ref) return null;
  try { return new URL(ref).hostname.replace(/^www\./, ''); } catch { return null; }
}

function deviceFrom(ua = '') {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Crawlers are not visitors, and counting them makes every number a lie.
function isBot(ua = '') {
  return /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|headless/i.test(ua);
}

// ─────────────────────────────────────────────
// POST /api/traffic/hit
// ─────────────────────────────────────────────
//
// Unauthenticated by necessity: most of what is worth counting happens before
// anybody signs in. A token is read if one is sent, so a member's browsing can
// be attributed, but its absence is not an error.
router.post('/hit', async (req, res) => {
  // Answered before any work is done. A counter that can slow a page down, or
  // fail one, is worse than no counter — nothing here is worth a visitor
  // waiting for, and nothing here is worth a page not loading over.
  res.status(204).end();

  try {
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) return;

    const { site, path, event, referrer, utm_source, utm_campaign, meta } = req.body || {};
    if (!SITES.has(site)) return;
    if (event && !EVENTS.has(event)) return;
    if (!path || String(path).length > 300) return;

    // A member if one is signed in, anonymous otherwise. Read directly rather
    // than through the auth middleware, which would reject anonymous visitors —
    // and they are most of what this exists to count.
    let userId = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        userId = jwt.verify(auth.slice(7), process.env.JWT_SECRET)?.userId || null;
      } catch { /* an expired token is simply an anonymous visit */ }
    }

    // The same key the visitor hash uses, so one lookup covers a whole visit
    // whether or not they are signed in.
    const hash = visitorHash(req);
    const country = await countryFor(req, hash);

    await pool.query(
      `INSERT INTO traffic (site, path, event, user_id, visitor_hash,
                            referrer_host, utm_source, utm_campaign,
                            country, device, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        site, String(path).slice(0, 300), event || null,
        userId, userId ? null : hash,
        referrerHost(referrer),
        utm_source ? String(utm_source).slice(0, 60) : null,
        utm_campaign ? String(utm_campaign).slice(0, 60) : null,
        country,
        deviceFrom(ua),
        meta ? JSON.stringify(meta).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    // Never surfaced. The response has already gone, and a failed count is not
    // worth an error in anybody's console.
    console.error('traffic/hit:', err.message);
  }
});

module.exports = router;