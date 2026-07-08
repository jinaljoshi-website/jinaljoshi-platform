// backend/lib/invoiceNumber.js
// Generates invoice numbers in the format YYMMDD-00000, atomically, resetting daily.

const pool = require('../db/pool');

function todayKey() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Must be called within an existing transaction (client), since it uses row locking
// to guarantee no two concurrent purchases ever get the same invoice number.
async function getNextInvoiceNumber(client) {
  const dayKey = todayKey();

  await client.query(
    `INSERT INTO invoice_counters (day_key, last_number)
     VALUES ($1, 0)
     ON CONFLICT (day_key) DO NOTHING`,
    [dayKey]
  );

  const { rows } = await client.query(
    `UPDATE invoice_counters SET last_number = last_number + 1
     WHERE day_key = $1
     RETURNING last_number`,
    [dayKey]
  );

  const seq = rows[0].last_number;
  const paddedSeq = String(seq).padStart(5, '0');
  return `PS/${dayKey}-${paddedSeq}`;
}

module.exports = { getNextInvoiceNumber, todayKey };