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
      `SELECT i.*, a.label AS account_label,
              -- What actually arrived, in rupees.
              --
              -- A foreign invoice has no rupee value until the money lands: the
              -- rate is whatever the bank realised at, and the e-FIRC says what
              -- that was. So this is the sum of the receipts rather than a
              -- conversion done at invoice time, which would be a number the
              -- money never agreed with.
              (SELECT COALESCE(SUM(r.amount_credited_inr), 0)
                 FROM invoice_receipts r WHERE r.invoice_id = i.id)  AS realised_inr,
              (SELECT count(*)::int
                 FROM invoice_receipts r WHERE r.invoice_id = i.id)  AS receipt_count
       FROM issued_invoices i
       LEFT JOIN payment_accounts a ON a.id = i.payment_account_id
       ${where}
       ORDER BY i.invoice_date DESC, i.invoice_number DESC`,
      params
    );

    // Received is the sum of what was actually sent, at the certified rate.
    // A flag could only say paid or not; an invoice half paid is neither.
    const { rows: recv } = await pool.query(
      `SELECT invoice_id,
              COALESCE(SUM(amount_in_currency * COALESCE(exchange_rate, 1)), 0) AS gross,
              COALESCE(SUM(amount_credited_inr), 0) AS credited,
              count(*)::int AS n
       FROM invoice_receipts GROUP BY invoice_id`
    );
    const byInvoice = {};
    recv.forEach((r) => { byInvoice[r.invoice_id] = r; });

    const withReceipts = rows.map((r) => {
      const g = byInvoice[r.id];
      const received = g ? Math.round(Number(g.gross) * 100) / 100 : 0;
      return {
        ...r,
        receivedGross: received,
        receivedCredited: g ? Math.round(Number(g.credited) * 100) / 100 : 0,
        receiptCount: g ? g.n : 0,
        outstanding: Math.max(0, Math.round((Number(r.total_amount) - received) * 100) / 100),
      };
    });

    const totals = withReceipts.reduce((t, r) => ({
      taxable: t.taxable + Number(r.taxable_amount),
      tax:     t.tax     + Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount),
      total:   t.total   + Number(r.total_amount),
      received: t.received + r.receivedGross,
      unpaid:  t.unpaid  + (r.settled_at ? 0 : r.outstanding),
    }), { taxable: 0, tax: 0, total: 0, received: 0, unpaid: 0 });

    res.json({ invoices: withReceipts, totals });
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

    // No rate here, and deliberately none.
    //
    // A foreign invoice is worth whatever the bank realises it at, on the day
    // it lands, and that is not known when the invoice is written. The e-FIRC
    // says what it was. Guessing a rate at creation would put a number on the
    // invoice that the money never agreed with, and the return would be
    // reckoned on a figure nobody could evidence.
    //
    // So a rupee invoice is its own equivalent and a foreign one has none until
    // it is paid. The receipt carries the rate, and the rupee value of this
    // invoice is the sum of what actually arrived against it.
    const cur  = (currency || 'INR').trim().toUpperCase();
    const rate = cur === 'INR' ? 1 : null;
    const inr  = (n) => (rate === null ? null : Math.round(Number(n || 0) * rate * 100) / 100);
    const fx = {
      rate,
      taxable: inr(tax.taxable), total: inr(tax.total),
      cgst: inr(tax.cgst), sgst: inr(tax.sgst), igst: inr(tax.igst),
    };

    const { rows } = await client.query(
      `INSERT INTO issued_invoices (
         kind, invoice_number, invoice_date,
         recipient_name, recipient_email, recipient_address, recipient_gstin,
         recipient_state, recipient_country, place_of_supply, reverse_charge,
         line_items, currency, taxable_amount, cgst_amount, sgst_amount, igst_amount,
         gst_rate_pct, total_amount, is_export, payment_account_id, notes,
         exchange_rate, taxable_inr, total_inr, cgst_inr, sgst_inr, igst_inr
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                 $23,$24,$25,$26,$27,$28)
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
        fx.rate, fx.taxable, fx.total, fx.cgst, fx.sgst, fx.igst,
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
// RECEIPTS AGAINST AN INVOICE
// ─────────────────────────────────────────────

// What has actually been received, and what the transfer cost.
//
// Gross is what the payer sent, valued at the certified rate. Credited is what
// the bank paid in. The difference is charges -- derived rather than guessed,
// and claimable as an expense.
async function receiptsFor(invoiceId) {
  const { rows } = await pool.query(
    `SELECT * FROM invoice_receipts WHERE invoice_id = $1 ORDER BY received_on ASC, created_at ASC`,
    [invoiceId]
  );
  const totals = rows.reduce((t, r) => {
    const rate   = Number(r.exchange_rate) || 1;
    const gross  = Number(r.amount_in_currency) * rate;
    const credit = Number(r.amount_credited_inr);
    return {
      gross:    t.gross + gross,
      credited: t.credited + credit,
      charges:  t.charges + Math.max(0, gross - credit),
    };
  }, { gross: 0, credited: 0, charges: 0 });

  const round = (n) => Math.round(n * 100) / 100;
  return {
    receipts: rows.map((r) => {
      const rate  = Number(r.exchange_rate) || 1;
      const gross = round(Number(r.amount_in_currency) * rate);
      return {
        id: r.id, receiptNumber: r.receipt_number, receivedOn: r.received_on,
        currency: r.currency, amount: Number(r.amount_in_currency),
        exchangeRate: r.exchange_rate ? Number(r.exchange_rate) : null,
        grossInr: gross,
        creditedInr: Number(r.amount_credited_inr),
        chargesInr: round(Math.max(0, gross - Number(r.amount_credited_inr))),
        method: r.method, reference: r.reference,
        efircNumber: r.efirc_number, efircFileKey: r.efirc_file_key,
        note: r.note,
      };
    }),
    totals: { gross: round(totals.gross), credited: round(totals.credited), charges: round(totals.charges) },
  };
}

router.get('/issued/:id/receipts', async (req, res) => {
  try {
    const { rows: inv } = await pool.query(
      `SELECT total_amount, currency, settled_at FROM issued_invoices WHERE id = $1`, [req.params.id]
    );
    if (!inv.length) return res.status(404).json({ error: 'Invoice not found' });

    const data = await receiptsFor(req.params.id);
    const invoiced = Number(inv[0].total_amount);

    // Measured against gross, not what the bank credited. An invoice is settled
    // when the payer has sent what they owe -- what a correspondent bank took on
    // the way is a cost, not an unpaid balance.
    const tolerancePct = 2;
    const outstanding  = Math.max(0, Math.round((invoiced - data.totals.gross) * 100) / 100);
    const withinTolerance = invoiced > 0 && outstanding <= (invoiced * tolerancePct) / 100;

    res.json({
      ...data,
      invoiced,
      currency: inv[0].currency,
      outstanding,
      fullyPaid: data.totals.gross >= invoiced || withinTolerance,
      settledAt: inv[0].settled_at,
    });
  } catch (err) {
    console.error('invoicing/receipts error:', err);
    res.status(500).json({ error: 'Failed to load receipts' });
  }
});

router.post('/issued/:id/receipts', async (req, res) => {
  const { receivedOn, currency, amount, exchangeRate, amountCreditedInr,
          method, reference, efircNumber, efircFileKey, note,
          withheldInCurrency, withholdingNote, withholdingFileKey,
          bankChargesInr } = req.body;

  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'An amount is required' });

  const cur  = (currency || 'INR').trim().toUpperCase();
  const rate = cur === 'INR' ? 1 : parseFloat(exchangeRate);
  if (cur !== 'INR' && (!rate || rate <= 0)) {
    return res.status(400).json({ error: 'A foreign payment needs the rate from the e-FIRC' });
  }

  // Defaults to the gross rather than requiring it twice. For a rupee payment
  // the two are always the same, and for a foreign one this is the figure to
  // correct once the bank statement arrives.
  const credited = amountCreditedInr === undefined || amountCreditedInr === null || amountCreditedInr === ''
    ? Math.round(amt * rate * 100) / 100
    : parseFloat(amountCreditedInr);

  // Tax the payer took off before sending, in the invoice currency.
  //
  // Meta bills two thousand, remits seventeen hundred, and three hundred goes
  // to the IRS. Without this the invoice reads as underpaid rather than paid in
  // full with tax deducted — and the withheld amount is claimable against
  // Indian tax under the treaty, so losing sight of it costs real money.
  const withheld = parseFloat(withheldInCurrency) || 0;

  // What the banks took in transit, which is not the same thing at all.
  //
  // This used to be inferred by subtracting what arrived from what was sent,
  // which quietly swallowed any withholding into it. Taken from the statement
  // when it is given, and inferred only when it is not.
  const charges = (bankChargesInr === undefined || bankChargesInr === null || bankChargesInr === '')
    ? Math.round(Math.max(0, ((amt - withheld) * rate) - credited) * 100) / 100
    : parseFloat(bankChargesInr);

  try {
    const { rows: inv } = await pool.query(
      `SELECT invoice_number, settled_at FROM issued_invoices WHERE id = $1`, [req.params.id]
    );
    if (!inv.length) return res.status(404).json({ error: 'Invoice not found' });
    if (inv[0].settled_at) {
      return res.status(409).json({ error: 'This invoice is settled. Reopen it to add a payment.' });
    }

    // Numbered against the invoice, so a client asking which payment a document
    // refers to has an answer.
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS n FROM invoice_receipts WHERE invoice_id = $1`, [req.params.id]
    );
    const receiptNumber = `${inv[0].invoice_number}-R${countRows[0].n + 1}`;

    const { rows } = await pool.query(
      `INSERT INTO invoice_receipts
         (invoice_id, receipt_number, received_on, currency, amount_in_currency,
          exchange_rate, amount_credited_inr, method, reference, efirc_number,
          efirc_file_key, note,
          withheld_in_currency, withheld_inr, withholding_note, withholding_file_key,
          bank_charges_inr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [req.params.id, receiptNumber, receivedOn || new Date(), cur, amt, rate, credited,
       method?.trim() || null, reference?.trim() || null, efircNumber?.trim() || null,
       efircFileKey || null, note?.trim() || null,
       withheld, Math.round(withheld * rate * 100) / 100,
       withholdingNote?.trim() || null, withholdingFileKey || null,
       charges]
    );
    res.json({ ok: true, receipt: rows[0] });
  } catch (err) {
    console.error('invoicing/receipts create error:', err);
    res.status(500).json({ error: 'Could not record that payment' });
  }
});

// Editable until the invoice is settled. A rate is often provisional until the
// e-FIRC arrives weeks later, and an entry that cannot be corrected would mean
// carrying a wrong number rather than fixing it.
router.patch('/receipts/:id', async (req, res) => {
  const f = req.body;
  try {
    const { rows: r } = await pool.query(
      `SELECT ir.*, ii.settled_at FROM invoice_receipts ir
       JOIN issued_invoices ii ON ii.id = ir.invoice_id WHERE ir.id = $1`,
      [req.params.id]
    );
    if (!r.length) return res.status(404).json({ error: 'Payment not found' });
    if (r[0].settled_at) {
      return res.status(409).json({ error: 'This invoice is settled. Reopen it to make a change.' });
    }

    const cur  = (f.currency || r[0].currency).trim().toUpperCase();
    const rate = cur === 'INR' ? 1 : (f.exchangeRate !== undefined ? parseFloat(f.exchangeRate) : Number(r[0].exchange_rate));
    const amt  = f.amount !== undefined ? parseFloat(f.amount) : Number(r[0].amount_in_currency);
    const credited = f.amountCreditedInr !== undefined && f.amountCreditedInr !== ''
      ? parseFloat(f.amountCreditedInr)
      : Number(r[0].amount_credited_inr);

    const { rows } = await pool.query(
      `UPDATE invoice_receipts SET
         received_on = COALESCE($1, received_on),
         currency = $2, amount_in_currency = $3, exchange_rate = $4, amount_credited_inr = $5,
         method = COALESCE($6, method), reference = COALESCE($7, reference),
         efirc_number = COALESCE($8, efirc_number), efirc_file_key = COALESCE($9, efirc_file_key),
         note = COALESCE($10, note),
         -- Editable too, or correcting a receipt would quietly drop the
         -- withholding it was recorded with.
         withheld_in_currency = COALESCE($12, withheld_in_currency),
         withheld_inr         = COALESCE($13, withheld_inr),
         withholding_note     = COALESCE($14, withholding_note),
         withholding_file_key = COALESCE($15, withholding_file_key),
         bank_charges_inr     = COALESCE($16, bank_charges_inr),
         updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [f.receivedOn || null, cur, amt, rate, credited,
       f.method?.trim() ?? null, f.reference?.trim() ?? null, f.efircNumber?.trim() ?? null,
       f.efircFileKey ?? null, f.note?.trim() ?? null, req.params.id,
       f.withheldInCurrency === undefined ? null : (parseFloat(f.withheldInCurrency) || 0),
       f.withheldInCurrency === undefined ? null
         : Math.round((parseFloat(f.withheldInCurrency) || 0) * rate * 100) / 100,
       f.withholdingNote?.trim() ?? null, f.withholdingFileKey ?? null,
       f.bankChargesInr === undefined || f.bankChargesInr === '' ? null : parseFloat(f.bankChargesInr)]
    );
    res.json({ ok: true, receipt: rows[0] });
  } catch (err) {
    console.error('invoicing/receipts patch error:', err);
    res.status(500).json({ error: 'Could not update that payment' });
  }
});

router.delete('/receipts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM invoice_receipts ir USING issued_invoices ii
       WHERE ir.id = $1 AND ii.id = ir.invoice_id AND ii.settled_at IS NULL
       RETURNING ir.id`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'Not found, or the invoice is settled.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('invoicing/receipts delete error:', err);
    res.status(500).json({ error: 'Could not remove that payment' });
  }
});

// Closing an invoice, and reopening it. Reopening exists because an e-FIRC
// arriving late is normal, and a document that can never be corrected is worse
// than one that records the correction.
router.post('/issued/:id/settle', async (req, res) => {
  try {
    const { rows } = await pool.query(
      req.body.reopen
        ? `UPDATE issued_invoices SET settled_at = NULL WHERE id = $1 RETURNING id, settled_at`
        : `UPDATE issued_invoices SET settled_at = NOW(), paid_at = COALESCE(paid_at, NOW()) WHERE id = $1 RETURNING id, settled_at`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ok: true, settledAt: rows[0].settled_at });
  } catch (err) {
    console.error('invoicing/settle error:', err);
    res.status(500).json({ error: 'Could not update the invoice' });
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

// A platform invoice is generated on purchase and emailed to the fan. Jinal has
// had no way to open one — this is the same document, from the same builder, so
// what she sees is exactly what they received.
router.get('/platform/:number/pdf', async (req, res) => {
  try {
    const { generateInvoicePdfBuffer } = require('../lib/invoice');
    const { rows } = await pool.query(
      `SELECT * FROM invoices WHERE invoice_number = $1`, [req.params.number]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });

    // Supplier read live rather than stored on the invoice, matching how the
    // fan's copy was generated.
    const pdf = await generateInvoicePdfBuffer(rows[0], await getSupplier());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${rows[0].invoice_number.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('invoicing/platform pdf error:', err);
    res.status(500).json({ error: 'Failed to generate the invoice' });
  }
});

module.exports = router;