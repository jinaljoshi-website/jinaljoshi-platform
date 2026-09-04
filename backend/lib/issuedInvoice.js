// backend/lib/issuedInvoice.js
// Manual receipts (MI) and B2B service invoices (JJ): numbering, tax treatment,
// and the PDF. Kept apart from lib/invoice.js, which handles automatic platform
// token sales — the two have different series and must never share a sequence.

const pool = require('../db/pool');
const PDFDocument = require('pdfkit');
const { getConfigValue } = require('./config');

// Read from Studio, never hardcoded. The registered address is changing with the
// GST migration, and a copy in code would keep printing the old one on every
// invoice long after the legal pages had moved on.
async function getSupplier() {
  const keys = ['legal_business_name', 'legal_registered_address', 'legal_gstin',
                'legal_state', 'legal_udyam', 'legal_iec', 'legal_billing_email', 'legal_phone'];
  const { rows } = await pool.query(
    `SELECT key, value FROM platform_config WHERE key = ANY($1)`, [keys]
  );
  const c = {};
  rows.forEach((r) => { c[r.key] = r.value; });

  const missing = ['legal_business_name', 'legal_registered_address', 'legal_gstin', 'legal_state']
    .filter((k) => !c[k]?.trim());
  if (missing.length) {
    const err = new Error(`Supplier details missing from Studio: ${missing.join(', ')}`);
    err.code = 'SUPPLIER_CONFIG_MISSING';
    throw err;
  }

  return {
    name:    c.legal_business_name.trim(),
    address: c.legal_registered_address.trim(),
    gstin:   c.legal_gstin.trim(),
    state:   c.legal_state.trim(),
    udyam:   c.legal_udyam?.trim()         || null,
    iec:     c.legal_iec?.trim()           || null,
    email:   c.legal_billing_email?.trim() || null,
    phone:   c.legal_phone?.trim()         || null,
  };
}

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
//   state not known      → the supplier's own location, so CGST + SGST
//
// That last case is the one that catches people out. Under s.12(2)(b) of the
// IGST Act, where the recipient is unregistered and no address is on record,
// the place of supply is where the supplier is. Treating an unknown state as
// inter-state would charge IGST on what is legally an intra-state supply.
function computeTax({ lineItems, recipientCountry, placeOfSupply, gstRatePct, isExportOverride, supplierState, currency }) {
  const taxable = lineItems.reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
  const outsideIndia = recipientCountry && recipientCountry.trim().toLowerCase() !== 'india';

  // Being abroad is not enough.
  //
  // An export of services also needs the payment in convertible foreign
  // exchange, so a buyer in the United States paying rupees is an ordinary
  // domestic supply with GST on it. The token invoices already require both;
  // this required only the country, and would have zero-rated a sale that owes
  // eighteen per cent.
  //
  // The override still wins, because there are cases the rule cannot see — an
  // LUT, a place of supply that sits outside India for reasons of its own — and
  // whoever raises the invoice knows them.
  const foreignCurrency = currency && currency.trim().toUpperCase() !== 'INR';
  const qualifies = outsideIndia && foreignCurrency;
  const isExport = isExportOverride !== undefined && isExportOverride !== null
    ? !!isExportOverride
    : qualifies;

  if (isExport) {
    return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable, isExport: true, appliedRate: 0, placeOfSupply: placeOfSupply || null };
  }

  const rate  = parseFloat(gstRatePct) || 0;
  const known = (placeOfSupply || '').trim();
  const home  = supplierState || 'Maharashtra';
  const place = known || home;
  const sameState = place.toLowerCase() === home.toLowerCase();
  const tax = Math.round(taxable * rate) / 100;

  if (sameState) {
    const half = Math.round(tax * 50) / 100;
    return { taxable, cgst: half, sgst: tax - half, igst: 0, total: taxable + tax, isExport: false, appliedRate: rate, placeOfSupply: place };
  }
  return { taxable, cgst: 0, sgst: 0, igst: tax, total: taxable + tax, isExport: false, appliedRate: rate, placeOfSupply: place };
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

