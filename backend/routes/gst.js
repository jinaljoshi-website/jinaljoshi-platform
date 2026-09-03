// backend/routes/gst.js
//
// What has to go on a return, arranged the way a return asks for it.
//
// Everything here was already recorded on each invoice — taxable value, the
// CGST and SGST split, IGST for interstate, place of supply, the SAC code, and
// whether it was an export. It has simply never been added up.
//
// ── Why the shape is what it is ─────────────────────────────────────
//
// GSTR-1 wants supplies grouped by where they went and at what rate, and every
// sale here is B2C: an individual buying tokens, no counterparty GSTIN. Below
// the state-wise threshold that means B2CS — a single summary row per state per
// rate rather than an invoice-by-invoice listing.
//
// Exports are separate. A member paying from abroad is a zero-rated export of
// services, which sits in its own table and must not be mixed into the domestic
// figures.
//
// ── What it is not ──────────────────────────────────────────────────
//
// It is not a return, and not advice about one. It is the arithmetic done from
// the invoices, so that whoever files can check it against their own workings
// rather than re-adding fifty invoices by hand.

const router  = require('express').Router();
const pool    = require('../db/pool');

// A month, as GST reckons them: the first to the last, in Indian time.
//
// Stored timestamps are UTC, and a sale at half past eleven on the last night
// of March belongs to March. Without the offset it would land in April and the
// two months would each be wrong by one invoice.
function monthBounds(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1, -5, -30));
  const to   = new Date(Date.UTC(year, month,     1, -5, -30));
  return { from, to };
}

