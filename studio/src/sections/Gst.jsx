// studio/src/sections/Gst.jsx
//
// A month, in the tables the portal asks for.
//
// GSTR-1 wants figures under numbered headings, and the work nobody should have
// to do is translating a list of invoices into those headings. So the headings
// are the shape of this screen: table 5, table 6A, table 7, and so on, in the
// order they appear on the portal, with the same names.
//
// The intent is reading across rather than working out. Open the portal beside
// this and every figure has somewhere to go.
//
// It is not a return and not advice about one. It is the arithmetic from the
// invoices, shown so it can be checked.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function Gst() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data,  setData]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    api.get(`/api/studio/gst/month?year=${year}&month=${month}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  const t = data?.tables;

  return (
    <div>
      <T.sectionTitle>GST</T.sectionTitle>
      <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 18, lineHeight: 1.6, maxWidth: 640 }}>
        The month totalled the way GSTR-1 asks for it, under the same table
        numbers. Open the portal beside this and read across. These are the
        figures from the invoices, not a return — worth checking against
        whoever files.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                style={{ ...S.input, width: 'auto', padding: '7px 12px', fontSize: 13 }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                style={{ ...S.input, width: 'auto', padding: '7px 12px', fontSize: 13 }}>
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) =>
            <option key={y} value={y}>{y}</option>)}
        </select>
        <a href={`${import.meta.env.VITE_API_URL}/api/studio/gst/invoices.csv?year=${year}&month=${month}`}
           onClick={(e) => { e.preventDefault(); downloadCsv(year, month); }}
           style={{ ...S.ghostBtn, fontSize: 12, padding: '8px 14px', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          Every invoice, as a file
        </a>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {loading && <T.muted>Adding it up…</T.muted>}

      {!loading && data && data.totals.invoices === 0 && (
        <Card><T.muted>No invoices were raised in {MONTHS[month - 1]} {year}.</T.muted></Card>
      )}

      {!loading && data && data.totals.invoices > 0 && (
        <>
          {/* The month in one line, before the breakdown. If this does not match
              what the portal totals at the end, something below is wrong. */}
          <Card style={{ marginBottom: 16 }}>
            <Row label="Invoices" value={data.totals.invoices} strong />
            <Row label="Taxable value" value={rupees(data.totals.taxable)} />
            <Row label="CGST" value={rupees(data.totals.cgst)} />
            <Row label="SGST" value={rupees(data.totals.sgst)} />
            <Row label="IGST" value={rupees(data.totals.igst)} />
            <Row label="Total tax" value={rupees(data.totals.gst)} strong />
            <Row label="Gross collected" value={rupees(data.totals.gross)} strong last />
          </Card>

          <Table title="5 — B2C (Large) Invoices"
                 note={`Interstate sales above ${rupees(data.b2clThreshold)}, listed one by one.`}
                 empty="Nothing this month."
                 rows={t.t5_b2cLarge}
                 cols={[
                   ['invoice_number', 'Invoice'],
                   ['issued_at', 'Date', (v) => new Date(v).toLocaleDateString('en-IN')],
                   ['place_of_supply', 'Place of supply'],
                   ['invoice_value', 'Invoice value', rupees],
                   ['gst_rate_pct', 'Rate', (v) => `${v}%`],
                   ['taxable_amount_inr', 'Taxable', rupees],
                   ['igst_amount_inr', 'IGST', rupees],
                 ]} />

          <Table title="6A — Exports Invoices"
                 note="Zero-rated supplies to buyers outside India."
                 empty="No export sales this month."
                 rows={t.t6a_exports}
                 cols={[
                   ['invoice_number', 'Invoice'],
                   ['issued_at', 'Date', (v) => new Date(v).toLocaleDateString('en-IN')],
                   ['user_country', 'Country'],
                   ['currency', 'Currency'],
                   ['amount_in_currency', 'Paid', (v) => Number(v || 0).toLocaleString('en-IN')],
                   ['invoice_value', 'Value (INR)', rupees],
                   ['export_with_tax', 'With tax', (v) => (v ? 'Yes' : 'No')],
                 ]} />

          <Table title="7 — B2C (Others)"
                 note="Everything else, summarised per place of supply and rate, which is the form the portal wants."
                 empty="Nothing this month."
                 rows={t.t7_b2cOthers}
                 cols={[
                   ['place_of_supply', 'Place of supply', null,
                     // What went into an Other Territory line. The portal has
                     // one row for it and no way to add another, so several
                     // countries arrive as one number — and a total nobody can
                     // take apart is a total nobody can check.
                     (r) => (r.folded_from?.length
                       ? `from ${r.folded_from.join(', ')}`
                       : null)],
                   ['gst_rate_pct', 'Rate', (v) => `${v}%`],
                   ['invoices', 'Invoices'],
                   ['taxable', 'Taxable', rupees],
                   ['cgst', 'CGST', rupees],
                   ['sgst', 'SGST', rupees],
                   ['igst', 'IGST', rupees],
                 ]} />

          {/* Invoices raised by hand, which were in the ledger and in no
              return. Listed rather than folded into the summary above, because
              each has a counterparty and a number: these are documents
              somebody can be asked to produce. */}
          <Table title="Invoices raised directly — for 5 or 7"
                 note="Domestic invoices written by hand, including foreign clients who paid in rupees. Add these to the table their value puts them in."
                 empty="None this month."
                 rows={t.t7_issuedInvoices}
                 cols={[
                   ['invoice_number', 'Invoice'],
                   ['issued_at', 'Date', (v) => new Date(v).toLocaleDateString('en-IN')],
                   ['place_of_supply', 'Place of supply'],
                   ['gst_rate_pct', 'Rate', (v) => `${v}%`],
                   ['taxable', 'Taxable', rupees],
                   ['cgst', 'CGST', rupees],
                   ['sgst', 'SGST', rupees],
                   ['igst', 'IGST', rupees],
                 ]} />

          <Table title="9B — Credit / Debit Notes (Unregistered)"
                 note="Refunds. They reduce what is owed and are the first thing missed when adding up by hand."
                 empty="No refunds this month."
                 rows={t.t9b_creditNotes?.notes > 0 ? [t.t9b_creditNotes] : []}
                 cols={[['notes', 'Notes'], ['value', 'Value', rupees]]} />

          <Table title="12 — HSN-wise summary of outward supplies"
                 note="One service, so one line. J Tokens are a digital utility credit under SAC 999599."
                 empty="Nothing this month."
                 rows={t.t12_hsn}
                 cols={[
                   ['sac', 'SAC'],
                   ['quantity', 'Tokens sold', (v) => Number(v).toLocaleString('en-IN')],
                   ['total_value', 'Total value', rupees],
                   ['taxable', 'Taxable', rupees],
                   ['cgst', 'CGST', rupees],
                   ['sgst', 'SGST', rupees],
                   ['igst', 'IGST', rupees],
                 ]} />

          <Table title="13 — Documents Issued"
                 note="The range of invoice numbers and how many. A check that none went missing."
                 empty="Nothing this month."
                 rows={t.t13_documents?.issued > 0 ? [t.t13_documents] : []}
                 cols={[['from_no', 'From'], ['to_no', 'To'], ['issued', 'Issued']]} />
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
                  borderBottom: last ? 'none' : `1px solid ${colors.border}` }}>
      <span style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 13, color: colors.text,
                     fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function Table({ title, note, rows, cols, empty }) {
  const has = rows && rows.length > 0;
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: has ? 14 : 0, lineHeight: 1.5 }}>
        {note}
      </div>

      {!has ? (
        <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 8 }}>{empty}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
            <thead>
              <tr>
                {cols.map(([k, label]) => (
                  <th key={k} style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em',
                                       textTransform: 'uppercase', color: colors.muted,
                                       textAlign: 'left', padding: '6px 12px 6px 0',
                                       borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map(([k, , fmt, sub]) => (
                    <td key={k} style={{ fontFamily: mono, fontSize: 12, color: colors.text,
                                         padding: '8px 12px 8px 0',
                                         borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                      {fmt ? fmt(r[k]) : (r[k] ?? '—')}
                      {sub && sub(r) && (
                        <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{sub(r)}</div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Fetched with the token rather than followed as a link: the endpoint needs
// authentication and a bare href carries none.
async function downloadCsv(year, month) {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/api/studio/gst/invoices.csv?year=${year}&month=${month}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` } }
    );
    if (!res.ok) throw new Error('Could not fetch');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gst-${year}-${String(month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch { /* the page is still there and the attempt can be repeated */ }
}