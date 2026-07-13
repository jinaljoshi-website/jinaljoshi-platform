import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
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
  const [lightbox,  setLightbox]  = useState(null);
  const [unlockingScope, setUnlockingScope] = useState(null);
  const [viewerError, setViewerError] = useState('');

  const load = () => api.get('/api/gallery/sets')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const allSets = data ? [...(data.unlockable || []), ...(data.freeForAll || [])] : [];

  const findSetById = (list, id) => list.find((s) => s.id === id);

  const openViewer = async (set) => {
    setOpenSet(set);
    setSetItems([]);
    setViewerError('');
    setItemsLoad(true);
    try {
      const itemsData = await api.get(`/api/gallery/sets/${set.id}/items`);
      setSetItems(itemsData.items || []);
    } catch (err) {
      setViewerError('Failed to load set contents');
    } finally {
      setItemsLoad(false);
    }
  };

  const closeViewer = () => {
    setOpenSet(null);
    setSetItems([]);
    setViewerError('');
    setLightbox(null);
  };

  const refreshOpenSet = async (setId) => {
    const freshData = await api.get('/api/gallery/sets');
    setData(freshData);
    const updated = findSetById([...(freshData.unlockable || []), ...(freshData.freeForAll || [])], setId);
    if (updated) setOpenSet(updated);
    const itemsData = await api.get(`/api/gallery/sets/${setId}/items`);
    setSetItems(itemsData.items || []);
  };

  const handleViewerUnlock = async (scope) => {
    setViewerError('');
    setUnlockingScope(scope);
    try {
      await api.post('/api/gallery/unlock', { setId: openSet.id, scope });
      await refreshOpenSet(openSet.id);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(scope === 'tier' ? openSet.tierPrice : openSet.upsellPrice);
      } else {
        setViewerError(err.message);
      }
    } finally {
      setUnlockingScope(null);
    }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading gallery…</div>;

  // ── Set viewer ──────────────────────────────────────────────────────────────
  if (openSet) {
    const showTierFrame   = openSet.tierPortionCount > 0 && !openSet.tierUnlocked;
    const showUpsellFrame = (openSet.tierPortionCount === 0 || openSet.tierUnlocked) && openSet.hasUpsell && !openSet.upsellUnlocked;

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

        {viewerError && <div style={{ ...errorBox, marginBottom: 16 }}>{viewerError}</div>}

        {itemsLoad && <div style={{ color: C.muted, fontFamily: F.sans }}>Loading…</div>}

        {!itemsLoad && setItems.length === 0 && !showTierFrame && !showUpsellFrame && (
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

          {showTierFrame && (
            <div onClick={() => !unlockingScope && handleViewerUnlock('tier')} style={unlockFrame}>
              <div style={unlockFrameIcon}>{openSet.tierLapsed ? '⏳' : '🔒'}</div>
              <div style={unlockFrameText}>
                {unlockingScope === 'tier'
                  ? 'Unlocking…'
                  : openSet.tierPrice === 0
                    ? `Unlock ${openSet.tierPortionCount} more using your credit`
                    : `Unlock ${openSet.tierPortionCount} more for ${openSet.tierPrice} tokens`}
              </div>
              {openSet.tierLapsed && (
                <div style={unlockFrameSub}>
                  Your membership unlocked this — renew to view again, or tap to unlock permanently
                </div>
              )}
            </div>
          )}

          {showUpsellFrame && (
            <div onClick={() => !unlockingScope && handleViewerUnlock('upsell')} style={unlockFrame}>
              <div style={unlockFrameIcon}>🔒</div>
              <div style={unlockFrameText}>
                {unlockingScope === 'upsell'
                  ? 'Unlocking…'
                  : `Unlock ${openSet.upsellPortionCount} more for ${openSet.upsellPrice} tokens`}
              </div>
            </div>
          )}
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

        {topUp !== null && (
          <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); refreshOpenSet(openSet.id); }} />
        )}
      </div>
    );
  }

  // ── Grid view ───────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Exclusive content</div>
        <h1 style={title}>Gallery</h1>
        <p style={text}>
          Photo sets, videos and behind-the-scenes content.
          {data?.creditsMax > 0 && ` You have ${data.creditsRemaining} of ${data.creditsMax} free unlocks left this month.`}
        </p>
      </div>

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}

      {allSets.length === 0 ? (
        <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>No content published yet.</div>
      ) : (
        <div style={grid}>
          {allSets.map((item) => (
            <div key={item.id} onClick={() => openViewer(item)} style={card}>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                {item.cover_url ? (
                  <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6 }} />
                ) : (
                  <div style={{ width: '100%', height: 120, background: 'rgba(255,255,255,0.03)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Preview</span>
                  </div>
                )}
              </div>

              <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 4 }}>{item.title}</div>

              {(item.photoCount > 0 || item.videoCount > 0) && (
                <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 6 }}>
                  {[
                    item.photoCount > 0 ? `${item.photoCount} photo${item.photoCount === 1 ? '' : 's'}` : null,
                    item.videoCount > 0 ? `${item.videoCount} video${item.videoCount === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              )}

              {item.description && (
                <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>{item.description}</div>
              )}

              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 'auto' }}>
                {item.freeCount > 0 && `${item.freeCount} free`}
                {item.tierPortionCount > 0 && !item.tierUnlocked && `${item.freeCount > 0 ? ' · ' : ''}${item.tierPortionCount} unlockable`}
                {item.hasUpsell && ` · ${item.upsellPortionCount} exclusive`}
              </div>
            </div>
          ))}
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 18 };
const card        = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', cursor: 'pointer' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const backBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const viewerGrid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 };
const thumbWrap   = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: C.surface };
const thumb       = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const playBadge   = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 28, color: 'white', textShadow: '0 2px 8px rgba(0,0,0,0.8)', pointerEvents: 'none' };
const unlockFrame = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: 'rgba(193,125,74,0.1)', border: `1px dashed ${C.accent}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 10, gap: 6 };
const unlockFrameIcon = { fontSize: 22 };
const unlockFrameText = { fontFamily: F.sans, fontSize: 12, color: C.text, fontWeight: 600, lineHeight: 1.4 };
const unlockFrameSub  = { fontFamily: F.sans, fontSize: 10, color: C.muted, lineHeight: 1.4 };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };