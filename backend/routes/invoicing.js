// backend/routes/invoicing.js
// Studio invoicing: payment accounts, manual receipts, B2B service invoices,
// and a filing view over the automatic platform invoices.
const router     = require('express').Router();
const pool       = require('../db/pool');
const authMid    = require('../middleware/auth');
const artistOnly = require('../middleware/artistOnly');
const { getNextNumber, computeTax, generatePdf, getSupplier } = require('../lib/issuedInvoice');

router.use(authMid, artistOnly);

// ─────────────────────────────────────────────
// PAYMENT ACCOUNTS
// ─────────────────────────────────────────────

router.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, currency, is_domestic, is_default, details_text, active
       FROM payment_accounts WHERE active = TRUE ORDER BY sort_order ASC, label ASC`
    );
    res.json({ accounts: rows });
  } catch (err) {
    console.error('invoicing/accounts error:', err);
    res.status(500).json({ error: 'Failed to load payment accounts' });
  }
});

// ─────────────────────────────────────────────
// ISSUED INVOICES — manual receipts and B2B
// ─────────────────────────────────────────────

router.get('/issued', async (req, res) => {
  const { kind, year } = req.query;
  try {
    const clauses = [];
    const params  = [];
    if (kind) { params.push(kind); clauses.push(`i.kind = $${params.length}`); }
    if (year) { params.push(year); clauses.push(`date_part('year', i.invoice_date) = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT i.*, a.label AS account_label
       FROM issued_invoices i
       LEFT JOIN payment_accounts a ON a.id = i.payment_account_id
       ${where}
       ORDER BY i.invoice_date DESC, i.invoice_number DESC`,
      params
    );

    const totals = rows.reduce((t, r) => ({
      taxable: t.taxable + Number(r.taxable_amount),
      tax:     t.tax     + Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount),
      total:   t.total   + Number(r.total_amount),
      unpaid:  t.unpaid  + (r.paid_at ? 0 : Number(r.total_amount)),
    }), { taxable: 0, tax: 0, total: 0, unpaid: 0 });

    res.json({ invoices: rows, totals });
  } catch (err) {
    console.error('invoicing/issued error:', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

router.post('/issued', async (req, res) => {
  const {
    kind, invoiceDate, recipientName, recipientEmail, recipientAddress,
    recipientGstin, recipientState, recipientCountry, placeOfSupply,
    reverseCharge, lineItems, currency, gstRatePct, isExport,
    paymentAccountId, notes,
  } = req.body;

  if (!['manual', 'b2b'].includes(kind))  return res.status(400).json({ error: 'Invalid invoice kind' });
  if (!recipientName?.trim())             return res.status(400).json({ error: 'Recipient name is required' });
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }
  // A B2B tax invoice without the buyer's GSTIN and place of supply is not a
  // valid document — better refused here than discovered by a CA in nine months.
  if (kind === 'b2b') {
    const domestic = (recipientCountry || 'India').trim().toLowerCase() === 'india';
    if (domestic && !recipientGstin?.trim()) {
      return res.status(400).json({ error: 'A domestic B2B invoice needs the recipient GSTIN' });
    }
    if (domestic && !placeOfSupply?.trim()) {
      return res.status(400).json({ error: 'Place of supply is required' });
    }
  }

  const clean = lineItems
    .filter((li) => li.description?.trim())
    .map((li) => {
      const qty  = parseFloat(li.quantity) || 1;
      const rate = parseFloat(li.rate) || 0;
      return {
        description: li.description.trim(),
        sac:         li.sac?.trim() || null,
        quantity:    qty,
        rate,
        amount:      Math.round(qty * rate * 100) / 100,
      };
    });
  if (!clean.length) return res.status(400).json({ error: 'Every line item needs a description' });

  let supplier;
  try {
    supplier = await getSupplier();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const tax = computeTax({
    lineItems:        clean,
    recipientCountry: recipientCountry || 'India',
    placeOfSupply,
    gstRatePct:       gstRatePct ?? 18,
    isExportOverride: isExport,
    supplierState:    supplier.state,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceNumber = await getNextNumber(client, kind);

    const { rows } = await client.query(
      `INSERT INTO issued_invoices (
         kind, invoice_number, invoice_date,
         recipient_name, recipient_email, recipient_address, recipient_gstin,
         recipient_state, recipient_country, place_of_supply, reverse_charge,
         line_items, currency, taxable_amount, cgst_amount, sgst_amount, igst_amount,
         gst_rate_pct, total_amount, is_export, payment_account_id, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        kind, invoiceNumber, invoiceDate || new Date(),
        recipientName.trim(), recipientEmail?.trim() || null, recipientAddress?.trim() || null,
        recipientGstin?.trim() || null, recipientState?.trim() || null,
        (recipientCountry || 'India').trim(), placeOfSupply?.trim() || null, !!reverseCharge,
        JSON.stringify(clean), currency || 'INR',
        tax.taxable, tax.cgst, tax.sgst, tax.igst,
        tax.appliedRate, tax.total, tax.isExport,
        paymentAccountId || null, notes?.trim() || null,
      ]
    );
    await client.query('COMMIT');
    res.json({ ok: true, invoice: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('invoicing/create error:', err);
    res.status(500).json({ error: 'Failed to create the invoice' });
  } finally {
    client.release();
  }
});

router.get('/issued/:id/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM issued_invoices WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = rows[0];

    let account = null;
    if (inv.payment_account_id) {
      const { rows: a } = await pool.query(`SELECT * FROM payment_accounts WHERE id = $1`, [inv.payment_account_id]);
      account = a[0] || null;
    }

    const supplier = await getSupplier();
    const pdf = await generatePdf(inv, account, supplier);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${inv.invoice_number.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('invoicing/pdf error:', err);
    res.status(500).json({ error: 'Failed to generate the PDF' });
  }
});

router.post('/issued/:id/paid', async (req, res) => {
  const { reference, unpay } = req.body;
  try {
    const { rows } = await pool.query(
      unpay
        ? `UPDATE issued_invoices SET paid_at = NULL, payment_reference = NULL WHERE id = $1 RETURNING *`
        : `UPDATE issued_invoices SET paid_at = NOW(), payment_reference = $2 WHERE id = $1 RETURNING *`,
      unpay ? [req.params.id] : [req.params.id, reference?.trim() || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ok: true, invoice: rows[0] });
  } catch (err) {
    console.error('invoicing/paid error:', err);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// ─────────────────────────────────────────────
// PLATFORM INVOICES — the automatic token sales, for filing
// ─────────────────────────────────────────────

router.get('/platform', async (req, res) => {
  const { year } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT invoice_number, user_email, user_country, ip_address, currency,
              amount_in_currency, amount_inr_equivalent, tokens_purchased,
              is_export, gst_rate_pct, gst_amount_inr, taxable_amount_inr,
              cgst_amount_inr, sgst_amount_inr, igst_amount_inr, place_of_supply,
              sac_code, payment_method_display, issued_at
       FROM invoices
       ${year ? `WHERE date_part('year', issued_at) = $1` : ''}
       ORDER BY issued_at DESC`,
      year ? [year] : []
    );

    // Grouped by month, which is how GSTR-1 is filed.
    const months = {};
    for (const r of rows) {
      const d = new Date(r.issued_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[k] ||= {
        month: k,
        label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        count: 0, taxable: 0, gst: 0, total: 0, exportCount: 0, exportValue: 0,
      };
      const M = months[k];
      M.count   += 1;
      M.taxable += Number(r.taxable_amount_inr);
      M.gst     += Number(r.gst_amount_inr);
      M.total   += Number(r.amount_inr_equivalent);
      if (r.is_export) { M.exportCount += 1; M.exportValue += Number(r.amount_inr_equivalent); }
    }

    const round = (n) => Math.round(n * 100) / 100;
    res.json({
      invoices: rows,
      months: Object.values(months)
        .map((m) => ({ ...m, taxable: round(m.taxable), gst: round(m.gst), total: round(m.total), exportValue: round(m.exportValue) }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      supplier: await getSupplier().catch(() => null),
    });
  } catch (err) {
    console.error('invoicing/platform error:', err);
    res.status(500).json({ error: 'Failed to load platform invoices' });
  }
});

module.exports = router;