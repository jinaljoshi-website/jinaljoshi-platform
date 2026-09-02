// backend/lib/moderation-scan.js
//
// A second opinion on a photograph, for the person who is going to look at it
// anyway.
//
// ── What this is, and is not ────────────────────────────────────────
//
// It is not a gate. Nothing is blocked, hidden or refused on the strength of a
// score, and that is deliberate rather than cautious: tested against this
// library, the classifier calls roughly one photograph in twenty explicit when
// it is not. A mesh top over a cover reads to it as exposure. Used as a gate it
// would refuse hundreds of perfectly ordinary fashion photographs and teach
// everybody to switch it off.
//
// What it is good at is noticing. Every set is reviewed by hand before it
// publishes, and in two hundred photographs the two worth a second look are not
// always the two that catch the eye. This puts them at the top.
//
// So the false positives cost nothing. She was going to look at all of them.
// This only changes the order, and the one genuine wardrobe malfunction in a
// shoot is the thing it exists to catch.
//
// ── Never in the way ────────────────────────────────────────────────
//
// Scoring happens after the upload has been recorded, is not awaited, and
// swallows its own failures. An upload must never fail, wait, or cost anything
// because a moderation service was slow or unreachable.

const { RekognitionClient, DetectModerationLabelsCommand } =
  require('@aws-sdk/client-rekognition');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../db/pool');

const configured = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const rekognition = configured
  ? new RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' })
  : null;

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

// Where a score stops being worth mentioning.
//
// Below sixty the model is guessing by Amazon's own account, and a badge on
// every third photograph is a badge nobody reads.
const WORTH_MENTIONING = 60;

async function scanItem(itemId, r2Key, mediaType) {
  if (!configured || mediaType === 'video') return null;

  try {
    const key = keyOf(r2Key);
    if (!key) return null;

    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
    const chunks = [];
    for await (const c of obj.Body) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    if (bytes.length > 5 * 1024 * 1024) return null;   // Rekognition's inline limit

    const out = await rekognition.send(new DetectModerationLabelsCommand({
      Image: { Bytes: bytes },
      MinConfidence: WORTH_MENTIONING,
    }));

    const labels = (out.ModerationLabels || []).map((l) => ({
      name: l.Name,
      parent: l.ParentName || null,
      confidence: Math.round(l.Confidence),
    }));

    // The one number a badge can show. Explicit is what matters; everything
    // else is the classifier correctly noticing that somebody is wearing
    // swimwear, which is not news.
    const explicit = labels.filter((l) =>
      l.name === 'Explicit' || l.parent === 'Explicit' ||
      ['Explicit Nudity', 'Explicit Sexual Activity'].includes(l.name));
    const score = explicit.length ? Math.max(...explicit.map((l) => l.confidence)) : 0;

    const result = { score, labels, at: new Date().toISOString() };

    await pool.query(
      `UPDATE set_items SET moderation = $1::jsonb WHERE id = $2`,
      [JSON.stringify(result), itemId]
    );

    return result;
  } catch (err) {
    // Logged and dropped. A photograph with no score simply has no badge, which
    // is the same as every photograph before this existed.
    console.error(`moderation scan failed for ${itemId}:`, err.message);
    return null;
  }
}

// Started, not awaited.
//
// The caller has already told the browser its upload succeeded. This runs
// afterwards and its outcome reaches the screen the next time the set is
// opened, which is when anybody would look.
function scanInBackground(itemId, r2Key, mediaType) {
  if (!configured) return;
  setImmediate(() => { scanItem(itemId, r2Key, mediaType).catch(() => {}); });
}

module.exports = { scanItem, scanInBackground, configured, WORTH_MENTIONING };