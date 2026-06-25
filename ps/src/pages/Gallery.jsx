import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { bestMemberPrice } from '../data';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

export default function Gallery() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [topUp,   setTopUp]   = useState(null);

  const load = () => api.get('/api/gallery/sets')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading gallery…</div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Exclusive content</div>
        <h1 style={title}>Gallery</h1>
        <p style={text}>
          Photo sets, videos and behind-the-scenes content.
          {data?.isGuest && ' Join a membership for member pricing and unlock credits.'}
        </p>
      </div>

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}

      {(!data?.sets || data.sets.length === 0) && (
        <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>No content published yet. Check back soon.</div>
      )}

      <div style={grid}>
        {data?.sets?.map((item) => (
          <GalleryCard
            key={item.id}
            item={item}
            userTier={data.userTier}
            isGuest={data.isGuest}
            discountPct={data.discountPct}
            coinBalance={data.coinBalance}
            onError={setError}
            onTopUp={setTopUp}
            onUnlocked={load}
          />
        ))}
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

function GalleryCard({ item, userTier, isGuest, discountPct, coinBalance, onError, onTopUp, onUnlocked }) {
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked,  setUnlocked]  = useState(!!item.already_unlocked);

  const basePrice   = item.price_coins;
  const isFree      = basePrice === 0;

  // Calculate display price
  let displayPrice = basePrice;
  if (isGuest) {
    displayPrice = isFree ? 5 : basePrice * 2;
  } else if (discountPct && basePrice > 0) {
    const raw = basePrice * (1 - discountPct / 100);
    displayPrice = raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
  }

  const nudgePrice = isFree ? 0 : bestMemberPrice(basePrice);
  const canAfford  = coinBalance >= displayPrice;

  const handleUnlock = async () => {
    onError('');
    setUnlocking(true);
    try {
      await api.post('/api/gallery/unlock', { setId: item.id });
      setUnlocked(true);
      onUnlocked();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        onTopUp(displayPrice);
      } else if (err.message === 'Already unlocked') {
        setUnlocked(true);
      } else {
        onError(err.message);
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div style={card}>
      {/* Cover image placeholder */}
      {item.cover_key && (
        <img src={item.cover_key} alt={item.title} style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 6, marginBottom: 12 }} />
      )}
      {!item.cover_key && (
        <div style={{ width: '100%', height: 100, background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{item.type?.replace('_', ' ')}</span>
        </div>
      )}

      <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 6 }}>{item.title}</div>
      {item.min_tier && item.min_tier !== 'none' && (
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 8, textTransform: 'capitalize' }}>
          {item.min_tier}+ membership required
        </div>
      )}

      {unlocked ? (
        <div style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F', padding: '10px 0' }}>✓ Unlocked — tap to view</div>
      ) : (
        <>
          <div style={{ marginBottom: 6 }}>
            {isFree && !isGuest
              ? <span style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F' }}>Free for members</span>
              : <WonderCoinAmount amount={displayPrice} size={18} />
            }
          </div>

          {item.use_unlock_credit && !isGuest && !isFree && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 4 }}>
              Monthly unlock credit may apply
            </div>
          )}

          {isGuest && !isFree && (
            <div style={nudge}>
              Members get this for <strong style={{ color: C.accent }}>{nudgePrice}</strong> tokens with Supreme
            </div>
          )}

          {!isGuest && discountPct > 0 && !isFree && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 4 }}>{discountPct}% member discount applied</div>
          )}

          {!canAfford && displayPrice > 0 && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: '#D99A9A', marginBottom: 6 }}>
              Need {displayPrice - coinBalance} more tokens ·{' '}
              <button onClick={() => onTopUp(displayPrice)} style={{ background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Top up</button>
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={unlocking || (!canAfford && displayPrice > 0)}
            style={{ ...unlockBtn, opacity: (unlocking || (!canAfford && displayPrice > 0)) ? 0.5 : 1, marginTop: 8 }}
          >
            {unlocking ? 'Unlocking…' : isFree && !isGuest ? 'View' : 'Unlock'}
          </button>
        </>
      )}
    </div>
  );
}

const eyebrow    = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title      = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text       = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid       = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 18 };
const card       = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column' };
const nudge      = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginBottom: 4 };
const unlockBtn  = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const errorBox   = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };