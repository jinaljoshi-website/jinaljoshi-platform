// backend/lib/invoice.js
// Generates, stores, and emails a GST-compliant invoice for every token purchase.

const pool = require('../db/pool');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { getNextInvoiceNumber } = require('./invoiceNumber');
const { getConfigNumber, getConfigValue } = require('./config');
const { getSupplier } = require('./issuedInvoice');

const EXPORT_DISCLAIMER =
  'Supply meant for export under bond or letter of undertaking without payment of integrated tax.';

// The two-condition rule: GST is zero ONLY when the user is genuinely outside India
// AND the payment was made in a non-INR currency. Any other combination is taxed normally.
function determineIsExport({ userCountry, currency }) {
  const isOutsideIndia = userCountry && userCountry !== 'India';
  const isForeignCurrency = currency && currency !== 'INR';
  return Boolean(isOutsideIndia && isForeignCurrency);
}

async function buildInvoiceRecord(client, {
  userId, userEmail, userCountry, userState, ipAddress, coinLedgerId,
  tokensPurchased, amountInrEquivalent, currency, amountInCurrency,
  exchangeRateUsed, paymentMethodDisplay,
}) {
  const isExport = determineIsExport({ userCountry, currency });
  const gstRatePct = isExport ? 0 : await getConfigNumber('domestic_gst_rate_pct');
  const sacCode = (await getConfigValue('token_sac_code')) || '999599';

  // amountInrEquivalent is treated as GST-inclusive for domestic transactions;
  // back-calculate the tax and taxable-value split from it.
  let gstAmountInr = 0;
  let taxableAmountInr = amountInrEquivalent;

  if (!isExport && gstRatePct > 0) {
    taxableAmountInr = Math.round((amountInrEquivalent * 100) / (100 + gstRatePct) * 100) / 100;
    gstAmountInr = Math.round((amountInrEquivalent - taxableAmountInr) * 100) / 100;
  }

  // A tax invoice has to show which taxes were actually charged, not just a total.
  //
  // We know the fan's country from their IP but never their state, and under
  // s.12(2)(b) of the IGST Act an unregistered recipient with no address on
  // record takes the supplier's own location as the place of supply. So an
  // unknown state is an INTRA-state supply — CGST + SGST, not IGST. Treating it
  // as inter-state would charge the wrong tax on a domestic sale.
  //
  // userState is accepted here so that the day we ask fans for it, a Karnataka
  // buyer correctly gets IGST with no further change.
  const supplier = await getSupplier();
  const placeOfSupply = isExport
    ? (userCountry || null)
    : ((userState || '').trim() || supplier.state);

  let cgst = 0, sgst = 0, igst = 0;
  if (!isExport && gstAmountInr > 0) {
    if (placeOfSupply.toLowerCase() === supplier.state.toLowerCase()) {
      cgst = Math.round(gstAmountInr / 2 * 100) / 100;
      sgst = Math.round((gstAmountInr - cgst) * 100) / 100;
    } else {
      igst = gstAmountInr;
    }
  }

  const invoiceNumber = await getNextInvoiceNumber(client);

  const { rows } = await client.query(
    `INSERT INTO invoices (
       invoice_number, user_id, coin_ledger_id, user_email, user_country,
       payment_method_display, currency, amount_in_currency, exchange_rate_used,
       amount_inr_equivalent, tokens_purchased, is_export, gst_rate_pct,
       gst_amount_inr, taxable_amount_inr,
       cgst_amount_inr, sgst_amount_inr, igst_amount_inr, place_of_supply,
       sac_code, ip_address
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      invoiceNumber, userId, coinLedgerId, userEmail, userCountry || 'Unknown',
      paymentMethodDisplay || 'Not provided', currency, amountInCurrency, exchangeRateUsed || null,
      amountInrEquivalent, tokensPurchased, isExport, gstRatePct,
      gstAmountInr, taxableAmountInr,
      cgst, sgst, igst, placeOfSupply,
      sacCode, ipAddress || null,
    ]
  );

  return rows[0];
}

function formatCurrency(amount, currency) {
  const symbols = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$' };
  return `${symbols[currency] || currency + ' '}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generateInvoicePdfBuffer(invoice, supplier) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // A tax invoice must identify the supplier — name, address and GSTIN. Without
    // them it is not a valid document, however correct the arithmetic.
    doc.fontSize(20).fillColor('#000').text('Personal Space', { align: 'left' });
    if (supplier) {
      doc.fontSize(9).fillColor('#444').text(`Operated by ${supplier.name}`, { align: 'left' });
      doc.fontSize(8).fillColor('#555').text(supplier.address.replace(/\n/g, ' '), { width: 300 });
      doc.fontSize(8).text([`GSTIN: ${supplier.gstin}`, 'ps.jinaljoshi.in', supplier.email]
                             .filter(Boolean).join('   ·   '));
    } else {
      doc.fontSize(10).fillColor('#666').text('ps.jinaljoshi.in', { align: 'left' });
    }
    doc.moveDown(1.2);

    doc.fontSize(14).fillColor('#000').text('TAX INVOICE', { align: 'right' });
    doc.fontSize(10).fillColor('#333').text(`Invoice No: ${invoice.invoice_number}`, { align: 'right' });
    doc.text(`Date: ${new Date(invoice.issued_at).toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#000').text('Billed To', { underline: true });
    doc.fontSize(10).fillColor('#333');
    doc.text(`Email: ${invoice.user_email}`);
    doc.text(`Country: ${invoice.user_country}`);
    if (invoice.place_of_supply) doc.text(`Place of supply: ${invoice.place_of_supply}`);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#000').text('Transaction Details', { underline: true });
    doc.fontSize(10).fillColor('#333');
    doc.text(`Description: Purchase of ${invoice.tokens_purchased} J Tokens`);
    if (invoice.sac_code) doc.text(`SAC: ${invoice.sac_code}`);
    doc.text(`Payment Method: ${invoice.payment_method_display}`);
    doc.text(`Currency: ${invoice.currency}`);
    if (invoice.exchange_rate_used) {
      doc.text(`Exchange Rate Applied: 1 INR = ${Number(invoice.exchange_rate_used).toFixed(4)} ${invoice.currency}`);
    }
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#000').text('Amount Breakdown', { underline: true });
    doc.fontSize(10).fillColor('#333');
    doc.text(`Taxable Value: ${formatCurrency(invoice.taxable_amount_inr, 'INR')} (INR equivalent)`);
    if (Number(invoice.cgst_amount_inr) > 0) {
      doc.text(`CGST @ ${Number(invoice.gst_rate_pct) / 2}%: ${formatCurrency(invoice.cgst_amount_inr, 'INR')}`);
      doc.text(`SGST @ ${Number(invoice.gst_rate_pct) / 2}%: ${formatCurrency(invoice.sgst_amount_inr, 'INR')}`);
    } else if (Number(invoice.igst_amount_inr) > 0) {
      doc.text(`IGST @ ${invoice.gst_rate_pct}%: ${formatCurrency(invoice.igst_amount_inr, 'INR')}`);
    } else {
      doc.text(`GST Rate: ${invoice.gst_rate_pct}%`);
      doc.text(`GST Amount: ${formatCurrency(invoice.gst_amount_inr, 'INR')} (INR equivalent)`);
    }
    doc.fontSize(11).text(`Total Paid: ${formatCurrency(invoice.amount_in_currency, invoice.currency)}`, { bold: true });
    doc.moveDown(1);

    if (invoice.is_export) {
      doc.fontSize(9).fillColor('#555').text(EXPORT_DISCLAIMER, { italics: true, width: 495 });
      doc.moveDown(1);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(
      'This is a system-generated invoice for a digital token purchase on Personal Space. J Tokens are a non-refundable, non-transferable digital utility instrument with no cash value outside the platform.',
      { width: 495 }
    );

    doc.end();
  });
}

async function sendInvoiceEmail(invoice, pdfBuffer) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.BILLING_GMAIL_USER,
      pass: process.env.BILLING_GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"Personal Space Billing" <${process.env.BILLING_FROM_ADDRESS || 'billing@jinaljoshi.in'}>`,
    to: invoice.user_email,
    subject: `Your Invoice ${invoice.invoice_number} — Personal Space`,
    text: `Thank you for your purchase of ${invoice.tokens_purchased} J Tokens. Your invoice is attached.`,
    attachments: [
      { filename: `${invoice.invoice_number.replace('/', '-')}.pdf`, content: pdfBuffer },
    ],
  });
}

// Main entry point — call this right after a successful recharge is committed.
// Runs in its own try/catch so a PDF/email failure never breaks the actual purchase.
async function issueInvoiceForPurchase(params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoice = await buildInvoiceRecord(client, params);
    await client.query('COMMIT');

    // Invoices are not emailed. They are recorded here and viewed in Studio, so a
    // mail outage can never affect a purchase. emailed_at stays null until an
    // invoice is actually sent, which makes "not yet sent" queryable.

    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('invoice/issueInvoiceForPurchase error:', err.message);
    return null;
  } finally {
    client.release();
  }
}

module.exports = { issueInvoiceForPurchase, determineIsExport, generateInvoicePdfBuffer, formatCurrency };