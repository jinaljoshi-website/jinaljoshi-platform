// ps/src/pages/MerchDrop.jsx
// What sits on the Merchandise tab until the first drop opens.
import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';

export default function MerchDrop({ children }) {
  const [drop,    setDrop]    = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/api/shop/drop').then(setDrop).catch(() => setDrop({ active: true }));
  }, []);

  // Until the drop is live the shop grid is not shown at all — an empty grid
  // under a promise reads worse than the promise alone.
  if (!drop)      return <div style={{ ...text, padding: '20px 0' }}>Loading…</div>;
  if (drop.active) return children;

  const toggle = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/api/shop/drop/notify', { leave: drop.onList });
      setDrop((prev) => ({ ...prev, onList: d.onList }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const opens = drop.opensOn
    ? new Date(drop.opensOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={eyebrow}>{drop.label}</div>
      <h2 style={h2}>Something you can actually wear</h2>

      <p style={text}>
        Once a month I'll design one piece. Not a logo slapped on a blank tee — something
        I'd wear myself, and something you can wear on an ordinary Tuesday without
        announcing anything to anyone.
      </p>

      <p style={text}>
        Each one is made in a handful. Yours carries your initials on the sleeve and its
        own number, so you'll know exactly which one of them is yours. The month is marked
        on it. When the month ends, that design is retired and never printed again.
      </p>

      <p style={text}>
        Tees, hoodies, sweatshirts, a few things that aren't clothes. Everything arrives
        in a box with my label inside the collar, a tag, and a note from me.
      </p>

      <div style={rule} />

      <div style={pointsRow}>
        <div style={point}>
          <div style={pointNum}>01</div>
          <div style={pointText}>Your initials, on the sleeve</div>
        </div>
        <div style={point}>
          <div style={pointNum}>02</div>
          <div style={pointText}>Numbered — 03 of 05, and you'll know which is yours</div>
        </div>
        <div style={point}>
          <div style={pointNum}>03</div>
          <div style={pointText}>Retired at the end of the month, for good</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 6 }}>
          {opens ? `Opens ${opens}` : 'Opening soon'}
        </div>
        <p style={{ ...text, fontSize: 13, marginBottom: 14 }}>
          There won't be many. I'll tell you the moment it's live — no announcement anywhere
          else first.
        </p>

        {error && <div style={errorBox}>{error}</div>}

        <button onClick={toggle} disabled={busy}
          style={{ ...(drop.onList ? ghostBtn : primaryBtn), opacity: busy ? 0.5 : 1 }}>
          {busy ? '…' : drop.onList ? "You're on the list · leave" : 'Tell me when it opens'}
        </button>

        {drop.onList && (
          <div style={{ fontFamily: F.sans, fontSize: 12, color: '#8FC88F', marginTop: 10 }}>
            You'll hear first.
            {drop.waiting ? ` ${drop.waiting} others are waiting too.` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

const eyebrow  = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const h2       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(26px,4.5vw,40px)', margin: '0 0 16px', color: C.text, lineHeight: 1.15 };
const text     = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.8, margin: '0 0 16px' };
const rule     = { height: 1, background: C.border, margin: '26px 0' };
const pointsRow = { display: 'grid', gap: 14, marginBottom: 28 };
const point    = { display: 'flex', gap: 14, alignItems: 'baseline' };
const pointNum = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.1em', flexShrink: 0 };
const pointText = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6 };
const card     = { background: C.surface, border: `1px solid rgba(193,125,74,0.3)`, borderRadius: 12, padding: 24 };
const primaryBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 26px', borderRadius: 8, cursor: 'pointer' };
const ghostBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '12px 22px', borderRadius: 8, cursor: 'pointer' };
const errorBox = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontFamily: F.sans, fontSize: 13 };