function generatePdf(inv, account, SUPPLIER, receipts = null) {
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
    doc.text([`GSTIN: ${SUPPLIER.gstin}`, SUPPLIER.udyam && `Udyam: ${SUPPLIER.udyam}`]
               .filter(Boolean).join('   ·   '), L, 116);
    doc.text([SUPPLIER.phone, SUPPLIER.email].filter(Boolean).join('   ·   '), L, 128);

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

    // Written at 790 for as long as this has existed, and a 7pt line there does
    // not fit: the usable area ends at 798 and PDFKit's line height takes it
    // past. So every invoice ever sent has had a second page with nothing on it
    // but this sentence.
    //
    // Tested rather than reasoned about — 790 gives two pages, 785 gives one.
    // Set at 775 so a font change does not quietly bring it back.
    doc.fontSize(7).fillColor('#888')
       .text('This is a computer-generated invoice.', L, 775, { width: W, align: 'center' });

    // What was paid against it, on a page of its own.
    //
    // Kept separate from the invoice rather than appended to it, because the
    // invoice is a document in its own right and somebody may have a copy of it
    // already. Adding rows underneath would make two versions of the same page.
    if (receipts && receipts.length) {
      doc.addPage();
      doc.fontSize(14).fillColor('#111').text('Payments received', L, 60);
      doc.fontSize(9).fillColor('#666')
         .text(`Against invoice ${inv.invoice_number}`, L, 82);

      // A page has a bottom, and this did not know about it.
      //
      // ry was tracked by hand and never checked, so once a long list ran past
      // the paper PDFKit added a page for every single line — nineteen receipts
      // became six printed and a hundred and forty blank pages, with the totals
      // somewhere at the end.
      //
      // Now the page break is asked for deliberately, before writing rather
      // than after discovering it.
      let ry = 118;
      const BOTTOM = 760;

      const room = (needed) => {
        if (ry + needed <= BOTTOM) return;
        doc.addPage();
        ry = 60;
        doc.fontSize(9).fillColor('#888')
           .text(`Payments received · ${inv.invoice_number} (continued)`, L, 40);
      };

      const line = (label, value, bold) => {
        room(17);
        doc.fontSize(9).fillColor(bold ? '#111' : '#444')
           .text(label, L, ry, { width: 200 })
           .text(value, L + 210, ry, { width: W - 210 });
        ry += 17;
      };

      let totalCredited = 0, totalWithheld = 0, totalCharges = 0;

      for (const r of receipts) {
        const rate = Number(r.exchange_rate) || 1;
        const withheldInr = Math.round(Number(r.withheld_in_currency || 0) * rate * 100) / 100;
        const credited = Number(r.amount_credited_inr || 0);
        const remitted = (Number(r.amount_in_currency) * rate) - withheldInr;
        const charges = r.bank_charges_inr === null || r.bank_charges_inr === undefined
          ? Math.max(0, Math.round((remitted - credited) * 100) / 100)
          : Number(r.bank_charges_inr);

        totalCredited += credited;
        totalWithheld += withheldInr;
        totalCharges  += charges;

        // Enough for the heading and the lines that follow it, so a receipt is
        // never split across two pages.
        room(110);
        doc.fontSize(10).fillColor('#111')
           .text(`${r.receipt_number} · ${new Date(r.received_on).toLocaleDateString('en-IN')}`, L, ry);
        ry += 18;

        if (r.currency && r.currency !== 'INR') {
          line('Sent', `${r.currency} ${Number(r.amount_in_currency).toFixed(2)} at ${rate}`);
          if (withheldInr > 0) {
            line('Withheld at source', `${r.currency} ${Number(r.withheld_in_currency).toFixed(2)}  (INR ${withheldInr.toFixed(2)})`);
          }
        }
        line('Credited to the account', `INR ${credited.toFixed(2)}`);
        if (charges > 0) line('Bank charges', `INR ${charges.toFixed(2)}`);
        if (r.method || r.reference) line('By', [r.method, r.reference].filter(Boolean).join(' · '));
        if (r.efirc_number) line('e-FIRC', r.efirc_number);
        ry += 10;
      }

      room(90);
      ry += 8;
      doc.moveTo(L, ry).lineTo(L + W, ry).strokeColor('#DDD').stroke();
      ry += 14;
      line('Total credited', `INR ${totalCredited.toFixed(2)}`, true);
      if (totalWithheld > 0) line('Total withheld at source', `INR ${totalWithheld.toFixed(2)}`, true);
      if (totalCharges > 0)  line('Total bank charges', `INR ${totalCharges.toFixed(2)}`, true);

      room(30);
      ry += 10;
      doc.fontSize(7).fillColor('#888')
         .text('Amounts credited are as realised by the bank. Tax withheld by the payer is shown separately from bank charges.',
               L, ry, { width: W, align: 'center' });
    }

    doc.end();
  });
}

module.exports = { getSupplier, PREFIX, getNextNumber, computeTax, amountInWords, generatePdf };