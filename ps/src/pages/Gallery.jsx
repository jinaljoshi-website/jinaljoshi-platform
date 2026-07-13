import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import { TIERS } from '../data';
import TopUpModal from '../components/TopUpModal';

export default function Gallery() {
  const navigate    = useNavigate();
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [topUp,     setTopUp]     = useState(null);
  const [openSet,   setOpenSet]   = useState(null);
  const [setItems,  setSetItems]  = useState([]);
  const [itemsLoad, setItemsLoad] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [lightbox,  setLightbox]  = useState(null);
  const [activeTab, setActiveTab] = useState('unlockable');

  const load = () => api.get('/api/gallery/sets')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const openViewer = async (set) => {
    setOpenSet(set);
    setSetItems([]);
    setItemsError('');
    setItemsLoad(true);
    try {
      const data = await api.get(`/api/gallery/sets/${set.id}/items`);
      setSetItems(data.items || []);
    } catch (err) {
      if (err.message === 'LAPSED_MEMBERSHIP') {
        setItemsError("This was unlocked with your membership credit — renew your membership to view it again.");
      } else {
        setItemsError('Failed to load set contents');
      }
    } finally {
      setItemsLoad(false);
    }
  };

  const closeViewer = () => {
    setOpenSet(null);
    setSetItems([]);
    setItemsError('');
    setLightbox(null);
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading gallery…</div>;

  // ── Set viewer ──────────────────────────────────────────────────────────────
  if (openSet) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={closeViewer} style={backBtn}>← Back</button>
          <div>
            <div style={eyebrow}>Gallery</div>
            <h1 style={{ ...title, fontSize: 'clamp(20px,4vw,34px)', margin: 0 }}>{openSet.title}</h1>
          </div>
        </div>

        {openSet.description && (
          <p style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 16, maxWidth: 600 }}>
            {openSet.description}
          </p>
        )}

        {itemsLoad && <div style={{ color: C.muted, fontFamily: F.sans }}>Loading…</div>}

        {itemsError && (
          <div style={lapsedBox}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>🔒</div>
            <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, marginBottom: 14, lineHeight: 1.6 }}>{itemsError}</div>
            <button onClick={() => navigate('/platform/membership')} style={{ ...unlockBtn, width: 'auto', padding: '10px 24px' }}>
              Renew Membership
            </button>
          </div>
        )}

        {!itemsLoad && !itemsError && setItems.length === 0 && (
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
              {item.media_type === 'video' && <div style={playBadge}>▶</div>}
            </div>
          ))}
        </div>

        {lightbox !== null && (
          <div style={lightboxOverlay} onClick={() => setLightbox(null)}>
            <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} style={closeBtn}>✕</button>
            <button onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.max(0, i - 1)); }} style={{ ...navBtn, left: 16 }} disabled={lightbox === 0}>‹</button>
            <div onClick={(e) => e.stopPropagation()} style={lightboxInner}>
              {setItems[lightbox]?.media_type === 'video' ? (
                <video src={setItems[lightbox].media_url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }} />
              ) : (
                <img src={setItems[lightbox]?.media_url} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }} />
              )}
              <div style={{ fontFamily: F.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 10 }}>
                {lightbox + 1} / {setItems.length}
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.min(setItems.length - 1, i + 1)); }} style={{ ...navBtn, right: 16 }} disabled={lightbox === setItems.length - 1}>›</button>
          </div>
        )}
      </div>
    );
  }

  // ── Grid view ───────────────────────────────────────────────────────────────
  const activeItems = activeTab === 'unlockable' ? (data?.unlockable || []) : (data?.freeForAll || []);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Exclusive content</div>
        <h1 style={title}>Gallery</h1>
        <p style={text}>Photo sets, videos and behind-the-scenes content. Every set can be unlocked by anyone.</p>
      </div>

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}

      <div style={tabRow}>
        <button onClick={() => setActiveTab('unlockable')} style={activeTab === 'unlockable' ? tabUnlockableActive : tabUnlockableInactive}>
          <span style={{ marginRight: 6 }}>✨</span>Unlockable Content
          {data?.unlockable?.length > 0 && <span style={tabCount}>{data.unlockable.length}</span>}
        </button>
        <button onClick={() => setActiveTab('free')} style={activeTab === 'free' ? tabFreeActive : tabFreeInactive}>
          Free for All
          {data?.freeForAll?.length > 0 && <span style={tabCountMuted}>{data.freeForAll.length}</span>}
        </button>
      </div>

      {activeItems.length === 0 ? (
        <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>
          {activeTab === 'unlockable' ? 'No unlockable content published yet.' : 'No free content published yet.'}
        </div>
      ) : (
        <div style={grid}>
          {activeItems.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              isGuest={data.isGuest}
              coinBalance={data.coinBalance}
              onError={setError}
              onTopUp={setTopUp}
              onUnlocked={load}
              onOpen={openViewer}
              onRenew={() => navigate('/platform/membership')}
            />
          ))}
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

