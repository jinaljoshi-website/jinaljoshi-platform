import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

export default function Extras() {
  const [data,       setData]       = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [details,    setDetails]    = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState([]);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [topUp,      setTopUp]      = useState(null);

  const load = () => Promise.all([
    api.get('/api/extras/options'),
    api.get('/api/extras/my-requests'),
  ]).then(([optData, reqData]) => {
    setData(optData);
    setMyRequests(reqData.requests || []);
  }).catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  const canAfford = selected ? (data?.coinBalance || 0) >= selected.coinsPerRequest : true;

  const handleSubmit = async () => {
    if (!selected || !details.trim() || !canAfford) return;
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const res = await api.post('/api/extras/request', {
        extraItemId: selected.id,
        details: details.trim(),
        referenceUrl: referenceUrl.trim() || null,
      });
      setSubmitted((prev) => [...prev, selected.id]);
      setSuccess(res.message || `Request for "${selected.title}" sent. Jinal will review and confirm.`);
      setSelected(null); setDetails(''); setReferenceUrl('');
      load();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(selected.coinsPerRequest);
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
        <p style={text}>Birthday greetings, anniversary messages, shoutouts and more.{data?.isGuest && ' Members get up to 20% off.'}</p>
      </div>

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(selected ? selected.coinsPerRequest : 0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}
      {success && <div style={successBox}>{success}</div>}

      <div style={grid}>
        {data?.options?.map((option) => {
          const isSelected = selected?.id === option.id;
          const isDone     = submitted.includes(option.id);

          return (
            <div key={option.id} onClick={() => !isDone && setSelected(isSelected ? null : option)} style={{ ...card, border: isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`, cursor: isDone ? 'default' : 'pointer', opacity: isDone ? 0.6 : 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 6 }}>{option.title}</div>
              <div style={{ marginBottom: 6 }}><WonderCoinAmount amount={option.coinsPerRequest} size={18} /></div>
              {!data?.isGuest && data?.discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 4 }}>{data.discountPct}% member discount applied</div>}
              {isDone && <div style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F', marginTop: 8 }}>✓ Request sent</div>}
              {isSelected && !isDone && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 8 }}>✓ Selected — fill in details below</div>}
            </div>
          );
        })}
      </div>

      {selected && (
        <div style={detailsPanel}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 6 }}>{selected.title}</div>

          <div style={fieldLabel}>Describe your request</div>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Tell Jinal what you'd like: names, dates, occasion, any special message." style={detailsInput} rows={4} />

          <div style={fieldLabel}>Any reference URLs (optional)</div>
          <input
            value={referenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
            placeholder="e.g. a link to a look, photo, or style you have in mind"
            style={urlInput}
          />

          <div style={totalRow}>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Total</span>
            <WonderCoinAmount amount={selected.coinsPerRequest} size={20} fontSize={22} textColor={canAfford ? C.text : '#D99A9A'} />
          </div>

          {!canAfford && (
            <div style={{ ...errorBox, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>You need {selected.coinsPerRequest - (data?.coinBalance || 0)} more tokens.</span>
              <button onClick={() => setTopUp(selected.coinsPerRequest)} style={inlineTopUp}>Top up now</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || !details.trim() || !canAfford}
              style={{ ...submitBtn, opacity: (submitting || !details.trim() || !canAfford) ? 0.5 : 1, cursor: (submitting || !details.trim() || !canAfford) ? 'default' : 'pointer' }}
            >
              {submitting ? 'Sending…' : !canAfford ? 'Insufficient balance' : 'Send request'}
            </button>
            <button onClick={() => { setSelected(null); setDetails(''); setReferenceUrl(''); }} style={cancelBtn}>Cancel</button>
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
            Tokens are charged when you send the request. All requests are reviewed and fulfilled by Jinal personally. If declined, your tokens are refunded automatically.
          </div>
        </div>
      )}

      {myRequests.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 14 }}>Your requests</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {myRequests.map((r) => (
              <div key={r.id} style={historyCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, fontWeight: 600 }}>{r.type}</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {r.coins_charged} tokens · {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontFamily: F.sans, fontSize: 12, color: statusColor(r.status), textTransform: 'capitalize' }}>{r.status}</span>
                </div>
                {r.status === 'rejected' && r.rejection_reason && (
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A', background: 'rgba(156,90,90,0.08)', border: '1px solid rgba(156,90,90,0.25)', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>
                    Declined by Jinal: {r.rejection_reason}. Your {r.coins_charged} tokens have been refunded.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); setError(''); load(); }} />
      )}
    </div>
  );
}

function statusColor(status) {
  if (status === 'completed')  return '#8FC88F';
  if (status === 'rejected')   return '#D99A9A';
  if (status === 'confirmed')  return '#C17D4A';
  return '#9B8F83';
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 16 };
const card        = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column', transition: 'border 0.15s' };
const historyCard = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 };
const detailsPanel = { background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 24, marginTop: 8 };
const fieldLabel  = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 8, marginTop: 16 };
const detailsInput = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '12px 14px', borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6 };
const urlInput    = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '12px 14px', borderRadius: 8, outline: 'none' };
const totalRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, margin: '20px 0 16px' };
const submitBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 8, flexGrow: 1 };
const cancelBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 14, padding: '12px 20px', borderRadius: 8, cursor: 'pointer' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const successBox  = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };