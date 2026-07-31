// studio/src/sections/Invoices.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

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
  const [payRef,   setPayRef]   = useState({});

  const [form, setForm] = useState(null);

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

  const togglePaid = async (inv) => {
    setError('');
    try {
      await api.post(`/api/studio/invoicing/issued/${inv.id}/paid`, {
        reference: payRef[inv.id]?.trim() || undefined,
        unpay: !!inv.paid_at,
      });
      loadIssued();
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
          { key: 'manual',   label: 'Manual receipts' },
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
          {platform.months.length === 0 ? <T.muted>No token sales yet.</T.muted> : platform.months.map((m) => (
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
              {totals && (
                <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>
                  {rupees(totals.total)} invoiced
                  {totals.unpaid > 0 && <span style={{ color: '#D9A45C' }}> · {rupees(totals.unpaid)} unpaid</span>}
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

              {!isDomestic && (
                <div style={exportNote}>
                  Outside India — this will be raised as a zero-rated export under LUT, with no GST.
                  Choose a foreign-currency account below so the client can pay.
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
                      {inv.paid_at
                        ? <div style={{ fontFamily: sans, fontSize: 11, color: colors.success, marginTop: 3 }}>
                            Paid {new Date(inv.paid_at).toLocaleDateString('en-IN')}{inv.payment_reference ? ` · ${inv.payment_reference}` : ''}
                          </div>
                        : <div style={{ fontFamily: sans, fontSize: 11, color: '#D9A45C', marginTop: 3 }}>Unpaid</div>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                    <button onClick={() => downloadPdf(inv)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                      Download PDF
                    </button>
                    {!inv.paid_at && (
                      <input value={payRef[inv.id] || ''} onChange={(e) => setPayRef({ ...payRef, [inv.id]: e.target.value })}
                             placeholder="Payment reference"
                             style={{ ...S.input, width: 160, padding: '5px 10px', fontSize: 11 }} />
                    )}
                    <button onClick={() => togglePaid(inv)}
                            style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: inv.paid_at ? colors.muted : colors.success }}>
                      {inv.paid_at ? 'Mark unpaid' : 'Mark paid'}
                    </button>
                  </div>
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