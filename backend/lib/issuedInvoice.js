// backend/lib/issuedInvoice.js
// Manual receipts (MI) and B2B service invoices (JJ): numbering, tax treatment,
// and the PDF. Kept apart from lib/invoice.js, which handles automatic platform
// token sales — the two have different series and must never share a sequence.

const pool = require('../db/pool');
const PDFDocument = require('pdfkit');

const SUPPLIER = {
  name:    'Jinal Joshi',
  address: 'A-14/103, Broadway Avenue Society, Jay Gopal Lal Road, Nr Jangid Circle,\nMira Road East, Mira Bhayandar, Thane, Maharashtra 401107, India',
  gstin:   '27AVBPJ4823E1ZV',
  state:   'Maharashtra',
  stateCode: '27',
  udyam:   'UDYAM-MH-33-0792419',
  iec:     'AVBPJ4823E',
  email:   'billing@jinaljoshi.in',
  phone:   '+91 86898 88658',
};

const PREFIX = { manual: 'MI', b2b: 'JJ' };

// Each kind keeps its own consecutive run within a financial year. Taken inside
// the caller's transaction and locked, so two invoices raised at the same moment
// cannot land on the same number — a duplicate would be a genuine problem.
async function getNextNumber(client, kind) {
  const prefix = PREFIX[kind];
  if (!prefix) throw new Error(`Unknown invoice kind: ${kind}`);
  const year = new Date().getFullYear();

  const { rows } = await client.query(
    `SELECT invoice_number FROM issued_invoices
     WHERE kind = $1 AND invoice_number LIKE $2
     ORDER BY invoice_number DESC LIMIT 1
     FOR UPDATE`,
    [kind, `${prefix}/${year}%`]
  );

  const last = rows[0]?.invoice_number;
  const seq  = last ? parseInt(last.slice(-3), 10) + 1 : 1;
  return `${prefix}/${year}${String(seq).padStart(3, '0')}`;
}

// Place of supply decides the split, and getting it wrong is the most common
// error on an Indian invoice:
//   outside India        → zero-rated export under LUT
//   same state as us     → CGST + SGST, half each
//   elsewhere in India   → IGST, the full rate
function computeTax({ lineItems, recipientCountry, placeOfSupply, gstRatePct, isExportOverride }) {
  const taxable = lineItems.reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
  const outsideIndia = recipientCountry && recipientCountry.trim().toLowerCase() !== 'india';
  const isExport = isExportOverride !== undefined ? !!isExportOverride : outsideIndia;

  if (isExport) {
    return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable, isExport: true, appliedRate: 0 };
  }

  const rate = parseFloat(gstRatePct) || 0;
  const sameState = (placeOfSupply || '').trim().toLowerCase() === SUPPLIER.state.toLowerCase();
  const tax = Math.round(taxable * rate) / 100;

  if (sameState) {
    const half = Math.round(tax * 50) / 100;
    return { taxable, cgst: half, sgst: tax - half, igst: 0, total: taxable + tax, isExport: false, appliedRate: rate };
  }
  return { taxable, cgst: 0, sgst: 0, igst: tax, total: taxable + tax, isExport: false, appliedRate: rate };
}

const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve',
  'Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

// Indian numbering — crore, lakh, thousand. A tax invoice is expected to state
// the total in words, and Western grouping would read wrongly here.
function amountInWords(amount, currency = 'INR') {
  const whole = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - whole) * 100);
  if (whole === 0 && paise === 0) return 'Zero';

  const parts = [];
  const crore = Math.floor(whole / 10000000);
  const lakh  = Math.floor((whole % 10000000) / 100000);
  const thou  = Math.floor((whole % 100000) / 1000);
  const hund  = Math.floor((whole % 1000) / 100);
  const rest  = whole % 100;

  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh)  parts.push(`${twoDigits(lakh)} Lakh`);
  if (thou)  parts.push(`${twoDigits(thou)} Thousand`);
  if (hund)  parts.push(`${ONES[hund]} Hundred`);
  if (rest)  parts.push(`${parts.length ? 'and ' : ''}${twoDigits(rest)}`);

  const unit = currency === 'INR' ? 'Rupees' : currency;
  const sub  = currency === 'INR' ? 'Paise'  : 'Cents';
  let out = `${unit} ${parts.join(' ')}`;
  if (paise) out += ` and ${sub} ${twoDigits(paise)}`;
  return out + ' Only';
}

function money(n, currency = 'INR') {
  const sym = currency === 'INR' ? 'Rs. ' : `${currency} `;
  return sym + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generatePdf(inv, account) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 44, R = 551, W = R - L;
    const line = (y) => doc.moveTo(L, y).lineTo(R, y).strokeColor('#DDD').lineWidth(0.5).stroke();

    // ── Supplier ──
    doc.fillColor('#111').fontSize(20).font('Helvetica-Bold').text(SUPPLIER.name, L, 44);
    doc.fontSize(8).font('Helvetica').fillColor('#555')
       .text('ACTOR  ·  PRODUCER  ·  CREATOR', L, 68, { characterSpacing: 1.4 });
    doc.fontSize(8).fillColor('#333').text(SUPPLIER.address, L, 84, { width: 300 });
    doc.text(`GSTIN: ${SUPPLIER.gstin}   ·   Udyam: ${SUPPLIER.udyam}`, L, 116);
    doc.text(`${SUPPLIER.phone}   ·   ${SUPPLIER.email}`, L, 128);

    doc.fontSize(15).font('Helvetica-Bold').fillColor('#111')
       .text(inv.kind === 'b2b' ? 'TAX INVOICE' : 'INVOICE', 340, 46, { width: 211, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor('#333')
       .text(`Invoice no: ${inv.invoice_number}`, 340, 70, { width: 211, align: 'right' })
       .text(`Date: ${new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
             340, 84, { width: 211, align: 'right' });
    if (inv.reverse_charge) {
      doc.text('Reverse charge: Yes', 340, 98, { width: 211, align: 'right' });
    }

    line(148);

    // ── Recipient ──
    let y = 158;
    doc.fontSize(8).fillColor('#777').text('BILL TO', L, y);
    y += 13;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text(inv.recipient_name, L, y);
    y += 15;
    doc.fontSize(9).font('Helvetica').fillColor('#333');
    if (inv.recipient_address) { doc.text(inv.recipient_address, L, y, { width: 300 }); y = doc.y + 2; }
    if (inv.recipient_gstin)   { doc.text(`GSTIN: ${inv.recipient_gstin}`, L, y); y += 12; }
    if (inv.recipient_email)   { doc.text(inv.recipient_email, L, y); y += 12; }
    doc.text(`Place of supply: ${inv.place_of_supply || inv.recipient_country}`, L, y);
    y += 20;

    line(y); y += 12;

    // ── Line items ──
    doc.fontSize(8).fillColor('#777');
    doc.text('DESCRIPTION', L, y, { width: 250 });
    doc.text('SAC', 300, y, { width: 60 });
    doc.text('QTY', 362, y, { width: 40, align: 'right' });
    doc.text('RATE', 404, y, { width: 65, align: 'right' });
    doc.text('AMOUNT', 471, y, { width: 80, align: 'right' });
    y += 14;
    line(y); y += 8;

    doc.fontSize(9).fillColor('#111').font('Helvetica');
    for (const li of inv.line_items || []) {
      const top = y;
      doc.text(li.description || '', L, y, { width: 250 });
      const rowH = Math.max(doc.y - top, 12);
      doc.text(li.sac || '—', 300, top, { width: 60 });
      doc.text(String(li.quantity ?? 1), 362, top, { width: 40, align: 'right' });
      doc.text(money(li.rate ?? li.amount, inv.currency), 404, top, { width: 65, align: 'right' });
      doc.text(money(li.amount, inv.currency), 471, top, { width: 80, align: 'right' });
      y = top + rowH + 8;
    }

    line(y); y += 10;

    // ── Totals ──
    const row = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#111');
      doc.text(label, 330, y, { width: 140, align: 'right' });
      doc.text(value, 471, y, { width: 80, align: 'right' });
      y += bold ? 18 : 14;
    };
    row('Taxable value', money(inv.taxable_amount, inv.currency));
    if (Number(inv.cgst_amount) > 0) {
      row(`CGST @ ${Number(inv.gst_rate_pct) / 2}%`, money(inv.cgst_amount, inv.currency));
      row(`SGST @ ${Number(inv.gst_rate_pct) / 2}%`, money(inv.sgst_amount, inv.currency));
    }
    if (Number(inv.igst_amount) > 0) row(`IGST @ ${inv.gst_rate_pct}%`, money(inv.igst_amount, inv.currency));
    if (inv.is_export) row('GST', '0% (export)');
    y += 2; line(y); y += 8;
    row('Total', money(inv.total_amount, inv.currency), true);

    y += 6;
    doc.fontSize(8).font('Helvetica-Oblique').fillColor('#444')
       .text(`Amount in words: ${amountInWords(inv.total_amount, inv.currency)}`, L, y, { width: W });
    y = doc.y + 14;

    if (inv.is_export) {
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#555')
         .text('Supply meant for export under bond or letter of undertaking without payment of integrated tax.',
               L, y, { width: W });
      y = doc.y + 12;
    }

    // ── Payment details, so a client can actually pay ──
    if (account) {
      line(y); y += 10;
      doc.fontSize(8).font('Helvetica').fillColor('#777').text('PAYMENT DETAILS', L, y);
      y += 12;
      doc.fontSize(9).fillColor('#111').text(account.details_text, L, y, { width: 320 });
      y = doc.y + 6;
    }

    if (inv.notes) {
      doc.fontSize(8).fillColor('#555').text(inv.notes, L, y, { width: W });
      y = doc.y + 8;
    }

    const signY = Math.max(y + 30, 700);
    doc.fontSize(9).fillColor('#111')
       .text(`For ${SUPPLIER.name}`, 340, signY, { width: 211, align: 'right' })
       .text('Authorised signatory', 340, signY + 44, { width: 211, align: 'right' });

    doc.fontSize(7).fillColor('#888')
       .text('This is a computer-generated invoice.', L, 790, { width: W, align: 'center' });

    doc.end();
  });
}

module.exports = { SUPPLIER, PREFIX, getNextNumber, computeTax, amountInWords, generatePdf };