// ─────────────────────────────────────────────
// GET /api/studio/gst/summary?year=2026
// ─────────────────────────────────────────────
//
// Every month of a year at once, for seeing the shape of it.
router.get('/summary', async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  try {
    const { rows } = await pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
              count(*)::int                                  AS invoices,
              COALESCE(SUM(taxable_amount_inr), 0)           AS taxable,
              COALESCE(SUM(cgst_amount_inr), 0)              AS cgst,
              COALESCE(SUM(sgst_amount_inr), 0)              AS sgst,
              COALESCE(SUM(igst_amount_inr), 0)              AS igst,
              COALESCE(SUM(gst_amount_inr), 0)               AS gst,
              COALESCE(SUM(amount_inr_equivalent), 0)        AS gross,
              count(*) FILTER (WHERE is_export)::int         AS exports,
              COALESCE(SUM(amount_inr_equivalent) FILTER (WHERE is_export), 0) AS export_value
         FROM invoices
        WHERE EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Kolkata') = $1
        GROUP BY 1 ORDER BY 1`,
      [year]
    );
    res.json({ year, months: rows });
  } catch (err) {
    console.error('gst/summary error:', err);
    res.status(500).json({ error: 'Could not total the year' });
  }
});

// ─────────────────────────────────────────────
// GET /api/studio/gst/month?year=2026&month=8
// ─────────────────────────────────────────────
//
// One month, broken out the way the return asks.
router.get('/month', async (req, res) => {
  const year  = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Give a year and a month' });
  }

  const { from, to } = monthBounds(year, month);

  try {
    // B2CS: domestic supplies, one row per state per rate.
    //
    // Grouped rather than listed because every sale here is to an individual
    // with no GSTIN, and below the threshold those are reported as a summary.
    const { rows: b2cs } = await pool.query(
      `SELECT COALESCE(place_of_supply, 'Unknown') AS place_of_supply,
              gst_rate_pct,
              count(*)::int                          AS invoices,
              COALESCE(SUM(taxable_amount_inr), 0)   AS taxable,
              COALESCE(SUM(cgst_amount_inr), 0)      AS cgst,
              COALESCE(SUM(sgst_amount_inr), 0)      AS sgst,
              COALESCE(SUM(igst_amount_inr), 0)      AS igst,
              COALESCE(SUM(amount_inr_equivalent), 0) AS gross
         FROM invoices
        WHERE created_at >= $1 AND created_at < $2
          AND is_export = FALSE
        GROUP BY 1, 2
        ORDER BY taxable DESC`,
      [from, to]
    );

    // Exports, which are zero-rated and belong in their own table.
    const { rows: exports } = await pool.query(
      `SELECT COALESCE(user_country, 'Unknown')      AS country,
              currency,
              count(*)::int                          AS invoices,
              COALESCE(SUM(amount_in_currency), 0)   AS in_currency,
              COALESCE(SUM(amount_inr_equivalent), 0) AS inr,
              COALESCE(SUM(gst_amount_inr), 0)       AS gst_charged,
              bool_or(export_with_tax)               AS any_with_tax
         FROM invoices
        WHERE created_at >= $1 AND created_at < $2
          AND is_export = TRUE
        GROUP BY 1, 2
        ORDER BY inr DESC`,
      [from, to]
    );

    // Refunds and credits, which reduce what is owed and are the thing most
    // easily forgotten when totalling by hand.
    const { rows: credits } = await pool.query(
      `SELECT count(*)::int AS n,
              COALESCE(SUM(ABS(payment_amount_inr)), 0) AS amount
         FROM coin_ledger
        WHERE created_at >= $1 AND created_at < $2
          AND type IN ('refund', 'request_refund', 'call_refund')
          AND payment_amount_inr IS NOT NULL`,
      [from, to]
    ).catch(() => ({ rows: [{ n: 0, amount: 0 }] }));

    const { rows: totals } = await pool.query(
      `SELECT count(*)::int                          AS invoices,
              COALESCE(SUM(taxable_amount_inr), 0)   AS taxable,
              COALESCE(SUM(cgst_amount_inr), 0)      AS cgst,
              COALESCE(SUM(sgst_amount_inr), 0)      AS sgst,
              COALESCE(SUM(igst_amount_inr), 0)      AS igst,
              COALESCE(SUM(gst_amount_inr), 0)       AS gst,
              COALESCE(SUM(amount_inr_equivalent), 0) AS gross,
              min(invoice_number)                    AS first_invoice,
              max(invoice_number)                    AS last_invoice
         FROM invoices
        WHERE created_at >= $1 AND created_at < $2`,
      [from, to]
    );

    res.json({
      period: { year, month, from, to },
      totals: totals[0],
      b2cs,
      exports,
      credits: credits[0],
      sac: process.env.TOKEN_SAC_CODE || '999599',
    });
  } catch (err) {
    console.error('gst/month error:', err);
    res.status(500).json({ error: 'Could not break down that month' });
  }
});

// ─────────────────────────────────────────────
// GET /api/studio/gst/invoices.csv?year=2026&month=8
// ─────────────────────────────────────────────
//
// Every invoice of a month, one per line.
//
// The summaries above are what goes on the return; this is what an accountant
// asks for when a number does not look right, and what an auditor asks for
// three years later.
router.get('/invoices.csv', async (req, res) => {
  const year  = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) return res.status(400).json({ error: 'Give a year and a month' });

  const { from, to } = monthBounds(year, month);

  try {
    const { rows } = await pool.query(
      `SELECT invoice_number, created_at AT TIME ZONE 'Asia/Kolkata' AS issued_at,
              user_email, user_country, place_of_supply, is_export,
              currency, amount_in_currency, exchange_rate_used,
              amount_inr_equivalent, taxable_amount_inr, gst_rate_pct,
              cgst_amount_inr, sgst_amount_inr, igst_amount_inr, gst_amount_inr,
              sac_code, tokens_purchased, payment_method_display
         FROM invoices
        WHERE created_at >= $1 AND created_at < $2
        ORDER BY invoice_number`,
      [from, to]
    );

    const cols = ['invoice_number','issued_at','user_email','user_country','place_of_supply',
                  'is_export','currency','amount_in_currency','exchange_rate_used',
                  'amount_inr_equivalent','taxable_amount_inr','gst_rate_pct',
                  'cgst_amount_inr','sgst_amount_inr','igst_amount_inr','gst_amount_inr',
                  'sac_code','tokens_purchased','payment_method_display'];

    // Quoted properly, because a display name with a comma in it would
    // otherwise shift every column after it and nobody would notice until the
    // totals disagreed.
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const str = v instanceof Date ? v.toISOString() : String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const csv = [cols.join(',')]
      .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="gst-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('gst/csv error:', err);
    res.status(500).json({ error: 'Could not build the file' });
  }
});

module.exports = router;