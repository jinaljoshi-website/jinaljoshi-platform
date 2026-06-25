// studio/src/ui.jsx

const sans    = "'DM Sans', system-ui, sans-serif";
const display = "'Cormorant Garamond', Georgia, serif";
const mono    = "'DM Mono', 'Courier New', monospace";
export const colors = {
  text:    '#F2EBE0',
  muted:   '#9B8F83',
  accent:  '#C17D4A',
  border:  'rgba(242,235,224,0.08)',
  surface: '#161410',
  bg:      '#0D0C0A',
  error:   '#D99A9A',
  success: '#8FC88F',
};

export const T = {
  muted:        ({ children }) => <div style={{ fontFamily: sans, fontSize: 14, color: colors.muted }}>{children}</div>,
  title:        ({ children }) => <h1 style={{ fontFamily: display, fontWeight: 300, fontSize: 'clamp(28px,5vw,48px)', color: colors.text, margin: '0 0 24px' }}>{children}</h1>,
  sectionTitle: ({ children }) => <div style={{ fontFamily: display, fontSize: 22, color: colors.text, marginBottom: 14 }}>{children}</div>,
};

export function Eyebrow({ children }) {
  return <div style={{ fontFamily: mono, fontSize: 11, color: colors.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
}

export function Card({ children, style = {} }) {
  return <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 22, ...style }}>{children}</div>;
}

export function Badge({ tier }) {
  const c = { community: '#C17D4A', insider: '#A8834E', premium: '#8C6B3E', supreme: '#9C5A5A', guest: '#6B6560' };
  return <span style={{ fontFamily: sans, fontSize: 11, color: c[tier] || colors.muted, border: `1px solid ${c[tier] || colors.border}`, borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' }}>{tier || 'guest'}</span>;
}

export function Field({ label, children }) {
  return <div><div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 6 }}>{label}</div>{children}</div>;
}

// Token input with live INR calculator
export function TokenField({ label, value, onChange, tokenRateInr = 66 }) {
  const inr = (parseInt(value) || 0) * tokenRateInr;
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...S.input, width: 100 }}
        />
        <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent, whiteSpace: 'nowrap' }}>
          = ₹{inr.toLocaleString('en-IN')}
        </span>
      </div>
    </Field>
  );
}

export const S = {
  statsRow:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 14, marginBottom: 24 },
  statCard:  { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20 },
  listRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${colors.border}` },
  card:      { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 18 },
  rowTitle:  { fontFamily: sans, fontSize: 14, color: colors.text, marginBottom: 2 },
  rowSub:    { fontFamily: sans, fontSize: 12, color: colors.muted },
  formGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14 },
  input:     { width: '100%', boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid ${colors.border}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontFamily: sans, fontSize: 13, outline: 'none' },
  btn:       { background: colors.accent, border: 'none', color: '#1A1714', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 8, cursor: 'pointer' },
  ghostBtn:  { background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted, fontFamily: sans, fontSize: 13, padding: '9px 16px', borderRadius: 8, cursor: 'pointer' },
  error:     { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 10, borderRadius: 8, marginBottom: 12, fontFamily: sans, fontSize: 13 },
  success:   { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 10, borderRadius: 8, marginBottom: 12, fontFamily: sans, fontSize: 13 },
};