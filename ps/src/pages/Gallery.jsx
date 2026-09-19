import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { C, F } from '../tokens';
import { api } from '../api';
import { track } from '../lib/traffic';
import TopUpModal from '../components/TopUpModal';
import Clamped from '../components/Clamped';
import Selfies from './Selfies';
import HowUnlocking from '../components/HowUnlocking';
import GuestNudge from '../components/GuestNudge';

const CONTENT_CATEGORIES = [
  { key: 'behind_the_scenes', label: 'Behind-the-Scenes' },
  { key: 'fit_check',         label: 'Fit Check — Vote Now' },
  { key: 'photos_videos',     label: 'Photos & Videos' },
];

// The order fans see. Selfies sits second because it changes daily and is the
// reason to come back — a category that refreshes belongs near the front, not
// buried behind ones that do not.
const TABS = [
  { key: 'photos_videos',     label: 'Photos & Videos'   },
  { key: 'selfies',           label: 'Selfie of the Day' },
  { key: 'behind_the_scenes', label: 'Behind-the-Scenes' },
  { key: 'fit_check',         label: 'Fit Check — Vote Now' },
  { key: 'all',               label: 'All'               },
  { key: 'unlocked',          label: 'Unlocked Media'    },
];


// How long is left, in words. "Closes at 14:32" asks somebody to work out how
// long that is; "4 hours left" does not.
function closesIn(at) {
  const mins = Math.round((new Date(at).getTime() - Date.now()) / 60000);
  if (mins <= 0)  return 'closing now';
  if (mins < 60)  return `${mins} minutes left`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} left`;
}

// The result, once voting has closed.
//
// A bar rather than two numbers, because the split is the interesting part and
// a reader should not have to do the arithmetic. The winning side is named in
// words as well, since a bar alone leaves somebody squinting at which is longer.
function FitResult({ keep, ret, yours }) {
  const total = (keep || 0) + (ret || 0);
  if (!total) {
    return (
      <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
        Voting has closed and nobody weighed in. It stays, then.
      </div>
    );
  }
  const keepPct = Math.round((keep / total) * 100);
  // Softer than it was, to match the buttons. "Back it goes" answered a vote
  // about whether to return a garment; these are answering whether a look
  // worked, which is a gentler question and deserves a gentler answer.
  const verdict = keep > ret ? 'Slaying it, apparently.'
                : keep < ret ? 'Could be better, you reckon.'
                :              'A dead heat — I will decide.';

  return (
    <div>
      <div style={{ fontFamily: F.sans, fontSize: 15, color: C.text, marginBottom: 12, fontWeight: 500 }}>
        {verdict}
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden',
                    background: 'rgba(255,255,255,0.06)', marginBottom: 8 }}>
        <div style={{ width: `${keepPct}%`, background: '#8FC88F' }} />
        <div style={{ width: `${100 - keepPct}%`, background: '#D99A9A' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 11, color: C.muted }}>
        <span style={{ color: '#8FC88F' }}>Slaying it · {keep}</span>
        <span>{total} {total === 1 ? 'vote' : 'votes'}</span>
        <span style={{ color: '#D99A9A' }}>{ret} · Could be better</span>
      </div>
      {yours && (
        <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 10 }}>
          You said {yours === 'keep' ? 'slaying it' : 'it could be better'}.
        </div>
      )}
    </div>
  );
}

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
  const [fitCheck,  setFitCheck]  = useState(null);
  const [voting,    setVoting]    = useState(false);
  const [confirming, setConfirming] = useState(null);

  // Totalled from the photographs rather than asked for separately: the counts
  // arrive with them already, and a second request would only be a chance for
  // the two numbers to disagree.
  // Liking, shown before the server has agreed.
  //
  // A heart that waits for a round trip feels broken on a slow connection, so
  // the tile changes at once and is corrected from the response. The server is
  // the authority on the count; this is only about the wait.
  const toggleLike = async (itemId) => {
    setSetItems((prev) => prev.map((i) => i.id === itemId
      ? { ...i, likedByMe: !i.likedByMe, likes: (i.likes || 0) + (i.likedByMe ? -1 : 1) }
      : i));
    try {
      const d = await api.post(`/api/gallery/items/${itemId}/like`);
      setSetItems((prev) => prev.map((i) => i.id === itemId
        ? { ...i, likedByMe: d.liked, likes: d.likes } : i));
    } catch {
      // Put it back. A heart that stays filled after a failed request is a lie
      // that persists until the page is reloaded.
      setSetItems((prev) => prev.map((i) => i.id === itemId
        ? { ...i, likedByMe: !i.likedByMe, likes: (i.likes || 0) + (i.likedByMe ? -1 : 1) }
        : i));
    }
  };

  const castVote = async (verdict) => {
    if (!openSet?.id || voting) return;
    setVoting(true);
    try {
      const d = await api.post(`/api/gallery/sets/${openSet.id}/fit-vote`, { verdict });
      // The tally comes back but is not shown while voting is open. Kept so the
      // result is already there the moment it closes.
      setFitCheck((f) => ({ ...f, yours: d.yours, keep: d.keep, return: d.return }));
    } catch (err) {
      if (err.code === 'VOTING_CLOSED') setFitCheck((f) => ({ ...f, open: false }));
    } finally { setVoting(false); }
  };

  const setViews = setItems.reduce((a, i) => a + (i.views || 0), 0);
  const setLikes = setItems.reduce((a, i) => a + (i.likes || 0), 0);
  // One seed per opening of a set. The server shuffles from it, so every fetch
  // while the set is open returns the same order — refreshing after an unlock
  // does not rearrange the photographs somebody is part-way through. Opening
  // the set again makes a new one, and the set reads differently.
  const seedRef = useRef(null);
  const [itemsLoad, setItemsLoad] = useState(false);
  const [lightbox,  setLightbox]  = useState(null);
  const [unlockingScope, setUnlockingScope] = useState(null);
  const [viewerError, setViewerError] = useState('');
  const [sort, setSort] = useState('newest');

  const [mediaFilter, setMediaFilter] = useState('all');
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
    setSetItems([]); setFitCheck(null);
    setViewerError('');
    setItemsLoad(true);
    seedRef.current = Math.random().toString(36).slice(2, 12);
    // A locked set looked at. How often one is opened before it is bought says
    // more about whether the price is right than the sales figure does.
    if (!set.isGenuinelyUnlocked) track('set_preview', { set: set.id, price: set.tierPrice });
    try {
      const itemsData = await api.get(`/api/gallery/sets/${set.id}/items?seed=${seedRef.current}`);
      setSetItems(itemsData.items || []);
      setFitCheck(itemsData.fitCheck || null);

      // Recorded once the set is open and the photographs are on screen.
      //
      // Sent as one batch rather than a request per photograph, and never
      // awaited: this is information about the pictures, and it must not stand
      // between somebody and looking at them. A failure loses a count, which is
      // the right thing to lose.
      const seen = (itemsData.items || []).map((i) => i.id);
      if (seen.length) {
        api.post('/api/gallery/items/viewed', { itemIds: seen }).catch(() => {});
      }
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
    setSetItems([]); setFitCheck(null);
    setViewerError('');
    setLightbox(null);
  };

  const refreshOpenSet = async (setId) => {
    const freshData = await api.get(`/api/gallery/sets?sort=${sort}`);
    setData(freshData);
    const updated = (freshData.sets
      || [...(freshData.unlockable || []), ...(freshData.freeForAll || [])]).find((s) => s.id === setId);
    if (updated) setOpenSet(updated);
    // The same seed the set was opened with, so what was already on screen does
    // not move when more is unlocked. The new photographs arrive in their own
    // band, shuffled among themselves — bands keep their places, which is what
    // shuffling within a tier means.
    const itemsData = await api.get(`/api/gallery/sets/${setId}/items?seed=${seedRef.current || ''}`);
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
      if (err.code === 'INSUFFICIENT_TOKENS') {
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
      if (err.code === 'INSUFFICIENT_TOKENS') {
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
      setViewerError(err.code === 'INSUFFICIENT_TOKENS'
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

        {/* What the set has drawn.
            //
            // Both counts are per photograph, so they can sit beside each other
            // and mean something together. Shown only once there is something
            // to show: a set announcing nought views has been seen by the one
            // person reading it, which is a strange thing to tell them. */}
        {(setViews > 0 || setLikes > 0) && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14,
                        fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: '0.06em' }}>
            {setViews > 0 && <span>{setViews.toLocaleString('en-IN')} {setViews === 1 ? 'view' : 'views'}</span>}
            {setLikes > 0 && (
              <span style={{ color: '#E4A0A0' }}>
                ♥ {setLikes.toLocaleString('en-IN')} {setLikes === 1 ? 'like' : 'likes'}
              </span>
            )}
          </div>
        )}

        <Clamped text={openSet.description} lines={3}
                 style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 600 }} />

        {/* The verdict on something newly bought.
            //
            // Open for a day, then the result stands. While it is open the tally
            // stays hidden: numbers on screen change how people vote, and the
            // point is a first reaction rather than agreement with whoever
            // arrived first. */}
        {fitCheck && (
          <div style={{ border: `1px solid ${fitCheck.open ? C.accent : C.border}`, borderRadius: 12,
                        padding: '16px 18px', margin: '18px 0', maxWidth: 600,
                        background: fitCheck.open ? 'rgba(193,125,74,0.06)' : 'transparent' }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.12em',
                          textTransform: 'uppercase', color: C.accent, marginBottom: 8 }}>
              {fitCheck.open ? 'Fit check — vote now' : 'Fit check — closed'}
            </div>

            {/* The day it was worn, on the card.
                //
                // A fit check is about a particular outfit on a particular day,
                // and one from last Tuesday reads differently from one from this
                // morning. While voting is open it also says when it closes,
                // because a day is not long and nobody can see the clock. */}
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginBottom: 10 }}>
              {fitCheck.postedAt && new Date(fitCheck.postedAt).toLocaleDateString('en-IN', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
              {fitCheck.open && fitCheck.closesAt && (
                <> · {closesIn(fitCheck.closesAt)}</>
              )}
            </div>

            {fitCheck.open ? (
              <>
                <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 14 }}>
                  How do you rate this fit?
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[['keep', 'Slaying it', '#8FC88F'], ['return', 'Could be better', '#D99A9A']].map(([v, label, colour]) => (
                    <button key={v} onClick={() => castVote(v)} disabled={voting}
                            style={{ fontFamily: F.sans, fontSize: 14, padding: '10px 20px', borderRadius: 999,
                                     cursor: voting ? 'default' : 'pointer',
                                     background: fitCheck.yours === v ? colour : 'transparent',
                                     color: fitCheck.yours === v ? '#14120F' : colour,
                                     border: `1px solid ${colour}`,
                                     fontWeight: fitCheck.yours === v ? 600 : 400,
                                     opacity: voting ? 0.6 : 1 }}>
                      {label}
                    </button>
                  ))}
                  {fitCheck.yours && (
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>
                      Counted. You can change your mind until voting closes.
                    </span>
                  )}
                </div>
              </>
            ) : (
              <FitResult keep={fitCheck.keep} ret={fitCheck.return} yours={fitCheck.yours} />
            )}
          </div>
        )}



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

              {/* The heart sits on the photograph and does not open it.
                  //
                  // stopPropagation because the whole tile opens the lightbox,
                  // and somebody reaching for the heart should not find
                  // themselves looking at a full-screen photograph instead. */}
              <button onClick={(e) => { e.stopPropagation(); toggleLike(item.id); }}
                      aria-label={item.likedByMe ? 'Unlike' : 'Like'}
                      style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 2,
                               display: 'flex', alignItems: 'center', gap: 5,
                               // Dark enough to sit on a bright photograph and
                               // pale enough to sit on a dark one. An outline at
                               // three-quarter opacity disappeared into both.
                               background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)',
                               border: '1px solid rgba(255,255,255,0.22)',
                               borderRadius: 999, padding: '6px 11px',
                               cursor: 'pointer', lineHeight: 1,
                               fontFamily: F.mono, fontSize: 12,
                               // A heart nobody has filled is still white, not
                               // grey. It has to look like something to press.
                               color: item.likedByMe ? '#E4A0A0' : '#FFFFFF',
                               textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                <span style={{ fontSize: 14 }}>{item.likedByMe ? '♥' : '♡'}</span>
                {item.likes > 0 && <span>{item.likes}</span>}
              </button>
            </div>
          ))}

        </div>

        {/* Locked, and what to do about it — one panel rather than a tile in the
            grid and a button beneath it. The cover stays blurred: it is a 24px
            version, so there is no detail to recover, and it says what the set
            is without giving it away.

            Two ways in, stated plainly and priced. Nothing explains the
            difference because the two lines already do. */}
        {(showTierFrame || showUpsellFrame) && (() => {
          const scope     = showTierFrame ? 'tier' : 'upsell';
          const count     = showTierFrame ? openSet.tierPortionCount : openSet.upsellPortionCount;
          const price     = showTierFrame ? openSet.tierPrice : openSet.upsellPrice;
          const preview   = showTierFrame ? openSet.tierPreviewUrl : openSet.upsellPreviewUrl;
          const onCredit  = showTierFrame && price === 0;
          const offer     = openSet.membershipOffer;
          const busy      = !!unlockingScope || joining;

          return (
            <div style={lockedPanel}>
              {preview && (
                <>
                  <img src={preview} alt="" aria-hidden style={lockedBackdrop} />
                  <div style={lockedScrim} />
                </>
              )}
              <div style={{ position: 'relative' }}>
                <div style={lockedHeading}>
                  {openSet.tierLapsed ? 'This set is locked again' : 'This set is locked'}
                </div>
                <div style={lockedSub}>{count} {count === 1 ? 'photo' : 'photos'}</div>

                {/* Shown here rather than at the top of the set. On a couple of
                    hundred photos the locked panel is a long way down, so a
                    failure reported up there appeared somewhere the person was
                    not looking — and an unlock that silently did nothing is
                    indistinguishable from a dead button. */}
                {viewerError && (
                  <div style={{ ...errorBox, margin: '14px auto 0', maxWidth: 460, textAlign: 'center' }}>
                    {viewerError}
                  </div>
                )}

                <div style={lockedActions}>
                  {/* Asked before the tokens go.
                      //
                      // One tap used to spend them. On a phone, a set priced at
                      // six hundred tokens is a stray thumb away from being
                      // bought, and the policy that purchases are final is a
                      // poor answer to somebody who never meant to make one.
                      //
                      // Only where tokens are actually spent. A set opening
                      // against a membership allowance costs nothing and takes
                      // nothing away, so stopping to ask would be ceremony. */}
                  {confirming === scope ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                        Spend <strong style={{ color: C.accent }}>{price} tokens</strong> to open
                        this set? Tokens are not refundable once spent.
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button onClick={() => { setConfirming(null); handleViewerUnlock(scope); }}
                                disabled={busy} style={lockedPrimary}>
                          {unlockingScope === scope ? 'Unlocking…' : `Yes, spend ${price}`}
                        </button>
                        <button onClick={() => setConfirming(null)} disabled={busy} style={lockedSecondary}>
                          Not now
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => !busy && (onCredit ? handleViewerUnlock(scope) : setConfirming(scope))}
                            disabled={busy} style={lockedPrimary}>
                      {unlockingScope === scope ? 'Unlocking…'
                        : onCredit ? 'Unlock this set with membership credit'
                        : `Unlock this set for ${price} tokens`}
                    </button>
                  )}

                  {offer && (
                    <button onClick={() => !busy && handleMembership()} disabled={busy} style={lockedSecondary}>
                      {joining ? 'One moment…'
                        : `Upgrade membership — ${offer.tier.charAt(0).toUpperCase() + offer.tier.slice(1)}`
                          + `${offer.route === 'trial' ? ` (${offer.days} days)` : ''} (access more) — ${offer.cost} tokens`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {lightbox !== null && (
          <div style={lightboxOverlay} onClick={() => setLightbox(null)}>
            <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} style={closeBtn}>✕</button>
            <button onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.max(0, i - 1)); }} style={{ ...navBtn, left: 16 }} disabled={lightbox === 0}>‹</button>
            <div onClick={(e) => e.stopPropagation()} style={lightboxInner}>
              {setItems[lightbox]?.media_type === 'video' ? (
                <video src={setItems[lightbox].media_url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }} />
              ) : (
                // Double tap to like, which is what a hand expects on a
                // photograph. The button below does the same thing for anybody
                // who does not think to try.
                <img src={setItems[lightbox]?.media_url} alt=""
                     onDoubleClick={() => { if (!setItems[lightbox]?.likedByMe) toggleLike(setItems[lightbox].id); }}
                     style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain',
                              userSelect: 'none', WebkitUserSelect: 'none' }} />
              )}
              {/* Liking it while looking at it.
                  //
                  // The heart on the grid tile is no use here: closing a
                  // photograph to say you liked it, then opening the next one,
                  // is not something anybody will do. This is the moment the
                  // feeling happens, so the button belongs in it. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 18, marginTop: 12 }}>
                <button onClick={(e) => { e.stopPropagation(); toggleLike(setItems[lightbox].id); }}
                        aria-label={setItems[lightbox]?.likedByMe ? 'Unlike' : 'Like'}
                        style={{ display: 'flex', alignItems: 'center', gap: 8,
                                 background: 'rgba(255,255,255,0.08)',
                                 border: `1px solid ${setItems[lightbox]?.likedByMe ? 'rgba(228,160,160,0.5)' : 'rgba(255,255,255,0.2)'}`,
                                 borderRadius: 999, padding: '9px 18px', cursor: 'pointer',
                                 fontFamily: F.sans, fontSize: 14, lineHeight: 1,
                                 color: setItems[lightbox]?.likedByMe ? '#E4A0A0' : '#FFFFFF' }}>
                  <span style={{ fontSize: 17 }}>{setItems[lightbox]?.likedByMe ? '♥' : '♡'}</span>
                  <span>{setItems[lightbox]?.likes > 0 ? setItems[lightbox].likes : 'Like'}</span>
                </button>

                <span style={{ fontFamily: F.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {lightbox + 1} / {setItems.length}
                </span>
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
  const byCategory = activeTab === 'unlocked'
    ? unlockedSets
    : activeTab === 'all'
      ? allSets
      : allSets.filter((s) => s.category === activeTab);

  // Photographs or video, across whichever category is showing.
  //
  // A separate question from what a set is about, so a separate control: a set
  // can hold both, and somebody who came looking for video should not have to
  // open six photo sets to find the one that has any.
  const activeItems = mediaFilter === 'all'
    ? byCategory
    : mediaFilter === 'video'
      ? byCategory.filter((s) => (s.videoCount || 0) > 0)
      : byCategory.filter((s) => (s.photoCount || 0) > 0);

  // Offered only where there is a choice to make. A gallery of nothing but
  // photographs does not need a control that says so.
  const hasVideo  = byCategory.some((s) => (s.videoCount || 0) > 0);
  const hasPhoto  = byCategory.some((s) => (s.photoCount || 0) > 0);
  const showMediaFilter = hasVideo && hasPhoto;

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          {/* Photographs or video, in whichever category is showing. */}
          {showMediaFilter ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['photo', 'Photos'], ['video', 'Videos']].map(([k, label]) => (
                <button key={k} onClick={() => setMediaFilter(k)}
                        style={{ fontFamily: F.sans, fontSize: 12, padding: '6px 14px', borderRadius: 999,
                                 cursor: 'pointer',
                                 background: mediaFilter === k ? 'rgba(193,125,74,0.12)' : 'transparent',
                                 border: `1px solid ${mediaFilter === k ? C.accent : C.border}`,
                                 color: mediaFilter === k ? C.accent : C.muted }}>
                  {label}
                </button>
              ))}
            </div>
          ) : <span />}
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

                  {/* On the cover rather than in the text below it.
                      //
                      // An eye and a heart need no labels and take almost no
                      // room, which is what lets them sit on the photograph
                      // instead of pushing the title further down every card. */}
                  {(item.view_count > 0 || item.like_count > 0) && (
                    <div style={{ position: 'absolute', bottom: 8, right: 8,
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
                                  borderRadius: 999, padding: '5px 10px',
                                  fontFamily: F.mono, fontSize: 11, lineHeight: 1,
                                  color: 'rgba(255,255,255,0.9)' }}>
                      {item.view_count > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 12 }}>👁</span>{item.view_count.toLocaleString('en-IN')}
                        </span>
                      )}
                      {item.like_count > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#E4A0A0' }}>
                          <span style={{ fontSize: 12 }}>♥</span>{item.like_count.toLocaleString('en-IN')}
                        </span>
                      )}
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
// The locked state: one panel, the blurred cover behind it, and the two ways in.
// It used to be a tile inside the grid with a button underneath, which read as
// two unrelated things rather than a choice between two.
const lockedPanel = { position: 'relative', overflow: 'hidden', borderRadius: 14, marginTop: 16, padding: '28px 22px', border: `1px solid ${C.border}`, background: 'rgba(193,125,74,0.06)' };
const lockedHeading = { fontFamily: F.display, fontSize: 'clamp(18px,3vw,24px)', color: C.text, textAlign: 'center' };
const lockedSub = { fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 4 };
// Stacked rather than side by side: on a phone two buttons in a row leave no
// room for either to say what it costs.
const lockedActions = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' };
const lockedPrimary = { width: '100%', padding: '13px 18px', fontFamily: F.sans, fontSize: 14, color: '#1A1714', background: C.accent, border: 'none', borderRadius: 10, cursor: 'pointer' };
const lockedSecondary = { width: '100%', padding: '13px 18px', fontFamily: F.sans, fontSize: 13, color: C.text, background: 'transparent', border: `1px solid ${C.accent}`, borderRadius: 10, cursor: 'pointer' };

// Blurred hard and scaled up, so no edge of the original is readable and the
// blur cannot be undone by scaling the image back down.
// The image behind an unlock prompt is a 24-pixel version, not the real photo
// with a filter over it. The blur here smooths the upscale; it is not what does
// the hiding, so a reader mode stripping CSS reveals nothing.
const lockedBackdrop = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(8px)', transform: 'scale(1.1)', pointerEvents: 'none' };
const lockedScrim    = { position: 'absolute', inset: 0, background: 'linear-gradient(rgba(20,18,15,0.55), rgba(20,18,15,0.78))', pointerEvents: 'none' };

const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const lightboxInner   = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
const closeBtn    = { position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const navBtn      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontSize: 36, width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };