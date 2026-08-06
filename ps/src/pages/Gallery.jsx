import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';
import Clamped from '../components/Clamped';
import Selfies from './Selfies';
import HowUnlocking from '../components/HowUnlocking';
import GuestNudge from '../components/GuestNudge';

const CONTENT_CATEGORIES = [
  { key: 'behind_the_scenes', label: 'Behind-the-Scenes' },
  { key: 'vlog_style',        label: 'Vlog-Style' },
  { key: 'photos_videos',     label: 'Photos & Videos' },
];

// The order fans see. Selfies sits second because it changes daily and is the
// reason to come back — a category that refreshes belongs near the front, not
// buried behind ones that do not.
const TABS = [
  { key: 'photos_videos',     label: 'Photos & Videos'   },
  { key: 'selfies',           label: 'Selfie of the Day' },
  { key: 'behind_the_scenes', label: 'Behind-the-Scenes' },
  { key: 'vlog_style',        label: 'Vlog-Style'        },
  { key: 'all',               label: 'All'               },
  { key: 'unlocked',          label: 'Unlocked Media'    },
];

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
  const [sort, setSort] = useState('newest');

  const [activeTab, setActiveTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((x) => x.key === t) ? t : 'all';
  }); // 'all' | 'selfies' | 'unlocked' | a content-category key

  const load = (s = sort) => api.get(`/api/gallery/sets?sort=${s}`)
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const allSets = data
    ? (data.sets || [...(data.unlockable || []), ...(data.freeForAll || [])])
    : [];
  const unlockedSets = allSets.filter((s) => s.isGenuinelyUnlocked);

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
    const freshData = await api.get(`/api/gallery/sets?sort=${sort}`);
    setData(freshData);
    const updated = (freshData.sets
      || [...(freshData.unlockable || []), ...(freshData.freeForAll || [])]).find((s) => s.id === setId);
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

        {openSet.photographer && (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.08em', marginBottom: 12 }}>
            Photographed by {openSet.photographer}
          </div>
        )}

        <Clamped text={openSet.description} lines={3}
                 style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 600 }} />

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
              {openSet.tierPreviewUrl && (
                <>
                  <img src={openSet.tierPreviewUrl} alt="" aria-hidden style={lockedBackdrop} />
                  <div style={lockedScrim} />
                </>
              )}
              <div style={{ ...unlockFrameIcon, position: 'relative' }}>{openSet.tierLapsed ? '⏳' : '🔒'}</div>
              <div style={unlockFrameText}>
                {unlockingScope === 'tier'
                  ? 'Unlocking…'
                  : openSet.tierPrice === 0
                    ? `Unlock ${openSet.tierPortionCount} more using your credit`
                    : `Unlock ${openSet.tierPortionCount} more for ${openSet.tierPrice} tokens`}
              </div>
              {openSet.tierLapsed ? (
                <div style={unlockFrameSub}>
                  Your membership unlocked this — renew to view again, or tap to unlock permanently
                </div>
              ) : openSet.tierPrice === 0 ? (
                // Said before the credit is spent, not after it lapses. A member
                // who unlocks a dozen sets on their monthly allowance and then
                // lets membership end loses all of them, and until now nothing
                // told them that at the moment it mattered.
                <div style={unlockFrameSub}>
                  Included with your membership · stays available while your membership is active
                </div>
              ) : null}
            </div>
          )}

          {showUpsellFrame && (
            <div onClick={() => !unlockingScope && handleViewerUnlock('upsell')} style={unlockFrame}>
              {openSet.upsellPreviewUrl && (
                <>
                  <img src={openSet.upsellPreviewUrl} alt="" aria-hidden style={lockedBackdrop} />
                  <div style={lockedScrim} />
                </>
              )}
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
  const activeItems = activeTab === 'unlocked'
    ? unlockedSets
    : activeTab === 'all'
      ? allSets
      : allSets.filter((s) => s.category === activeTab);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Exclusive content</div>
        <h1 style={title}>Gallery</h1>
        <p style={text}>
          Photo sets, videos and behind-the-scenes content.
          {data?.openCap > 0 && ` Everything at your level is included — you have opened ${data.opensUsed} of ${data.openCap} sets this month.`}
        </p>
      </div>

      {data?.isGuest && <GuestNudge message="You're browsing as a guest — members unlock more sets each month for free." />}

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up now</button>
        </div>
      )}

      <div style={tabRow}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
                  style={activeTab === t.key ? tabActive : tabInactive}>
            {t.label}
            {t.key === 'unlocked' && unlockedSets.length > 0 && (
              <span style={tabCount}>{unlockedSets.length}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab !== 'selfies' && (
        <HowUnlocking tier={data?.userTier} opensRemaining={data?.opensRemaining} openCap={data?.openCap} overageCost={data?.overageCost} />
      )}

      {activeTab !== 'selfies' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <select value={sort}
                  onChange={(e) => { setSort(e.target.value); load(e.target.value); }}
                  style={sortSelect}>
            <option value="newest">Newest first</option>
            <option value="price_low">Price: low to high</option>
            <option value="price_high">Price: high to low</option>
          </select>
        </div>
      )}

      {activeTab === 'selfies' ? <Selfies /> : activeItems.length === 0 ? (
        <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>
          {activeTab === 'unlocked' ? "You haven't unlocked anything yet — unlocks you pay for with credits or tokens will show up here." : 'No content published yet.'}
        </div>
      ) : (
        <div style={grid}>
          {activeItems.map((item) => {
            const catLabel = CONTENT_CATEGORIES.find((c) => c.key === item.category)?.label;
            return (
              <div key={item.id} onClick={() => openViewer(item)} style={card}>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  {item.cover_url ? (
                    // Blurred when nothing in the set is free and it has not been
                    // unlocked — the cover is the first item, so it would
                    // otherwise be giving away a photo somebody has to pay for.
                    // Clipped by the wrapper and scaled up, so no unblurred edge
                    // shows and the blur cannot be undone by scaling it back.
                    <div style={{ position: 'relative', width: '100%', height: 180, borderRadius: 6, overflow: 'hidden' }}>
                      <img src={item.cover_url} alt={item.title}
                           style={{
                             width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                             ...(item.coverBlurred ? { filter: 'blur(10px)', transform: 'scale(1.14)' } : {}),
                           }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: 120, background: 'rgba(255,255,255,0.03)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Preview</span>
                    </div>
                  )}
                </div>

                {catLabel && (
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    {catLabel}
                  </div>
                )}

                <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 4 }}>{item.title}</div>

                {(item.photoCount > 0 || item.videoCount > 0) && (
                  <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 6 }}>
                    {[
                      item.photoCount > 0 ? `${item.photoCount} photo${item.photoCount === 1 ? '' : 's'}` : null,
                      item.videoCount > 0 ? `${item.videoCount} video${item.videoCount === 1 ? '' : 's'}` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                )}

                {item.photographer && (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.06em', marginBottom: 6 }}>
                    {item.photographer}
                  </div>
                )}

                <Clamped text={item.description} lines={2}
                         style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6 }} />

                <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 'auto' }}>
                  {item.isGenuinelyUnlocked && <span style={{ color: '#8FC88F' }}>✓ Unlocked · </span>}
                  {item.freeCount > 0 && `${item.freeCount} free`}
                  {item.tierPortionCount > 0 && !item.tierUnlocked && `${item.freeCount > 0 ? ' · ' : ''}${item.tierPortionCount} unlockable`}
                  {item.hasUpsell && !item.upsellUnlocked && ` · ${item.upsellPortionCount} exclusive`}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

const sortSelect = { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '7px 12px', borderRadius: 8, outline: 'none', cursor: 'pointer' };

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 18 };
const card        = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', cursor: 'pointer' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const backBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const tabRow = { display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' };
const tabActive = { fontFamily: F.sans, fontSize: 14, fontWeight: 600, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.4)`, color: C.text, padding: '10px 20px', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center' };
const tabInactive = { ...tabActive, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted };
const tabCount = { fontFamily: F.mono, fontSize: 11, color: C.accent, background: 'rgba(193,125,74,0.15)', borderRadius: 999, padding: '2px 8px', marginLeft: 8 };
const viewerGrid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 };
const thumbWrap   = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: C.surface };
const thumb       = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const playBadge   = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 28, color: 'white', textShadow: '0 2px 8px rgba(0,0,0,0.8)', pointerEvents: 'none' };
const unlockFrame = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: 'rgba(193,125,74,0.1)', border: `1px dashed ${C.accent}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 10, gap: 6 };
// Blurred hard and scaled up, so no edge of the original is readable and the
// blur cannot be undone by scaling the image back down.
const lockedBackdrop = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(22px)', transform: 'scale(1.25)', pointerEvents: 'none' };
const lockedScrim    = { position: 'absolute', inset: 0, background: 'linear-gradient(rgba(20,18,15,0.55), rgba(20,18,15,0.78))', pointerEvents: 'none' };

const unlockFrameIcon = { fontSize: 22, position: 'relative' };
const unlockFrameText = { fontFamily: F.sans, fontSize: 12, color: '#F3EDE4', fontWeight: 600, lineHeight: 1.4, position: 'relative', textShadow: '0 1px 3px rgba(0,0,0,0.6)' };
const unlockFrameSub  = { fontFamily: F.sans, fontSize: 10, color: C.muted, lineHeight: 1.4 , position: 'relative', textShadow: '0 1px 3px rgba(0,0,0,0.6)' };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };