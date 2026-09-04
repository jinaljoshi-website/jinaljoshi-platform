// backend/lib/notices.js
//
// Everything the platform has told somebody, kept where they can find it again.
//
// ── Writing a notice is not sending anything ────────────────────────
//
// This only writes a row. It rings no phone, sends no email, and makes no
// sound. That separation is the whole design: a notice is the record, and
// delivery is a separate decision made by whoever is doing the telling.
//
//   notice()      writes the record. Nothing leaves the building.
//   pushToUser()  rings a phone, and records that it did.
//   sendOptional() sends an email, and records that it did.
//
// So a welcome letter appears in the section without buzzing anybody at two in
// the morning, and a push about a call in ten minutes still buzzes, because
// that is what a push is for.
//
// ── Why the record exists at all ────────────────────────────────────
//
// A push notification arrived on a phone or it did not, and either way it was
// gone. Somebody who missed it, or never granted permission, or read it on a
// bus and wanted it again, had nowhere to look. And once emails can be turned
// off, a person who turns them off should lose the delivery rather than the
// message.

const pool = require('../db/pool');

// Write a notice. Delivers nothing.
//
// Its failure is swallowed and logged. This is a record of something that has
// already happened, and it must never be the reason the thing itself fails —
// a payment that goes through and then errors because a notice could not be
// filed is a worse outcome than a missing notice.
async function notice(userId, { kind = 'notice', title, body, url, delivered = null }) {
  if (!userId || !title) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO notices (user_id, kind, title, body, url, delivered)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, kind, title, body || null, url || null, delivered]
    );
    return rows[0].id;
  } catch (err) {
    console.error('notice write failed:', err.message);
    return null;
  }
}

module.exports = { notice };