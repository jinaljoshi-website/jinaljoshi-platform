// backend/routes/share.js
// Link previews for shared gallery sets, merchandise and outfits.
//
// A plain React app serves the same empty shell on every URL, so a link posted
// to WhatsApp or Instagram previews as a bare address. Crawlers do not run
// JavaScript, and they will not sign in — whatever they are shown has to come
// back in the first response, already rendered.
//
// Three approaches were possible. The build-time pre-render in entry-server.jsx
// only covers seven fixed public pages and cannot know a set id that did not
// exist when the build ran. A Vercel edge function could rewrite for crawlers,
// but that means sniffing user agents, which fails quietly and differently on
// every platform. This is the third: one small page, served to everybody, that
// carries the tags a crawler needs and sends a person straight on to the app.
// Nothing has to guess who is asking.
//
// It is reached at ps.jinaljoshi.in/s/... through a rewrite in ps/vercel.json,
// so the link a fan sees belongs to the site rather than to Railway.
//
// No authentication, by necessity — a crawler has no session. So nothing here
// may return anything that is not already safe to show a stranger.

const router = require('express').Router();
const pool   = require('../db/pool');

const APP_BASE  = process.env.PS_APP_BASE_URL || 'https://ps.jinaljoshi.in';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || '';

function toUrl(key) {
  if (!key) return null;
  if (String(key).startsWith('http')) return key;
  return `${R2_PUBLIC}/${key}`;
}

// Everything placed in the page is escaped. A set title is typed by hand in
// Studio, and a stray quote or angle bracket would otherwise break out of the
// attribute it sits in and mangle every tag after it.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cut to a length that survives every platform's own truncation, on a word
// boundary so a preview never ends mid-syllable.
function trim(s, max = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, t.lastIndexOf(' ', max - 1) || max - 1)}…`;
}

// The page itself. Tags first, so a crawler that reads only the head still gets
// everything, then a redirect for the person who actually clicked.
//
// The redirect is a real one rather than an HTTP 302 because a 302 would carry
// the crawler away before it read anything. Belt and braces: a meta refresh for
// clients without scripting, and location.replace so the interstitial never
// enters history and the back button behaves.
function page({ title, description, image, url, type = 'website' }) {
  const safeTitle = esc(title);
  const safeDesc  = esc(description);
  const safeUrl   = esc(url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
<link rel="canonical" href="${safeUrl}">

<meta property="og:site_name" content="Personal Space">
<meta property="og:type" content="${esc(type)}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:url" content="${safeUrl}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${safeTitle}">` : ''}

<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}

<meta http-equiv="refresh" content="0;url=${safeUrl}">
<style>
  body { background:#1A1714; color:#F2EBE0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; text-align:center; }
  a { color:#C17D4A; }
</style>
</head>
<body>
  <p>Opening…<br><a href="${safeUrl}">Continue to Personal Space</a></p>
  <script>location.replace(${JSON.stringify(url)});</script>
</body>
</html>`;
}

// Anything unrecognised, unpublished or deleted goes to the homepage with the
// site's own card rather than a 404. A dead link that still looks like the site
// reads as a moved page; a broken preview reads as a broken site.
function fallback(res) {
  return res.status(200).type('html').send(page({
    title:       'Personal Space — Jinal Joshi',
    description: 'For those who want to be part of my journey beyond social media.',
    image:       null,
    url:         APP_BASE,
  }));
}

// ── Gallery set ───────────────────────────────
//
// The preview image is cover_og_key: a copy deliberately reduced to a few per
// cent of the original before being scaled back up, so the card shows colour and
// shape and nothing else. cover_key is the real photograph and must never appear
// here — it is what members pay to see, and a link preview is public by
// definition. cover_blur cannot be used either: it is stored as a data URI, and
// no platform will fetch one as a preview image.
router.get('/g/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, cover_og_key
       FROM sets
       WHERE id = $1 AND visible = TRUE AND is_collection = FALSE`,
      [req.params.id]
    );
    if (!rows.length) return fallback(res);
    const s = rows[0];
    res.type('html').send(page({
      title:       `${s.title} — Personal Space`,
      description: trim(s.description) || 'A new set is up on Personal Space.',
      image:       toUrl(s.cover_og_key),
      url:         `${APP_BASE}/platform/gallery/${s.id}`,
      type:        'article',
    }));
  } catch (err) {
    console.error('share/gallery error:', err.message);
    return fallback(res);
  }
});

// ── Merchandise ───────────────────────────────
//
// Product photographs, unlike set covers, are made to be seen — showing one is
// the point of sharing the link. So the real image is used, at full quality.
router.get('/m/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, img_key, is_auction_item,
              (SELECT mi.url FROM merchandise_images mi
                WHERE mi.merch_id = merchandise.id
                ORDER BY mi.position ASC LIMIT 1) AS first_image
       FROM merchandise
       WHERE id = $1 AND visible = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return fallback(res);
    const m = rows[0];
    // One table holds both, told apart by is_auction_item — so the link has to
    // land on whichever section the fan will actually find the item in.
    const path = m.is_auction_item ? 'outfits' : 'shop';
    res.type('html').send(page({
      title:       `${m.title} — Personal Space`,
      description: trim(m.description) || (m.is_auction_item
        ? 'One of one, shoot-worn, with a share to charity.'
        : 'Made in a handful, and retired when the month ends.'),
      image:       toUrl(m.first_image || m.img_key),
      url:         `${APP_BASE}/platform/${path}/${m.id}`,
      type:        'product',
    }));
  } catch (err) {
    console.error('share/merch error:', err.message);
    return fallback(res);
  }
});

// Outfits share the merchandise table, so /o/ and /m/ resolve identically. Both
// exist because a link that says outfits should keep saying it when somebody
// pastes it somewhere, and the route works out the destination either way.
router.get('/o/:id', (req, res, next) => {
  req.url = `/m/${req.params.id}`;
  router.handle(req, res, next);
});

module.exports = router;