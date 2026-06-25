import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { EXTRA_OPTIONS, applyDiscount, guestPrice, bestMemberPrice, TIERS } from '../data';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

export default function Extras() {
  const [membership, setMembership] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [details,    setDetails]    = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState([]);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [topUp,      setTopUp]      = useState(null);

  useEffect(() => {
    api.get('/api/membership/status')
      .then(setMembership)
      .catch(() => setMembership({ tier: 'guest', isActive: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  const userTier    = membership?.isActive ? membership.tier : 'guest';
  const isGuest     = userTier === 'guest';
  const discountPct = TIERS[userTier]?.discountPct || 0;
  const priceFor    = (base) => isGuest ? guestPrice(base) : applyDiscount(base, discountPct);

  const handleSubmit = async () => {
    if (!selected || !details.trim()) return;
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 800));
      setSubmitted((prev) => [...prev, selected.id]);
      setSuccess(`Request for "${selected.title}" sent. Jinal will review and confirm.`);
      setSelected(null); setDetails('');
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(priceFor(selected.price));
      } else {
        setError(err.message);
      }
    } finally { setSubmitting(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Custom requests</div>
        <h1 style={title}>Personalised extras</h1>
        <p style={text}>Birthday greetings, anniversary messages, shoutouts and more.{isGuest && ' Members get up to 20% off.'}</p>
      </div>

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(selected ? priceFor(selected.price) : 0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}
      {success && <div style={successBox}>{success}</div>}

      <div style={grid}>
        {EXTRA_OPTIONS.map((option) => {
          const displayPrice = priceFor(option.price);
          const nudgePrice   = bestMemberPrice(option.price);
          const isSelected   = selected?.id === option.id;
          const isDone       = submitted.includes(option.id);

          return (
            <div key={option.id} onClick={() => !isDone && setSelected(isSelected ? null : option)} style={{ ...card, border: isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`, cursor: isDone ? 'default' : 'pointer', opacity: isDone ? 0.6 : 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 6 }}>{option.title}</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12, flexGrow: 1 }}>{option.description}</div>
              <div style={{ marginBottom: 6 }}><WonderCoinAmount amount={displayPrice} size={18} /></div>
              {!isGuest && discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 4 }}>{discountPct}% member discount</div>}
              {isGuest && <div style={nudge}>Members pay <strong style={{ color: C.accent }}>{nudgePrice}</strong> tokens with Supreme</div>}
              {isDone && <div style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F', marginTop: 8 }}>✓ Request sent</div>}
              {isSelected && !isDone && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 8 }}>✓ Selected — fill in details below</div>}
            </div>
          );
        })}
      </div>

      {selected && (
        <div style={detailsPanel}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 6 }}>{selected.title}</div>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 16 }}>{selected.description}</div>
          <div style={fieldLabel}>Your request details</div>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Tell Jinal what you'd like — names, dates, occasion, any special message…" style={detailsInput} rows={4} />
          <div style={totalRow}>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Total</span>
            <WonderCoinAmount amount={priceFor(selected.price)} size={20} fontSize={22} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSubmit} disabled={submitting || !details.trim()} style={{ ...submitBtn, opacity: (submitting || !details.trim()) ? 0.5 : 1, cursor: (submitting || !details.trim()) ? 'default' : 'pointer' }}>
              {submitting ? 'Sending…' : 'Send request'}
            </button>
            <button onClick={() => { setSelected(null); setDetails(''); }} style={cancelBtn}>Cancel</button>
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
            Tokens are charged only after Jinal confirms and fulfils the request.
          </div>
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); setError(''); }} />
      )}
    </div>
  );
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 16 };
const card        = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column', transition: 'border 0.15s' };
const nudge       = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginTop: 4 };
const detailsPanel = { background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 24, marginTop: 8 };
const fieldLabel  = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 8 };
const detailsInput = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '12px 14px', borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6, marginBottom: 16 };
const totalRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 16 };
const submitBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 8, flexGrow: 1 };
const cancelBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 14, padding: '12px 20px', borderRadius: 8, cursor: 'pointer' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const successBox  = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };