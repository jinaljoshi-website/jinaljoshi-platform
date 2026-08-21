// backend/routes/upload.js
// Handles R2 presigned uploads for backgrounds and chat media

const router     = require('express').Router();
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 }   = require('uuid');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const pool       = require('../db/pool');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

// Allowed mime types
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_ALL   = [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];

// ─────────────────────────────────────────────
// POST /api/upload/presign
// Get a presigned URL to upload a file directly to R2
// Body: { filename, contentType, context }
// context: 'background' | 'chat_media' | 'merch_image' | 'content'
// Returns: { uploadUrl, key, publicUrl }
// ─────────────────────────────────────────────

router.post('/presign', authMid, require('../middleware/rateLimit').presign, async (req, res) => {
  const { filename, contentType, context = 'chat_media' } = req.body;

  if (!filename || !contentType) {
    return res.status(400).json({ error: 'filename and contentType are required' });
  }

  // Validate content type based on context
  const allowedTypes = context === 'background' || context === 'merch_image'
    ? ALLOWED_IMAGE
    : ALLOWED_ALL;

  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ error: `File type ${contentType} not allowed for ${context}` });
  }

  // Artist-only for backgrounds and merch
  if (['background', 'merch_image', 'content'].includes(context) && !req.user.isArtist) {
    return res.status(403).json({ error: 'Only the artist can upload this type' });
  }

  const ext      = filename.split('.').pop();
  const key      = `${context}/${uuidv4()}.${ext}`;
  const command  = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    ContentType: contentType,
  });

  try {
    const uploadUrl  = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
    const publicUrl  = `${process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT.replace('https://', 'https://pub-')}/${key}`;

    res.json({ uploadUrl, key, publicUrl });
  } catch (err) {
    console.error('presign error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// ─────────────────────────────────────────────
// POST /api/upload/confirm-background  [ARTIST ONLY]
// After uploading, save the background URL to config or fan_settings
// Body: { key, publicUrl, type, fanId? }
// type: 'community' | 'personal' | 'fan'
// ─────────────────────────────────────────────

router.post('/confirm-background', authMid, artistOnly, async (req, res) => {
  const { publicUrl, type, fanId } = req.body;

  if (!publicUrl || !type) {
    return res.status(400).json({ error: 'publicUrl and type are required' });
  }

  try {
    if (type === 'fan' && fanId) {
      await pool.query(
        `INSERT INTO fan_settings (user_id, personal_chat_bg)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET personal_chat_bg = $2, updated_at = NOW()`,
        [fanId, publicUrl]
      );
    } else {
      const configKey = type === 'community' ? 'community_chat_bg' : 'personal_chat_bg';
      await pool.query(
        `INSERT INTO platform_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [configKey, publicUrl]
      );
    }
    res.json({ ok: true, publicUrl });
  } catch (err) {
    console.error('confirm-background error:', err);
    res.status(500).json({ error: 'Failed to save background' });
  }
});

// ─────────────────────────────────────────────
// POST /api/upload/confirm-merch  [ARTIST ONLY]
// Save merch image URL to a merchandise item
// Body: { publicUrl, merchId }
// ─────────────────────────────────────────────

router.post('/confirm-merch', authMid, artistOnly, async (req, res) => {
  const { publicUrl, merchId } = req.body;
  if (!publicUrl || !merchId) return res.status(400).json({ error: 'publicUrl and merchId are required' });
  try {
    await pool.query(`UPDATE merchandise SET img_key = $1 WHERE id = $2`, [publicUrl, merchId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save merch image' });
  }
});

module.exports = router;