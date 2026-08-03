// ps/src/pages/Selfies.jsx
import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';
import { WonderCoinAmount } from '../components/WonderCoin';
import TopUpModal from '../components/TopUpModal';

const dayLabel = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' });

export default function Selfies() {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  const [busy,    setBusy]    = useState(null);
  const [topUp,   setTopUp]   = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = () => api.get('/api/selfies').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const unlock = async (item) => {
    setBusy(item.id); setError('');
    try {
      await api.post(`/api/selfies/${item.id}/unlock`, {});
      load();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') setTopUp(data.unlockCost);
      else setError(err.message);
    } finally { setBusy(null); }
  };

  const buyPass = async () => {
    setBusy('pass'); setError('');
    try {
      const d = await api.post('/api/selfies/pass', {});
      setError('');
      load();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') setTopUp(data.passCost);
      else setError(err.message);
    } finally { setBusy(null); }
  };

  if (!data) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  const locked = data.items.filter((i) => !i.unlocked).length;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Selfie of the day</div>
        <h1 style={title}>One a day</h1>
        <p style={text}>
          Nothing staged, nothing planned. Whatever the day looked like.
        </p>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {data.includedInTier ? (
        <div style={includedBar}>Every selfie is part of your membership.</div>
      ) : data.activePass ? (
        <div style={includedBar}>
          Your pass has {data.activePass.remaining} selfie{data.activePass.remaining === 1 ? '' : 's'} left to run.
        </div>
      ) : (
        <div style={passCard}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 4 }}>
              The next {data.passPosts} selfies
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              {data.passPosts} selfies for {data.passCost} tokens, however long they take to arrive.
              One at a time they would cost {data.passPosts * data.unlockCost}.
            </div>
          </div>
          <button onClick={buyPass} disabled={busy === 'pass'}
                  style={{ ...primaryBtn, opacity: busy === 'pass' ? 0.5 : 1 }}>
            {busy === 'pass' ? '…' : `Get the pass · ${data.passCost}`}
          </button>
        </div>
      )}

      {data.items.length === 0 ? (
        <div style={{ ...text, marginTop: 24 }}>Nothing yet. Check back tomorrow.</div>
      ) : (
        <div style={grid}>
          {data.items.map((item) => (
            <div key={item.id} style={tile}>
              {item.unlocked ? (
                <img src={item.imageUrl} alt="" loading="lazy" onClick={() => setViewing(item)}
                     style={{ ...frame, cursor: 'pointer' }} />
              ) : (
                <div style={{ ...frame, ...lockedFrame }}>
                  <div style={{ fontSize: 22, opacity: 0.5 }}>🔒</div>
                  <button onClick={() => unlock(item)} disabled={busy === item.id}
                          style={{ ...smallBtn, opacity: busy === item.id ? 0.5 : 1 }}>
                    {busy === item.id ? '…' : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        Unlock <WonderCoinAmount amount={data.unlockCost} size={11} fontSize={11} textColor="#1A1714" />
                      </span>
                    )}
                  </button>
                </div>
              )}
              <div style={dateLine}>{dayLabel(item.date)}</div>
              {item.unlocked && item.caption && <div style={captionLine}>{item.caption}</div>}
            </div>
          ))}
        </div>
      )}

      {locked > 0 && !data.activePass && !data.includedInTier && (
        <div style={{ ...text, marginTop: 20, fontSize: 13 }}>
          {locked} still locked. The pass covers the next {data.passPosts} as they're posted.
        </div>
      )}

      {viewing && (
        <div style={overlay} onClick={() => setViewing(null)}>
          <img src={viewing.imageUrl} alt="" style={{ maxWidth: '92vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 8 }} />
          <div style={{ fontFamily: F.sans, fontSize: 13, color: '#B8AFA4', marginTop: 12 }}>
            {dayLabel(viewing.date)}{viewing.caption ? ` · ${viewing.caption}` : ''}
          </div>
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)}
                    onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

const eyebrow  = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title    = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,48px)', margin: '0 0 10px' };
const text     = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 620, margin: 0 };
const includedBar = { fontFamily: F.sans, fontSize: 13, color: '#8FC88F', background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.28)', borderRadius: 8, padding: '11px 14px', marginBottom: 20 };
const passCard = { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', background: C.surface, border: `1px solid rgba(193,125,74,0.3)`, borderRadius: 10, padding: 18, marginBottom: 22 };
const grid     = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 };
const tile     = { display: 'flex', flexDirection: 'column' };
const frame    = { width: '100%', aspectRatio: '4/5', objectFit: 'cover', borderRadius: 8, display: 'block', border: `1px solid ${C.border}` };
const lockedFrame = { background: 'rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 };
const dateLine = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 7 };
const captionLine = { fontFamily: F.sans, fontSize: 12, color: C.text, marginTop: 3, lineHeight: 1.5 };
const primaryBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '11px 20px', borderRadius: 8, cursor: 'pointer' };
const smallBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 6, cursor: 'pointer' };
const errorBox = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 13 };
const overlay  = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.93)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' };