function GalleryCard({ item, isGuest, coinBalance, onError, onTopUp, onUnlocked, onOpen, onRenew }) {
  const [unlockingScope, setUnlockingScope] = useState(null); // 'tier' | 'upsell' | null

  const canOpen = item.freeCount > 0 || item.tierUnlocked || item.upsellUnlocked;
  const canAffordTier   = coinBalance >= item.tierPrice;
  const canAffordUpsell = coinBalance >= item.upsellPrice;

  const countLabel = [
    item.photoCount > 0 ? `${item.photoCount} photo${item.photoCount === 1 ? '' : 's'}` : null,
    item.videoCount > 0 ? `${item.videoCount} video${item.videoCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  const doUnlock = async (scope) => {
    onError('');
    setUnlockingScope(scope);
    try {
      await api.post('/api/gallery/unlock', { setId: item.id, scope });
      onUnlocked();
      onOpen(item);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        onTopUp(scope === 'tier' ? item.tierPrice : item.upsellPrice);
      } else if (err.message === 'Already unlocked') {
        onOpen(item);
      } else {
        onError(err.message);
      }
    } finally {
      setUnlockingScope(null);
    }
  };

  const isBlurred = !canOpen;

  return (
    <div style={card}>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        {item.cover_url ? (
          <img
            src={item.cover_url}
            alt={item.title}
            style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6, cursor: canOpen ? 'pointer' : 'default', filter: isBlurred ? 'blur(14px)' : 'none', transition: 'filter 0.3s' }}
            onClick={() => canOpen && onOpen(item)}
          />
        ) : (
          <div style={{ width: '100%', height: 120, background: 'rgba(255,255,255,0.03)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canOpen ? 'pointer' : 'default' }} onClick={() => canOpen && onOpen(item)}>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{item.type?.replace('_', ' ')}</span>
          </div>
        )}
        {isBlurred && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(13,12,10,0.35)' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{item.tierLapsed ? '⏳' : '🔒'}</div>
            {item.tierLapsed && <div style={{ fontFamily: F.sans, fontSize: 11, color: 'white', textAlign: 'center', padding: '0 12px' }}>Renew to view again</div>}
          </div>
        )}
      </div>

      <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 4 }}>{item.title}</div>

      {countLabel && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 6 }}>{countLabel}</div>}
      {item.description && <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>{item.description}</div>}
      {item.freeCount > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: '#8FC88F', marginBottom: 8 }}>{item.freeCount} free preview item{item.freeCount === 1 ? '' : 's'}</div>}

      {canOpen && (item.tierUnlocked || item.upsellUnlocked || (item.freeCount > 0 && item.tierPortionCount === 0 && !item.hasUpsell)) && (
        <button onClick={() => onOpen(item)} style={{ ...unlockBtn, background: 'rgba(100,160,100,0.15)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', marginBottom: item.hasUpsell && !item.upsellUnlocked ? 8 : 0 }}>
          ✓ View {item.freeCount > 0 && !item.tierUnlocked ? 'free preview' : 'set'}
        </button>
      )}

      {item.tierLapsed && (
        <div style={{ ...nudge, color: '#D9A45C', borderColor: 'rgba(217,164,92,0.25)', marginBottom: 8 }}>
          Your membership unlocked this — renew to view it again, or unlock it permanently below.
        </div>
      )}

      {(item.tierLapsed || (!item.tierUnlocked && item.tierPortionCount > 0)) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: item.hasUpsell ? 8 : 0 }}>
          {item.tierLapsed && (
            <button onClick={onRenew} style={{ ...unlockBtn, background: 'transparent', border: '1px solid rgba(217,164,92,0.4)', color: '#D9A45C' }}>Renew</button>
          )}
          <button
            onClick={() => doUnlock('tier')}
            disabled={unlockingScope === 'tier' || (!canAffordTier && item.tierPrice > 0)}
            style={{ ...unlockBtn, opacity: (unlockingScope === 'tier' || (!canAffordTier && item.tierPrice > 0)) ? 0.5 : 1 }}
          >
            {unlockingScope === 'tier' ? '…' : item.tierPrice === 0 ? `Unlock with your credit` : `Unlock ${item.tierPortionCount} item${item.tierPortionCount === 1 ? '' : 's'} for ${item.tierPrice}`}
          </button>
        </div>
      )}

      {item.hasUpsell && !item.upsellUnlocked && (
        <>
          <div style={nudge}>
            {isGuest
              ? `Unlock everything in this set for ${item.upsellPrice} tokens.`
              : `${item.upsellPortionCount} item${item.upsellPortionCount === 1 ? '' : 's'} beyond your current tier — unlock for ${item.upsellPrice} tokens.`}
          </div>
          <button
            onClick={() => doUnlock('upsell')}
            disabled={unlockingScope === 'upsell' || !canAffordUpsell}
            style={{ ...unlockBtn, opacity: (unlockingScope === 'upsell' || !canAffordUpsell) ? 0.5 : 1, marginTop: 6 }}
          >
            {unlockingScope === 'upsell' ? 'Unlocking…' : isGuest ? `Unlock all for ${item.upsellPrice}` : `Unlock more for ${item.upsellPrice}`}
          </button>
          {!canAffordUpsell && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: '#D99A9A', marginTop: 6 }}>
              Need {item.upsellPrice - coinBalance} more tokens ·{' '}
              <button onClick={() => onTopUp(item.upsellPrice)} style={{ background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Top up</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 18 };
const card        = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column' };
const nudge       = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginBottom: 4 };
const unlockBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const lapsedBox   = { background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.25)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', marginBottom: 16 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const backBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const tabRow = { display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' };
const tabUnlockableActive = { fontFamily: F.display, fontSize: 17, fontWeight: 500, letterSpacing: '0.01em', background: 'linear-gradient(135deg, rgba(193,125,74,0.18), rgba(193,125,74,0.06))', border: `1px solid ${C.accent}`, color: C.text, padding: '14px 26px', borderRadius: 10, cursor: 'pointer', boxShadow: '0 0 24px rgba(193,125,74,0.15)', display: 'flex', alignItems: 'center' };
const tabUnlockableInactive = { ...tabUnlockableActive, background: 'transparent', boxShadow: 'none', border: `1px solid rgba(193,125,74,0.3)`, color: C.muted };
const tabFreeActive = { fontFamily: F.sans, fontSize: 14, fontWeight: 600, background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '14px 22px', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' };
const tabFreeInactive = { ...tabFreeActive, background: 'transparent', color: C.muted };
const tabCount = { fontFamily: F.mono, fontSize: 11, color: C.accent, background: 'rgba(193,125,74,0.15)', borderRadius: 999, padding: '2px 8px', marginLeft: 8 };
const tabCountMuted = { fontFamily: F.mono, fontSize: 11, color: C.muted, background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: '2px 8px', marginLeft: 8 };
const viewerGrid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 };
const thumbWrap   = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: C.surface };
const thumb       = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const playBadge   = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 28, color: 'white', textShadow: '0 2px 8px rgba(0,0,0,0.8)', pointerEvents: 'none' };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };