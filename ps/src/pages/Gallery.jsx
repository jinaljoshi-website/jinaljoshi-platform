import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { bestMemberPrice } from '../data';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

const API = import.meta.env.VITE_API_URL || '';

export default function Gallery() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [topUp,      setTopUp]      = useState(null);
  const [openSet,    setOpenSet]    = useState(null); // set being viewed
  const [setItems,   setSetItems]   = useState([]);
  const [itemsLoad,  setItemsLoad]  = useState(false);
  const [lightbox,   setLightbox]   = useState(null); // index into setItems

  const load = () => api.get('/api/gallery/sets')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const openViewer = async (set) => {
    setOpenSet(set);
    setSetItems([]);
    setItemsLoad(true);
    try {
      const data = await api.get(`/api/gallery/sets/${set.id}/items`);
      setSetItems(data.items || []);
    } catch (err) {
      setError('Failed to load set contents');
    } finally {
      setItemsLoad(false);
    }
  };

  const closeViewer = () => {
    setOpenSet(null);
    setSetItems([]);
    setLightbox(null);
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading gallery…</div>;

  // ── Set viewer ──────────────────────────────────────────────────────────────
  if (openSet) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button onClick={closeViewer} style={backBtn}>← Back</button>
          <div>
            <div style={eyebrow}>Gallery</div>
            <h1 style={{ ...title, fontSize: 'clamp(22px,4vw,36px)', margin: 0 }}>{openSet.title}</h1>
          </div>
        </div>

        {itemsLoad && <div style={{ color: C.muted, fontFamily: F.sans }}>Loading…</div>}

        {!itemsLoad && setItems.length === 0 && (
          <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>No items in this set yet.</div>
        )}

        <div style={viewerGrid}>
          {setItems.map((item, idx) => (
            <div key={item.id} onClick={() => setLightbox(idx)} style={thumbWrap}>
              {item.media_type === 'video' ? (
                <video src={item.media_url} style={thumb} muted />
              ) : (
                <img src={item.media_url} alt="" style={thumb} />
              )}
              {item.media_type === 'video' && (
                <div style={playBadge}>▶</div>
              )}
            </div>
          ))}
        </div>

        {/* Lightbox */}
        {lightbox !== null && (
          <div style={lightboxOverlay} onClick={() => setLightbox(null)}>
            <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} style={closeBtn}>✕</button>
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.max(0, i - 1)); }}
              style={{ ...navBtn, left: 16 }}
              disabled={lightbox === 0}
            >‹</button>
            <div onClick={(e) => e.stopPropagation()} style={lightboxInner}>
              {setItems[lightbox]?.media_type === 'video' ? (
                <video
                  src={setItems[lightbox].media_url}
                  controls
                  autoPlay
                  style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }}
                />
              ) : (
                <img
                  src={setItems[lightbox]?.media_url}
                  alt=""
                  style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }}
                />
              )}
              <div style={{ fontFamily: F.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 10 }}>
                {lightbox + 1} / {setItems.length}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.min(setItems.length - 1, i + 1)); }}
              style={{ ...navBtn, right: 16 }}
              disabled={lightbox === setItems.length - 1}
            >›</button>
          </div>
        )}
      </div>
    );
  }

  // ── Grid view ───────────────────────────────────────────────────────────────
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
            onOpen={openViewer}
          />
        ))}
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

function GalleryCard({ item, userTier, isGuest, discountPct, coinBalance, onError, onTopUp, onUnlocked, onOpen }) {
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked,  setUnlocked]  = useState(!!item.already_unlocked);

  const basePrice  = item.price_coins;
  const isFree     = basePrice === 0;

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
      // Open immediately after unlock
      onOpen({ ...item, already_unlocked: true });
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        onTopUp(displayPrice);
      } else if (err.message === 'Already unlocked') {
        setUnlocked(true);
        onOpen(item);
      } else {
        onError(err.message);
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div style={card}>
      {item.cover_url ? (
        <img
          src={item.cover_url}
          alt={item.title}
          style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6, marginBottom: 12, cursor: unlocked ? 'pointer' : 'default' }}
          onClick={() => unlocked && onOpen(item)}
        />
      ) : (
        <div
          style={{ width: '100%', height: 120, background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: unlocked ? 'pointer' : 'default' }}
          onClick={() => unlocked && onOpen(item)}
        >
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
        <button onClick={() => onOpen(item)} style={{ ...unlockBtn, background: 'rgba(100,160,100,0.15)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', marginTop: 'auto' }}>
          ✓ View set
        </button>
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

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 18 };
const card        = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column' };
const nudge       = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginBottom: 4 };
const unlockBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const backBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const viewerGrid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 };
const thumbWrap   = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: C.surface };
const thumb       = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const playBadge   = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 28, color: 'white', textShadow: '0 2px 8px rgba(0,0,0,0.8)', pointerEvents: 'none' };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
