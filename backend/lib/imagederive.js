// backend/lib/imagederive.js
//
// Two smaller versions of every photograph: one to show in a grid, one to show
// when somebody is not allowed to see it yet.
//
// ── Why this exists ─────────────────────────────────────────────────
//
// The gallery has been serving full-resolution originals everywhere a
// thumbnail belongs. A set page with seventy photographs pulls seventy
// full-size files down a phone connection to draw them at a couple of hundred
// pixels across, and no amount of lazy loading fixes what is being asked for.
//
// The blur is the other half. Only the set *cover* has ever had one, and it is
// made in the Studio browser by reading the pixels into a canvas — which is
// why choosing an existing photograph as a cover needed the bytes proxied back
// through the API, since the bucket serves no cross-origin header. Doing it
// here instead removes that detour and, unlike a canvas in a tab, can be run
// over the whole library unattended.
//
// ── The sizes ───────────────────────────────────────────────────────
//
// 480 across for a thumbnail: twice the widest a grid tile is drawn, so it
// still looks right on a dense phone screen, and a fraction of the bytes.
//
// 64 across for the blur, then blurred again on top. Small enough to be
// worthless as content and large enough to tell a standing shot from a seated
// one — which matters, because choosing photographs from a grid of 24-pixel
// smears would be shuffling with extra steps rather than choosing.

// sharp is loaded defensively, and the whole server depends on that.
//
// This module is required by routes/studio.js, which is required by server.js,
// so a bare require('sharp') that fails takes the entire API down at boot —
// every page, every payment, every call — because a thumbnail library is
// missing. That is exactly what happened the first time this deployed.
//
// It is a native module, which makes it the most likely dependency in the
// project to fail: a missing install, a platform mismatch between a Mac and a
// Linux container, a binary that did not download. None of those are reasons
// for the gallery to go dark.
//
// So: if sharp is not here, the module still loads, the server still boots,
// and photographs are served at full size exactly as they were before any of
// this existed. Thumbnails simply start appearing once it is installed.
let sharp = null;
let sharpUnavailable = null;
try {
  sharp = require('sharp');
} catch (err) {
  sharpUnavailable = err.message;
  console.warn(
    'imagederive: sharp is not available, so no thumbnails or blurs will be made. ' +
    'Photographs will be served at full size, as before. Run `npm install sharp` in backend/ to enable them. ' +
    `(${err.message})`
  );
}

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../db/pool');

const THUMB_WIDTH   = 480;
const THUMB_QUALITY = 72;
const BLUR_WIDTH    = 64;
const BLUR_SIGMA    = 3;
const BLUR_QUALITY  = 40;

// Beyond this a file is almost certainly not a photograph we should be
// decoding. sharp will happily try, and a malformed one can cost a lot of
// memory before it fails.
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// The column holds a bare key on some rows and a whole URL on others, which is
// why the platform's own helper starts by asking. R2 wants the key alone.
function keyOf(stored) {
  if (!stored) return null;
  return stored.startsWith('http')
    ? new URL(stored).pathname.replace(/^\//, '')
    : stored;
}

// Derivatives live under their own prefixes rather than beside the original.
// One prefix is one thing to purge, one thing to set a cache rule on, and one
// thing to exclude when anything walks the bucket looking for orphans.
const thumbKeyFor = (key) => `thumb/${key}`;
const blurKeyFor  = (key) => `blur/${key}`;

async function getBytes(key) {
  const obj = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }));
  const chunks = [];
  for await (const c of obj.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

async function put(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: 'image/jpeg',
    // These are derived from something immutable, so they can be cached hard.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

// Both sizes from one decode of one download.
//
// rotate() with no argument applies whatever the EXIF orientation says and
// then drops the tag. Without it, every photograph taken on a phone held
// sideways comes out of here rotated, because the resize throws the tag away
// and the browser has nothing left to correct by.
async function derivationsFrom(bytes) {
  if (!sharp) throw new Error(`sharp is not installed (${sharpUnavailable})`);
  const base = sharp(bytes, { failOn: 'none' }).rotate();

  const [thumb, blur] = await Promise.all([
    base.clone()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer(),
    base.clone()
      .resize({ width: BLUR_WIDTH })
      .blur(BLUR_SIGMA)
      .jpeg({ quality: BLUR_QUALITY })
      .toBuffer(),
  ]);

  return { thumb, blur };
}

// One item, start to finish.
//
// Returns null rather than throwing for anything that simply has no
// derivatives to make — a video, a row with no key — so a caller looping over
// a library can treat "nothing to do" and "done" the same way.
async function deriveItem(itemId, r2Key, mediaType) {
  if (mediaType === 'video') return null;
  // Nothing to do rather than something to fail at. The caller — an upload, or
  // the backfill — carries on, and the row keeps no thumbnail, which every
  // reader already falls back from.
  if (!sharp) return null;

  const key = keyOf(r2Key);
  if (!key) return null;

  const bytes = await getBytes(key);
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new Error(`source is ${Math.round(bytes.length / 1024 / 1024)}MB, over the limit`);
  }

  const { thumb, blur } = await derivationsFrom(bytes);
  const tKey = thumbKeyFor(key);
  const bKey = blurKeyFor(key);

  await Promise.all([put(tKey, thumb), put(bKey, blur)]);

  await pool.query(
    `UPDATE set_items SET thumb_key = $1, blur_key = $2 WHERE id = $3`,
    [tKey, bKey, itemId]
  );

  return {
    thumbKey: tKey,
    blurKey:  bKey,
    sourceBytes: bytes.length,
    thumbBytes:  thumb.length,
    blurBytes:   blur.length,
  };
}

// Started, not awaited.
//
// The same rule the moderation scan is written to: an upload must never fail,
// wait, or cost anything because a derived step was slow or unreachable. A
// photograph with no thumbnail yet is served at full size, exactly as every
// photograph was before this existed — so a failure here degrades to the old
// behaviour rather than to a broken tile.
function deriveInBackground(itemId, r2Key, mediaType) {
  if (!sharp) return;
  setImmediate(() => {
    deriveItem(itemId, r2Key, mediaType).catch((err) => {
      console.error(`thumbnail derivation failed for ${itemId}:`, err.message);
    });
  });
}

module.exports = {
  THUMB_WIDTH,
  BLUR_WIDTH,
  keyOf,
  thumbKeyFor,
  blurKeyFor,
  derivationsFrom,
  deriveItem,
  deriveInBackground,
};