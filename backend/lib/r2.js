// backend/lib/r2.js
// Removing objects from storage, and finding ones nothing points at any more.

const {
  S3Client, DeleteObjectsCommand, ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const pool = require('../db/pool');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

// Stored values are full URLs, so strip the origin to get the object key.
// Anything already key-shaped is returned untouched.
function keyFromUrl(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return v.replace(/^\/+/, '');
  try {
    return decodeURIComponent(new URL(v).pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
}

// Best effort by design. This is always called AFTER the database row is gone,
// so a failure here leaves an unreferenced file — untidy but harmless — whereas
// deleting storage first and then failing to delete the row would leave a broken
// image a fan can see. The orphan sweep exists to mop up exactly these.
async function deleteObjects(values) {
  const keys = [...new Set((values || []).map(keyFromUrl).filter(Boolean))];
  if (!keys.length) return { deleted: 0, failed: 0 };

  let deleted = 0, failed = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    try {
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }));
      failed  += (res.Errors || []).length;
      deleted += chunk.length - (res.Errors || []).length;
    } catch (err) {
      console.error('r2/deleteObjects failed for a chunk:', err.message);
      failed += chunk.length;
    }
  }
  return { deleted, failed };
}

async function listAllObjects() {
  const out = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000,
    }));
    (res.Contents || []).forEach((o) => out.push({ key: o.Key, size: o.Size, modified: o.LastModified }));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// Every column anywhere that can point at a stored file. Getting this list wrong
// in the other direction would delete something still in use, so it is written
// out in full rather than inferred, and a query that fails aborts the whole scan
// rather than quietly leaving those references out.
const REFERENCE_QUERIES = [
  `SELECT img_key AS v FROM merchandise WHERE img_key IS NOT NULL`,
  `SELECT url AS v FROM merchandise_images`,
  `SELECT r2_key AS v FROM set_items`,
  `SELECT cover_key AS v FROM sets WHERE cover_key IS NOT NULL`,
  `SELECT media_url AS v FROM direct_messages WHERE media_url IS NOT NULL`,
  `SELECT jsonb_array_elements(locked_media_urls::jsonb) ->> 'url' AS v
     FROM direct_messages WHERE locked_media_urls IS NOT NULL`,
  `SELECT personal_chat_bg AS v FROM fan_settings WHERE personal_chat_bg IS NOT NULL`,
  `SELECT value AS v FROM platform_config WHERE value LIKE 'http%'`,
  `SELECT image_key AS v FROM portfolio_hero_slides WHERE image_key IS NOT NULL`,
  `SELECT image_key AS v FROM portfolio_works WHERE image_key IS NOT NULL`,
];

async function collectReferencedKeys() {
  const referenced = new Set();
  for (const q of REFERENCE_QUERIES) {
    const { rows } = await pool.query(q);
    rows.forEach((r) => { const k = keyFromUrl(r.v); if (k) referenced.add(k); });
  }
  return referenced;
}

// Objects in the bucket that nothing in the database points at.
//
// Files uploaded in the last day are skipped: a set is created by uploading
// files first and writing rows as each lands, so a file mid-upload is briefly
// unreferenced and would otherwise be deleted out from under an active upload.
async function findOrphans({ minAgeHours = 24 } = {}) {
  const [objects, referenced] = await Promise.all([listAllObjects(), collectReferencedKeys()]);
  const cutoff = Date.now() - minAgeHours * 3600 * 1000;

  const orphans = objects.filter((o) =>
    !referenced.has(o.key) && new Date(o.modified).getTime() < cutoff
  );
  const recentSkipped = objects.filter((o) =>
    !referenced.has(o.key) && new Date(o.modified).getTime() >= cutoff
  ).length;

  return {
    totalObjects:  objects.length,
    referenced:    referenced.size,
    orphans:       orphans.map((o) => ({ key: o.key, sizeMB: +(o.size / 1048576).toFixed(2), modified: o.modified })),
    orphanBytes:   orphans.reduce((s, o) => s + o.size, 0),
    recentSkipped,
  };
}

module.exports = { deleteObjects, findOrphans, keyFromUrl, listAllObjects };