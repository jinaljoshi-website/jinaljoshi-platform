// ps/src/components/CurrencyPicker.jsx
// Which money a fan reads prices in, and pays in.
//
// Only ever shown to somebody outside India. An Indian card charged in dollars
// is converted back by their own bank at a worse rate plus a forex markup --
// they would pay several percent more for nothing, and the sale is not an
// export anyway. The server refuses it, so offering the choice would mean
// showing a control that gets silently overruled.
//
// Detection is by where they are now, not where they registered. Somebody who
// signed up in Mumbai and opens this in Berlin is offered euros.
import { useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';
import { setDisplayCurrency, tokenRateInr } from '../data';

export default function CurrencyPicker({ state, onChange, compact }) {
  const [open,   setOpen]   = useState(false);
  const [saving, setSaving] = useState(null);

  if (!state?.options?.length) return null;

  const current = state.options.find((o) => o.currency === state.current)
    || state.options[state.options.length - 1];

  const choose = async (option) => {
    if (option.currency === state.current) { setOpen(false); return; }
    setSaving(option.currency);
    try {
      await api.post('/api/coins/currency', { currency: option.currency });
      // Carried across with the option, as in Platform.jsx — without it every
      // price would quote below what the server charges.
      setDisplayCurrency(option.currency === 'INR'
        ? null
        : { ...option, bufferPct: state.bufferPct });
      onChange?.(option.currency);
      setOpen(false);
    } catch { /* the control simply stays as it was */ }
    finally { setSaving(null); }
  };

  // A familiar price in each currency, so the choice is between two things a
  // person can picture rather than two codes.
  const rate = tokenRateInr();
  const sample = (o) => {
    if (!rate) return null;
    const inr = rate * 10;
    if (o.currency === 'INR') return `\u20B9${Math.round(inr)}`;
    if (!o.inrPerUnit) return null;
    const f = Math.pow(10, o.decimals ?? 2);
    return `${o.symbol || o.currency + ' '}${(Math.ceil((inr / o.inrPerUnit) * f) / f).toFixed(o.decimals ?? 2)}`;
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={compact ? pillCompact : pill}>
        {current.symbol?.trim() || current.currency}
        <span style={{ opacity: 0.6, marginLeft: 5, fontSize: 10 }}>{open ? '\u25B4' : '\u25BE'}</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={scrim} />
          <div style={menu}>
            <div style={menuHead}>Show prices in</div>
            {state.options.map((o) => {
              const on = o.currency === state.current;
              return (
                <button key={o.currency} onClick={() => choose(o)} disabled={saving}
                        style={{ ...row, background: on ? 'rgba(193,125,74,0.12)' : 'transparent' }}>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ color: on ? C.accent : C.text }}>
                      {o.symbol?.trim() || ''} {o.label || o.currency}
                    </span>
                    {o.isLocal && (
                      <span style={{ color: C.muted, fontSize: 10, display: 'block', marginTop: 1 }}>
                        your local currency
                      </span>
                    )}
                  </span>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
                    {saving === o.currency ? '…' : sample(o)}
                  </span>
                </button>
              );
            })}
            <div style={foot}>
              You are charged in whichever you pick, at checkout too.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const pill        = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap' };
const pillCompact = { ...pill, fontSize: 12, padding: '4px 10px' };
const scrim       = { position: 'fixed', inset: 0, zIndex: 90 };
const menu        = { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, width: 244, background: '#1A1714', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' };
const menuHead    = { fontFamily: F.mono, fontSize: 9, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '4px 8px 8px' };
const row         = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', border: 'none', borderRadius: 7, padding: '9px 8px', cursor: 'pointer', fontFamily: F.sans, fontSize: 13 };
const foot        = { fontFamily: F.sans, fontSize: 10, color: C.muted, lineHeight: 1.5, padding: '8px 8px 2px', borderTop: `1px solid ${C.border}`, marginTop: 6 };