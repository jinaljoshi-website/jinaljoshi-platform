import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  // Which unlock was interrupted by an empty balance, so it can be resumed.
  const [pendingScope, setPendingScope] = useState(null);
  // A membership purchase interrupted by an empty balance, to be resumed.
  const [pendingJoin,  setPendingJoin]  = useState(false);
  const [joining,      setJoining]      = useState(false);
  const [openSet,   setOpenSet]   = useState(null);

  const { setId } = useParams();
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

  const openViewer = async (set, { silent } = {}) => {
    if (!silent) navigate(`/platform/gallery/${set.id}`, { replace: false });
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

  // Arriving on a link to a particular set opens it, rather than dropping
  // somebody on the grid to go and find what they were sent. Declared here
  // rather than with the other state because it reads allSets and openViewer,
  // and neither exists yet further up.
  useEffect(() => {
    if (!setId || !allSets.length) return;
    if (openSet?.id === setId) return;
    const found = allSets.find((s) => s.id === setId);
    if (found) openViewer(found, { silent: true });
  }, [setId, allSets.length]);

  const closeViewer = () => {
    if (setId) navigate('/platform/gallery', { replace: true });
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
      setPendingScope(null);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        // Remembered so the unlock can finish itself once the tokens land.
        // Without this the fan paid, the modal closed, and the set was still
        // shut — leaving them to work out that they had to ask a second time
        // for the thing they had just bought.
        setPendingScope(scope);
        setTopUp(scope === 'tier' ? openSet.tierPrice : openSet.upsellPrice);
      } else {
        setViewerError(err.message);
      }
    } finally {
      setUnlockingScope(null);
    }
  };

  // The other way in. Tokens open this set; a membership opens it and every
  // other at that level, and keeps doing so. Which call that is — a first
  // purchase, a step up, or a month laid over a longer term — was decided by
  // the server and arrives on the offer, so nothing is worked out here.
  const handleMembership = async () => {
    const offer = openSet?.membershipOffer;
    if (!offer) return;
    setViewerError('');
    setJoining(true);
    const path = offer.route === 'trial'    ? '/api/membership/trial'
               : offer.route === 'purchase' ? '/api/membership/purchase'
               :                              '/api/membership/upgrade';
    const body = offer.route === 'purchase'
      ? { tier: offer.tier, term: 'monthly' }
      : { newTier: offer.tier, term: 'monthly' };
    try {
      await api.post(path, body);
      // The set is not opened here. At the new tier its own portion falls into
      // the allowance and costs nothing, so the refresh alone reveals it —
      // spending an unlock as well would charge for what is now included.
      await refreshOpenSet(openSet.id);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setPendingJoin(true);
        setTopUp(offer.cost);
      } else {
        setViewerError(err.message);
      }
    } finally {
      setJoining(false);
    }
  };

  // Picks the unlock back up after a top-up. The refresh has to come first so
  // the balance the unlock is judged against is the new one.
  const finishAfterTopUp = async () => {
    // A top-up can have been prompted by either an unlock or a membership, and
    // whichever it was has to carry on by itself. Sending the fan back to press
    // the same button again is what the top-up was meant to spare them.
    if (pendingJoin) {
      setPendingJoin(false);
      setTopUp(null);
      await handleMembership();
      return;
    }
    const scope = pendingScope;
    setTopUp(null);
    if (!scope || !openSet) { if (openSet) await refreshOpenSet(openSet.id); return; }
    setUnlockingScope(scope);
    try {
      await api.post('/api/gallery/unlock', { setId: openSet.id, scope });
      await refreshOpenSet(openSet.id);
    } catch (err) {
      // Still short, or something else went wrong. Say so rather than closing
      // silently and leaving the set shut with no explanation.
      setViewerError(err.message === 'INSUFFICIENT_TOKENS'
        ? 'That was not quite enough — top up a little more and it will open.'
        : err.message);
      await refreshOpenSet(openSet.id);
    } finally {
      setUnlockingScope(null);
      setPendingScope(null);
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

        {/* The alternative. Two ways in, side by side, no explanation — the
            tokens open this set, the membership opens this and the rest at that
            level. Shown only where a membership would genuinely help: never on
            a purchase-only set, and never to somebody already at the top. */}
        {(showTierFrame || showUpsellFrame) && openSet.membershipOffer && (
          <button onClick={handleMembership} disabled={joining || !!unlockingScope} style={joinOption}>
            {joining ? 'One moment…' : (
              <>
                {openSet.membershipOffer.tier.charAt(0).toUpperCase() + openSet.membershipOffer.tier.slice(1)}
                {openSet.membershipOffer.route === 'trial' ? ` · ${openSet.membershipOffer.days} days` : ''}
                {' — '}{openSet.membershipOffer.cost} tokens
              </>
            )}
          </button>
        )}

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
          <TopUpModal requiredTokens={topUp}
                      onClose={() => { setTopUp(null); setPendingScope(null); setPendingJoin(false); }}
                      onSuccess={finishAfterTopUp} />
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
        </p>
        {data?.library && (
          <div style={libraryLine}>
            <span style={{ color: C.text }}>
              {data.library.photos.toLocaleString('en-IN')} photos
              {data.library.videos > 0 && ` and ${data.library.videos} video${data.library.videos === 1 ? '' : 's'}`}
              {' '}in {data.library.totalSets} set{data.library.totalSets === 1 ? '' : 's'}
            </span>
            {data.library.totalSets > 0 && (
              <>
                <span style={{ opacity: 0.5 }}> · </span>
                <span>you have opened <strong style={{ color: C.accent }}>{data.library.seenPct}%</strong> of them</span>
              </>
            )}
          </div>
        )}
      </div>

      {data?.isGuest && <GuestNudge message="You're browsing as a guest — members see everything at their level without paying." />}

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          {/insufficient|more tokens|tokens short|balance/i.test(error) && (
            <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up now</button>
          )}
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

      {activeTab !== 'selfies' && data?.openCap > 0 && (
        <div style={capBar}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text }}>
              {data.opensRemaining > 0
                ? <>You can open <b>{data.opensRemaining} more set{data.opensRemaining === 1 ? '' : 's'}</b> at your level
                    {data.opensResetOn && <> before {new Date(data.opensResetOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>}</>
                : <>You've opened all {data.openCap} included sets for this period</>}
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 3 }}>
              {data.opensUsed} of {data.openCap} used · then {data.bands?.band2Cost ?? 1} token
              to {data.bands?.band2Until ?? 30}, {data.bands?.band3Cost ?? 3} tokens
              to {data.bands?.band3Until ?? 50}, full price after that.
              {/* The period runs from the day they joined, not the 1st, so the
                  date is stated rather than implied. */}
              {data.opensResetOn && ` Resets ${new Date(data.opensResetOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`}
            </div>
          </div>
          <div style={capTrack}>
            <div style={{ ...capFill, width: `${Math.min(100, (data.opensUsed / data.openCap) * 100)}%` }} />
          </div>
        </div>
      )}

      {activeTab !== 'selfies' && (
        <HowUnlocking tier={data?.userTier} opensRemaining={data?.opensRemaining} opensUsed={data?.opensUsed} openCap={data?.openCap} bands={data?.bands} />
      )}

      {activeTab !== 'selfies' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <select value={sort}
                  onChange={(e) => { setSort(e.target.value); load(e.target.value); }}
                  style={sortSelect}>
            <option value="newest">Newest first</option>
            <option value="free_for_all">Free for all</option>
            <option value="free_for_me">Free for me</option>
            <option value="locked">Locked media</option>
          </select>
        </div>
      )}

      {activeTab === 'selfies' ? <Selfies /> : activeItems.length === 0 && sort !== 'newest' ? (
        <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
          {sort === 'locked' ? 'Nothing is locked for you — you can already open everything here. '
           : sort === 'free_for_all' ? 'No sets are free to everyone right now. '
           : 'Nothing here is open to you at the moment. '}
          {data?.isGuest ? 'Members see everything at their level without paying.' : 'New sets appear here as Jinal posts them.'}
        </div>
      ) : activeItems.length === 0 ? (
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
                             // Smooths the upscale. The hiding is done by the
                             // image being 24 pixels wide, not by this — so
                             // stripping the CSS reveals nothing.
                             ...(item.coverBlurred ? { filter: 'blur(6px)', transform: 'scale(1.1)' } : {}),
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

const libraryLine = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.7, marginTop: 6 };

const capBar   = { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14 };
const capTrack = { flex: '0 0 120px', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' };
const capFill  = { height: 4, background: C.accent, borderRadius: 2, transition: 'width 0.3s' };

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
// The membership alternative. Deliberately not styled as another locked frame —
// it is the way past the locks, not one of them.
const joinOption = { display: 'block', width: '100%', marginTop: 12, padding: '14px 18px', fontFamily: F.sans, fontSize: 14, color: C.text, cursor: 'pointer', background: 'rgba(193,125,74,0.10)', border: `1px solid ${C.accent}`, borderRadius: 12, textAlign: 'center' };

const unlockFrame = { position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: 'rgba(193,125,74,0.1)', border: `1px dashed ${C.accent}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 10, gap: 6 };
// Blurred hard and scaled up, so no edge of the original is readable and the
// blur cannot be undone by scaling the image back down.
// The image behind an unlock prompt is a 24-pixel version, not the real photo
// with a filter over it. The blur here smooths the upscale; it is not what does
// the hiding, so a reader mode stripping CSS reveals nothing.
const lockedBackdrop = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(8px)', transform: 'scale(1.1)', pointerEvents: 'none' };
const lockedScrim    = { position: 'absolute', inset: 0, background: 'linear-gradient(rgba(20,18,15,0.55), rgba(20,18,15,0.78))', pointerEvents: 'none' };

const unlockFrameIcon = { fontSize: 22, position: 'relative' };
const unlockFrameText = { fontFamily: F.sans, fontSize: 12, color: '#F3EDE4', fontWeight: 600, lineHeight: 1.4, position: 'relative', textShadow: '0 1px 3px rgba(0,0,0,0.6)' };
const unlockFrameSub  = { fontFamily: F.sans, fontSize: 10, color: C.muted, lineHeight: 1.4 , position: 'relative', textShadow: '0 1px 3px rgba(0,0,0,0.6)' };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };