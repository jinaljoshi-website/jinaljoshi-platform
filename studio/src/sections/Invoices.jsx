// studio/src/sections/Invoices.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: sans, fontSize: 12 };
const th  = { textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${colors.border}`, color: colors.muted, fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td  = { padding: '9px 10px', borderBottom: `1px solid ${colors.border}`, color: colors.text, verticalAlign: 'top' };


// Jinal's own codes. Free text, because a new kind of work should not need a
// deploy — the list is a shortcut, not a restriction.
const SAC_CODES = [
  { code: '999631', label: 'Services of performing artists' },
  { code: '999612', label: 'Motion picture, videotape, television & radio production' },
  { code: '998397', label: 'Sponsorship & brand promotion services' },
  { code: '998386', label: 'Photographic & videographic processing services' },
  { code: '999629', label: 'Other performing arts & live entertainment n.e.c.' },
  { code: '681291', label: 'Clothing, accessories, footwear & headgear' },
  { code: '621050', label: 'Other women garments' },
];

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Ladakh','Lakshadweep'];

const blankLine = () => ({ description: '', sac: '', quantity: '1', rate: '' });

const rupees = (n, cur = 'INR') =>
  `${cur === 'INR' ? '₹' : cur + ' '}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Invoices() {
  const [tab,      setTab]      = useState('b2b');
  const [accounts, setAccounts] = useState([]);
  const [issued,   setIssued]   = useState([]);
  const [totals,   setTotals]   = useState(null);
  const [platform, setPlatform] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [creating, setCreating] = useState(false);
  const [busy,     setBusy]     = useState(false);

  const [form, setForm] = useState(null);

  const [openReceipts, setOpenReceipts] = useState(null);

  const loadIssued = () => api.get('/api/studio/invoicing/issued')
    .then((d) => { setIssued(d.invoices || []); setTotals(d.totals); });

  useEffect(() => {
    Promise.all([
      api.get('/api/studio/invoicing/accounts').then((d) => setAccounts(d.accounts || [])),
      loadIssued(),
      api.get('/api/studio/invoicing/platform').then(setPlatform),
    ]).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const startNew = (kind) => {
    const def = accounts.find((a) => a.is_default) || accounts[0];
    setForm({
      kind,
      invoiceDate: new Date().toISOString().slice(0, 10),
      recipientName: '', recipientEmail: '', recipientAddress: '',
      recipientGstin: '', recipientCountry: 'India', placeOfSupply: 'Maharashtra',
      reverseCharge: false,
      lineItems: [blankLine()],
      currency: 'INR', gstRatePct: '18',
      paymentAccountId: def?.id || '',
      notes: '',
    });
    setCreating(true);
    setError(''); setSuccess('');
  };

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i, k, v) => setForm((f) => ({
    ...f, lineItems: f.lineItems.map((li, n) => n === i ? { ...li, [k]: v } : li),
  }));

  const isDomestic = (form?.recipientCountry || '').trim().toLowerCase() === 'india';
  const sameState  = isDomestic && (form?.placeOfSupply || '').toLowerCase() === 'maharashtra';
  const taxable    = (form?.lineItems || []).reduce(
    (s, li) => s + (parseFloat(li.quantity) || 1) * (parseFloat(li.rate) || 0), 0);
  const rate       = isDomestic ? (parseFloat(form?.gstRatePct) || 0) : 0;
  const taxAmount  = Math.round(taxable * rate) / 100;

  const submit = async () => {
    setError(''); setSuccess(''); setBusy(true);
    try {
      const d = await api.post('/api/studio/invoicing/issued', form);
      setSuccess(`${d.invoice.invoice_number} created.`);
      setCreating(false); setForm(null);
      loadIssued();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  // The PDF route needs the auth header, so it cannot simply be a link.
  const downloadPdf = async (inv) => {
    setError('');
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/studio/invoicing/issued/${inv.id}/pdf`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` } }
      );
      if (!res.ok) throw new Error('Could not generate the PDF');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number.replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };

  const downloadPlatformPdf = async (number) => {
    setError('');
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/studio/invoicing/platform/${encodeURIComponent(number)}/pdf`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` } }
      );
      if (!res.ok) throw new Error('Could not generate the PDF');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${number.replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };

  if (loading) return <T.muted>Loading invoices…</T.muted>;

  const list = issued.filter((i) => i.kind === (tab === 'b2b' ? 'b2b' : 'manual'));

  return (
    <div>
      <Eyebrow>Accounting</Eyebrow>
      <T.title>Invoices</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'b2b',      label: 'B2B — acting & promotions' },
          { key: 'manual',   label: 'B2C — direct invoices' },
          { key: 'platform', label: 'Platform token sales' },
        ].map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setCreating(false); }}
            style={{
              background: tab === t.key ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     tab === t.key ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`,
              color:      tab === t.key ? colors.accent : colors.muted,
              fontFamily: sans, fontSize: 12, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PLATFORM ── */}
      {tab === 'platform' && platform && (
        <>
          <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, lineHeight: 1.7, marginBottom: 16, maxWidth: 720 }}>
            Raised automatically for every J Token purchase. Nothing to do here — this is the
            filing view, grouped by month the way GSTR-1 is filed.
          </p>
          {platform.months.length === 0 ? <T.muted>No token sales yet.</T.muted> : (
            <>
              {/* Monthly totals first, because that is what gets filed. */}
              {platform.months.map((m) => (
                <Card key={m.month} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <T.sectionTitle>{m.label}</T.sectionTitle>
                      <div style={S.rowSub}>{m.count} invoice{m.count === 1 ? '' : 's'}
                        {m.exportCount > 0 && ` · ${m.exportCount} zero-rated export`}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: sans, fontSize: 13 }}>
                      <div style={{ color: colors.text }}>Taxable {rupees(m.taxable)}</div>
                      <div style={{ color: colors.accent, marginTop: 2 }}>GST {rupees(m.gst)}</div>
                      <div style={{ color: colors.muted, marginTop: 2 }}>Total {rupees(m.total)}</div>
                    </div>
                  </div>
                </Card>
              ))}

              {/* Then every invoice, which doubles as the transaction record —
                  there was nowhere in Studio showing what had actually been
                  sold, only what it summed to. */}
              <T.sectionTitle style={{ marginTop: 24 }}>Every sale ({platform.invoices.length})</T.sectionTitle>
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      {['Invoice', 'Date', 'Fan', 'Tokens', 'Charged', 'Taxable', 'Tax', 'Place of supply', ''].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {platform.invoices.map((i) => (
                      <tr key={i.invoice_number}>
                        <td style={{ ...td, fontFamily: mono, fontSize: 11 }}>{i.invoice_number}</td>
                        <td style={td}>
                          {new Date(i.issued_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </td>
                        <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.user_email}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{i.tokens_purchased}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {i.currency !== 'INR'
                            ? <>{i.currency} {Number(i.amount_in_currency).toFixed(2)}
                                <div style={{ fontSize: 10, color: colors.muted }}>{rupees(i.amount_inr_equivalent)}</div></>
                            : rupees(i.amount_inr_equivalent)}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{rupees(i.taxable_amount_inr)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {i.is_export
                            ? <span style={{ color: '#8FC88F' }}>0% export</span>
                            : <>
                                {rupees(i.gst_amount_inr)}
                                <div style={{ fontSize: 10, color: colors.muted }}>
                                  {Number(i.igst_amount_inr) > 0 ? 'IGST' : 'CGST + SGST'}
                                </div>
                              </>}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: colors.muted }}>{i.place_of_supply || '—'}</td>
                        <td style={td}>
                          <button onClick={() => downloadPlatformPdf(i.invoice_number)}
                                  style={{ ...S.ghostBtn, fontSize: 11, padding: '4px 10px' }}>
                            PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ── ISSUED: B2B and MANUAL ── */}
      {tab !== 'platform' && (
        <>
          {!creating && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
              <button onClick={() => startNew(tab)} style={S.btn}>
                {tab === 'b2b' ? 'New tax invoice' : 'New receipt'}
              </button>
              {/* No total across the list.
                  //
                  // It added every invoice together and put a rupee sign on the
                  // answer, so eight hundred dollars read as eight hundred
                  // rupees. Summing amounts in different currencies gives a
                  // number that is not a quantity of anything, and there is
                  // nothing useful to replace it with: each invoice already
                  // states its own value, in its own currency, on its own row.
                  //
                  // How many are unpaid is still worth saying, because that is
                  // a count rather than an amount. */}
              {totals?.unpaidCount > 0 && (
                <span style={{ fontFamily: sans, fontSize: 12, color: '#D9A45C' }}>
                  {totals.unpaidCount} unpaid
                </span>
              )}
            </div>
          )}

          {creating && form && (
            <Card style={{ marginBottom: 24 }}>
              <T.sectionTitle>{form.kind === 'b2b' ? 'New tax invoice' : 'New receipt'}</T.sectionTitle>

              <div style={S.formGrid}>
                <Field label={form.kind === 'b2b' ? 'Client name (legal name)' : 'Received from'}>
                  <input style={S.input} value={form.recipientName} onChange={(e) => setF('recipientName', e.target.value)} />
                </Field>
                <Field label="Email (optional)">
                  <input style={S.input} value={form.recipientEmail} onChange={(e) => setF('recipientEmail', e.target.value)} />
                </Field>
                <Field label="Invoice date">
                  <input style={S.input} type="date" value={form.invoiceDate} onChange={(e) => setF('invoiceDate', e.target.value)} />
                </Field>
                <Field label="Country">
                  <input style={S.input} value={form.recipientCountry} onChange={(e) => setF('recipientCountry', e.target.value)} />
                </Field>
                {/* Chosen rather than inferred from whichever account was
                    picked further down the form. It decides whether GST applies
                    at all, so it belongs beside the country it depends on. */}
                <Field label="Invoice currency">
                  <select style={S.input} value={form.currency}
                          onChange={(e) => setF('currency', e.target.value)}>
                    {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'].map((c) =>
                      <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ marginTop: 12 }}>
                <Field label="Address">
                  <textarea style={{ ...S.input, minHeight: 60, resize: 'vertical' }} value={form.recipientAddress}
                            onChange={(e) => setF('recipientAddress', e.target.value)} />
                </Field>
              </div>

              {isDomestic && (
                <div style={{ ...S.formGrid, marginTop: 12 }}>
                  <Field label={form.kind === 'b2b' ? 'Client GSTIN (required)' : 'Client GSTIN (optional)'}>
                    <input style={S.input} value={form.recipientGstin} onChange={(e) => setF('recipientGstin', e.target.value.toUpperCase())}
                           placeholder="27ABCDE1234F1Z5" />
                  </Field>
                  <Field label="Place of supply">
                    <select style={S.input} value={form.placeOfSupply} onChange={(e) => setF('placeOfSupply', e.target.value)}>
                      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="GST rate (%)">
                    <input style={S.input} type="number" min={0} max={28} step="0.5"
                           value={form.gstRatePct} onChange={(e) => setF('gstRatePct', e.target.value)} />
                  </Field>
                </div>
              )}

              {/* Which of the two a foreign sale is.
                  //
                  // Being abroad is not enough for an export of services: the
                  // payment has to be in convertible foreign exchange. A buyer
                  // in the United States paying rupees is an ordinary domestic
                  // supply with GST on it, and the note here used to promise
                  // the opposite.
                  //
                  // Said before the invoice is raised rather than discovered
                  // afterwards, because the two go to different places on the
                  // return: 6A for a true export, 5 or 7 for everything else. */}
              {!isDomestic && (
                <div style={exportNote}>
                  {form.currency === 'INR' ? (
                    <>
                      Outside India, but paid in rupees — so this is <strong>not</strong> an
                      export of services. GST at {form.gstRatePct}% applies and it will be
                      reported under B2C rather than 6A. Choose a foreign-currency account
                      below if the client is paying in their own currency.
                    </>
                  ) : (
                    <>
                      A zero-rated export of services in {form.currency}, with no GST, reported
                      under 6A. The rupee value follows from the e-FIRC when the money lands.
                    </>
                  )}
                </div>
              )}

              {/* Line items */}
              <div style={{ marginTop: 18 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Line items
                </div>
                <datalist id="sac-codes">
                  {SAC_CODES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </datalist>
                {form.lineItems.map((li, i) => (
                  <div key={i} style={lineRow}>
                    <input style={{ ...S.input, flex: 3, minWidth: 160 }} placeholder="Description of service"
                           value={li.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
                    <input style={{ ...S.input, flex: 1, minWidth: 90 }} list="sac-codes" placeholder="SAC"
                           value={li.sac} onChange={(e) => setLine(i, 'sac', e.target.value)} />
                    <input style={{ ...S.input, width: 60 }} type="number" min={0} step="0.01" placeholder="Qty"
                           value={li.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
                    <input style={{ ...S.input, width: 110 }} type="number" min={0} step="0.01" placeholder="Rate"
                           value={li.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} />
                    <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, width: 90, textAlign: 'right' }}>
                      {rupees((parseFloat(li.quantity) || 1) * (parseFloat(li.rate) || 0), form.currency)}
                    </span>
                    {form.lineItems.length > 1 && (
                      <button onClick={() => setF('lineItems', form.lineItems.filter((_, n) => n !== i))}
                              style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 9px', color: '#D99A9A' }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setF('lineItems', [...form.lineItems, blankLine()])}
                        style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', marginTop: 6 }}>
                  Add a line
                </button>
              </div>

              {/* Running total */}
              <div style={totalBox}>
                <div style={totalRow}><span>Taxable value</span><span>{rupees(taxable, form.currency)}</span></div>
                {isDomestic && sameState && (
                  <>
                    <div style={totalRow}><span>CGST @ {rate / 2}%</span><span>{rupees(taxAmount / 2, form.currency)}</span></div>
                    <div style={totalRow}><span>SGST @ {rate / 2}%</span><span>{rupees(taxAmount / 2, form.currency)}</span></div>
                  </>
                )}
                {isDomestic && !sameState && (
                  <div style={totalRow}><span>IGST @ {rate}%</span><span>{rupees(taxAmount, form.currency)}</span></div>
                )}
                {!isDomestic && <div style={totalRow}><span>GST</span><span>0% — export</span></div>}
                <div style={{ ...totalRow, borderTop: `1px solid ${colors.border}`, paddingTop: 8, marginTop: 6, fontSize: 15, color: colors.text }}>
                  <strong>Total</strong><strong>{rupees(taxable + taxAmount, form.currency)}</strong>
                </div>
              </div>

              <div style={{ ...S.formGrid, marginTop: 14 }}>
                <Field label="Payment account (printed on the invoice)">
                  <select style={S.input} value={form.paymentAccountId} onChange={(e) => setF('paymentAccountId', e.target.value)}>
                    <option value="">— none —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
                  </select>
                </Field>
                <Field label="Currency">
                  <input style={S.input} value={form.currency} onChange={(e) => setF('currency', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Notes (optional)">
                  <input style={S.input} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
                </Field>
              </div>

              {form.kind === 'b2b' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontFamily: sans, fontSize: 13, color: colors.muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.reverseCharge} onChange={(e) => setF('reverseCharge', e.target.checked)} />
                  Reverse charge applicable
                </label>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={submit} disabled={busy || !form.recipientName.trim() || taxable <= 0}
                        style={{ ...S.btn, opacity: (busy || !form.recipientName.trim() || taxable <= 0) ? 0.5 : 1 }}>
                  {busy ? 'Creating…' : 'Create invoice'}
                </button>
                <button onClick={() => { setCreating(false); setForm(null); }} style={S.ghostBtn}>Cancel</button>
              </div>
            </Card>
          )}

          {/* List */}
          {list.length === 0 ? (
            <T.muted>{tab === 'b2b' ? 'No tax invoices yet.' : 'No receipts yet.'}</T.muted>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {list.map((inv) => (
                <div key={inv.id} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={S.rowTitle}>{inv.invoice_number} · {inv.recipient_name}</div>
                      <div style={S.rowSub}>
                        {new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {inv.recipient_gstin && ` · ${inv.recipient_gstin}`}
                        {inv.place_of_supply && ` · ${inv.place_of_supply}`}
                        {inv.is_export && ' · export, 0%'}
                      </div>
                      <div style={{ ...S.rowSub, marginTop: 4 }}>
                        Taxable {rupees(inv.taxable_amount, inv.currency)}
                        {Number(inv.cgst_amount) > 0 && ` · CGST ${rupees(inv.cgst_amount, inv.currency)} · SGST ${rupees(inv.sgst_amount, inv.currency)}`}
                        {Number(inv.igst_amount) > 0 && ` · IGST ${rupees(inv.igst_amount, inv.currency)}`}
                        {inv.account_label && ` · to ${inv.account_label}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: sans, fontSize: 17, color: colors.text }}>{rupees(inv.total_amount, inv.currency)}</div>
                      {inv.settled_at ? (
                        <div style={{ fontFamily: sans, fontSize: 11, color: colors.success, marginTop: 3 }}>
                          Settled {new Date(inv.settled_at).toLocaleDateString('en-IN')}
                        </div>
                      ) : inv.receivedGross > 0 ? (
                        <div style={{ fontFamily: sans, fontSize: 11, color: '#D9A45C', marginTop: 3 }}>
                          {rupees(inv.receivedGross, inv.currency)} received
                          {inv.outstanding > 0 && ` · ${rupees(inv.outstanding, inv.currency)} to come`}
                        </div>
                      ) : (
                        <div style={{ fontFamily: sans, fontSize: 11, color: '#D9A45C', marginTop: 3 }}>Nothing received yet</div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                    <button onClick={() => downloadPdf(inv)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                      Download PDF
                    </button>
                    <button onClick={() => setOpenReceipts(openReceipts === inv.id ? null : inv.id)}
                            style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                      {openReceipts === inv.id ? 'Hide payments' : `Payments${inv.receiptCount ? ` · ${inv.receiptCount}` : ''}`}
                    </button>
                  </div>

                  {openReceipts === inv.id && (
                    <ReceiptsPanel invoice={inv} onChanged={loadIssued} />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const lineRow    = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' };
const totalBox   = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, marginTop: 16, maxWidth: 380, marginLeft: 'auto' };
const totalRow   = { display: 'flex', justifyContent: 'space-between', fontFamily: sans, fontSize: 13, color: colors.muted, padding: '3px 0' };
const exportNote = { fontFamily: sans, fontSize: 12, color: '#8FC88F', background: 'rgba(100,160,100,0.08)', border: '1px solid rgba(100,160,100,0.25)', borderRadius: 8, padding: '10px 12px', marginTop: 12, lineHeight: 1.6 };
// ── Payments against one invoice ──────────────────────────────────────────────
//
// An advance and a balance is the ordinary shape of this work, and a foreign
// transfer arrives as a different number from the one that was sent. Three
// figures per payment: what the payer sent, the rate the bank certified, and
// what actually landed. The difference between the second two is what the
// transfer cost -- a real expense that stays invisible unless it is written
// down.
function ReceiptsPanel({ invoice, onChanged }) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = {
    receivedOn: new Date().toISOString().slice(0, 10),
    currency: invoice.currency || 'INR',
    amount: '', exchangeRate: '', amountCreditedInr: '',
    method: '', reference: '', efircNumber: '', note: '',
  };
  const [form, setForm] = useState(blank);

  const load = () => api.get(`/api/studio/invoicing/issued/${invoice.id}/receipts`)
    .then(setData).catch((e) => setError(e.message));

  useEffect(() => { load(); }, [invoice.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const foreign = (form.currency || 'INR').toUpperCase() !== 'INR';

  const gross = foreign
    ? (parseFloat(form.amount) || 0) * (parseFloat(form.exchangeRate) || 0)
    : (parseFloat(form.amount) || 0);
  const credited = form.amountCreditedInr === '' ? gross : parseFloat(form.amountCreditedInr) || 0;
  const charges  = Math.max(0, gross - credited);

  const save = async () => {
    setSaving(true); setError('');
    try {
      if (editing) await api.patch(`/api/studio/invoicing/receipts/${editing}`, form);
      else         await api.post(`/api/studio/invoicing/issued/${invoice.id}/receipts`, form);
      setForm(blank); setEditing(null);
      await load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Remove ${r.receiptNumber || 'this payment'}?`)) return;
    try { await api.delete(`/api/studio/invoicing/receipts/${r.id}`); await load(); onChanged?.(); }
    catch (err) { setError(err.message); }
  };

  const settle = async (reopen) => {
    try {
      await api.post(`/api/studio/invoicing/issued/${invoice.id}/settle`, { reopen });
      await load(); onChanged?.();
    } catch (err) { setError(err.message); }
  };

  if (!data) return <div style={panelBox}><T.muted>Loading payments…</T.muted></div>;

  // Rupees, for figures that genuinely are rupees.
  //
  // What the bank credited and what it took in charges are always INR: the
  // money landed in an Indian account. Those keep this.
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  // And the invoice's own currency, for figures that are not.
  //
  // Invoiced, received and still due are stated in whatever the invoice was
  // raised in. Formatting a two thousand dollar invoice with a rupee sign said
  // ₹2,000 for something worth nearly two lakh.
  const cur = data.currency || 'INR';
  // Received is what landed in the bank, in rupees, however the invoice was
  // written. Invoiced and still due are the invoice's own currency, because
  // that is what was asked for and what remains unasked.
  const own = (n) => (cur === 'INR'
    ? inr(n)
    : `${cur} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  return (
    <div style={panelBox}>
      {error && <div style={{ ...S.error, fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Sum label="Invoiced"  value={own(data.invoiced)} />
        <Sum label="Received"  value={inr(data.totals.gross)} tone={colors.success} />
        <Sum label="Still due" value={own(data.outstanding)} tone={data.outstanding > 0 ? '#D9A45C' : colors.muted} />
        {data.totals.charges > 0 && (
          <Sum label="Bank charges" value={inr(data.totals.charges)} sub="claimable expense" />
        )}
        {data.totals.withheld > 0 && (
          /* Kept apart from charges on purpose. One is a cost of being paid,
             the other is tax already paid on her behalf and claimable against
             Indian tax under the treaty — but only with the certificate. */
          <Sum label="Withheld at source" value={inr(data.totals.withheld)}
               sub="claimable under the treaty" tone="#D9A45C" />
        )}
      </div>

      {data.receipts.map((r) => (
        <div key={r.id} style={receiptRow}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
              {r.currency === 'INR' ? inr(r.amount) : `${r.currency} ${r.amount.toLocaleString('en-IN')}`}
              {r.currency !== 'INR' && (
                <span style={{ color: colors.muted }}>
                  {' '}at {r.exchangeRate} → {inr(r.grossInr)}
                </span>
              )}
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
              {r.receiptNumber} · {new Date(r.receivedOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              {r.method && ` · ${r.method}`}
              {r.reference && ` · ${r.reference}`}
              {r.efircNumber && ` · e-FIRC ${r.efircNumber}`}
            </div>
            {r.chargesInr > 0 && (
              <div style={{ fontFamily: sans, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                {inr(r.creditedInr)} credited
                {r.withheldInCurrency > 0 && (
                  <> · <span style={{ color: '#D9A45C' }}>
                    {cur} {Number(r.withheldInCurrency).toLocaleString('en-IN')} withheld at source
                  </span></>
                )}
                {' · '}{inr(r.chargesInr)} in bank charges
              </div>
            )}
          </div>
          {!data.settledAt && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => { setEditing(r.id); setForm({
                receivedOn: String(r.receivedOn).slice(0, 10), currency: r.currency,
                amount: String(r.amount), exchangeRate: r.exchangeRate ? String(r.exchangeRate) : '',
                amountCreditedInr: String(r.creditedInr), method: r.method || '',
                reference: r.reference || '', efircNumber: r.efircNumber || '', note: r.note || '',
              }); }} style={miniBtn}>Edit</button>
              <button onClick={() => remove(r)} style={{ ...miniBtn, color: '#D99A9A' }}>Remove</button>
            </div>
          )}
        </div>
      ))}

      {data.settledAt ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.success }}>
            Settled — payments are locked.
          </span>
          <button onClick={() => settle(true)} style={miniBtn}>Reopen to correct</button>
        </div>
      ) : (
        <>
          <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '14px 0 8px' }}>
            {editing ? 'Edit this payment' : 'Log a payment'}
          </div>
          <div style={S.formGrid}>
            <Field label="Received on">
              <input style={S.input} type="date" value={form.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} />
            </Field>
            <Field label="Currency">
              <input style={S.input} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            </Field>
            <Field label={`Amount sent${foreign ? ` (${form.currency})` : ''}`}>
              <input style={S.input} type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            </Field>
            {foreign && (
              <Field label="Rate on the e-FIRC">
                <input style={S.input} type="number" step="0.0001" placeholder="INR per unit"
                       value={form.exchangeRate} onChange={(e) => set('exchangeRate', e.target.value)} />
              </Field>
            )}
            {/* What the payer kept back before sending.
                //
                // Meta bills eight hundred dollars and remits less, with the
                // difference gone to the IRS in Jinal's name. Without this it
                // reads as an underpayment, and the withheld amount — which is
                // claimable against Indian tax under the treaty — is lost. */}
            {form.currency !== 'INR' && (
              <Field label={`Withheld at source (${form.currency || 'USD'})`}>
                <input style={S.input} type="number" step="0.01" placeholder="0.00"
                       value={form.withheldInCurrency || ''}
                       onChange={(e) => set('withheldInCurrency', e.target.value)} />
                <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 4 }}>
                  Tax the payer deducted. Leave empty if none.
                </div>
              </Field>
            )}

            <Field label="Credited to the account (INR)">
              <input style={S.input} type="number" step="0.01"
                     placeholder={gross ? String(Math.round(gross * 100) / 100) : ''}
                     value={form.amountCreditedInr} onChange={(e) => set('amountCreditedInr', e.target.value)} />
              <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 4 }}>
                {/* Said out loud, because the difference between what was sent
                    and what arrived is the bank charge, and somebody entering a
                    figure should know what it will be taken to mean. */}
                Whatever is short of the remitted amount is recorded as bank charges.
              </div>
            </Field>
            <Field label="Method">
              <input style={S.input} value={form.method} placeholder="wire, UPI, cheque"
                     onChange={(e) => set('method', e.target.value)} />
            </Field>
            <Field label="Reference">
              <input style={S.input} value={form.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            {foreign && (
              <Field label="e-FIRC number">
                <input style={S.input} value={form.efircNumber} onChange={(e) => set('efircNumber', e.target.value)} />
              </Field>
            )}
          </div>

          {gross > 0 && (
            <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 1.6 }}>
              Counts {own(gross)} against the invoice
              {charges > 0 && <>, with <strong style={{ color: colors.text }}>{inr(charges)}</strong> lost to bank charges</>}.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={saving || !form.amount}
                    style={{ ...S.btn, fontSize: 12, padding: '7px 14px', opacity: (saving || !form.amount) ? 0.5 : 1 }}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add payment'}
            </button>
            {editing && (
              <button onClick={() => { setEditing(null); setForm(blank); }} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
                Cancel
              </button>
            )}
            {data.fullyPaid && (
              <button onClick={() => settle(false)} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px', color: colors.success }}>
                Mark settled
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Sum({ label, value, sub, tone }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 9, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: sans, fontSize: 16, color: tone || colors.text, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontFamily: sans, fontSize: 10, color: colors.muted, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

const panelBox   = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, marginTop: 12 };
const receiptRow = { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', padding: '9px 0', borderBottom: `1px solid ${colors.border}` };
const miniBtn    = { background: 'none', border: 'none', color: colors.muted, fontFamily: sans, fontSize: 11, cursor: 'pointer', padding: 0 };