// backend/lib/invoiceNumber.js
// Generates invoice numbers in the format YYMMDD-00000, atomically, resetting daily.

const pool = require('../db/pool');

// The date in India, whatever the server thinks the time is.
//
// This read the server's own clock, and the server runs UTC — so every sale
// between midnight and 5:30am IST was numbered with the previous day's date.
// Thirty-two of the first hundred and nine invoices are dated that way. None of
// them happened to cross a month boundary, so nothing filed has been wrong yet;
// the first sale in that window on the 1st of a month would be numbered into
// one month and filed in another.
//
// Computed from the offset rather than left to a TZ environment variable, so
// the number is right whether or not anybody remembers to set one, and the same
// on a laptop as on the deployed service.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function todayKey(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// April to March, in India. The financial year an invoice belongs to.
function financialYearStart(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  return ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
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

module.exports = { getNextInvoiceNumber, todayKey, financialYearStart, IST_OFFSET_MS };