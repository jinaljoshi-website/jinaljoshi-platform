// ps/src/pages/Collections.jsx
//
// The private collection.
//
// ── The direction ──────────────────────────────────────────────────
//
// The brief asked for royal, and the obvious answer — gilt, crimson, serifs
// with high contrast — is the one every page reaching for luxury already uses.
// The specific answer is closer to hand: a jaali, the pierced stone lattice cut
// into Mughal and Rajput palaces. In the zenana it screened the women's
// quarters, and its whole purpose was to be looked through without being looked
// into. A lattice you can see shapes behind but no detail.
//
// That is exactly what a locked set is here, so the jaali is the signature: it
// lies over every cover that has not been bought and lifts when it has. It is
// doing the work of the page rather than decorating it, which is the only
// reason to spend the one bold idea on it.
//
// Everything else stays quiet. Marcellus for the headings, which is cut like
// inscribed stone and sits with the lattice; the app's own DM Sans for reading;
// Cormorant italic for the captions, which run longer here than in the gallery
// and deserve to look like prose rather than metadata. The ground darkens from
// the app's near-black toward aubergine, and the accent moves from the
// platform's terracotta to a paler gold — enough that walking in feels like
// walking somewhere else, not so much that it stops being the same building.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { F } from '../tokens';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';
import { WonderCoinAmount } from '../components/WonderCoin';

// Loaded here rather than in tokens.js: it is used on one screen and there is
// no reason for every other page to pay for it.
if (typeof document !== 'undefined' && !document.getElementById('ps-collections-font')) {
  const link = document.createElement('link');
  link.id = 'ps-collections-font';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Marcellus&display=swap';
  document.head.appendChild(link);
}

const V = {
  ground:  '#0B0910',
  panel:   '#151020',
  edge:    'rgba(226,199,143,0.16)',
  gold:    '#E2C78F',
  goldDim: 'rgba(226,199,143,0.55)',
  ink:     '#EFE7DA',
  quiet:   '#9E93A8',
};

const T = {
  display: "'Marcellus', 'Cormorant Garamond', Georgia, serif",
  caption: "'Cormorant Garamond', Georgia, serif",
  body:    F.sans,
};

const reduced = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The lattice itself, drawn rather than fetched so it stays crisp at any size
// and costs nothing to load. One tile, repeated — which is how the stone ones
// were cut too.
function Jaali({ opacity = 1 }) {
  return (
    <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, pointerEvents: 'none' }}>
      <defs>
        <pattern id="jaali" width="44" height="76" patternUnits="userSpaceOnUse" patternTransform="scale(0.9)">
          {/* A six-point star repeated on a hexagonal grid: the shatkona, the
              commonest figure in the screens this borrows from. */}
          <g fill="none" stroke={V.gold} strokeWidth="0.9" strokeOpacity="0.5">
            <path d="M22 4 L40 15 L40 37 L22 48 L4 37 L4 15 Z" />
            <path d="M22 14 L31 19 L31 33 L22 38 L13 33 L13 19 Z" />
            <path d="M22 42 L40 53 L40 75 L22 86 L4 75 L4 53 Z" />
            <path d="M22 52 L31 57 L31 71 L22 76 L13 71 L13 57 Z" />
          </g>
        </pattern>
        <radialGradient id="jaaliFade" cx="50%" cy="45%" r="75%">
          <stop offset="0%"   stopColor="#fff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fff" stopOpacity="1" />
        </radialGradient>
        <mask id="jaaliMask"><rect width="100%" height="100%" fill="url(#jaaliFade)" /></mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#jaali)" mask="url(#jaaliMask)" />
    </svg>
  );
}

export default function Collections() {
  const { setId } = useParams();
  const navigate  = useNavigate();

  const [data,    setData]    = useState(null);
  const [tab,     setTab]     = useState('photos');
  const [open,    setOpen]    = useState(null);   // the set being looked at
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [topUp,   setTopUp]   = useState(null);
  const [pending, setPending] = useState(null);   // an unlock waiting on tokens
  const [lightbox, setLightbox] = useState(null);
  const [denied,  setDenied]  = useState(false);

  const load = async () => {
    try {
      setData(await api.get('/api/collections/sets'));
    } catch (err) {
      // 404 is the answer for anybody without access, and it is indistinguishable
      // from the section not existing — which is the point. Send them home
      // rather than explaining what they cannot have.
      setDenied(true);
      if (err.code !== 'NOT_FOUND') console.error(err.message);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => { if (denied) navigate('/platform', { replace: true }); }, [denied]);

  const openSet = async (id) => {
    setError('');
    try {
      const d = await api.get(`/api/collections/sets/${id}`);
      setOpen(d);
    } catch (err) { setError(err.message); }
  };

  // A link straight to one set works for somebody who may see it, and is
  // nothing at all for anybody else. Defined after openSet rather than before:
  // a const arrow function used above its own declaration parses cleanly and
  // then throws the moment somebody actually follows such a link.
  useEffect(() => { if (setId && data) openSet(setId); }, [setId, !!data]);

  const unlock = async (id) => {
    setError('');
    setBusy(true);
    try {
      await api.post('/api/collections/unlock', { setId: id });
      await openSet(id);
      await load();
      setPending(null);
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        setPending(id);
        setTopUp(err.body?.shortBy ? err.body.required : null);
      } else setError(err.message);
    } finally { setBusy(false); }
  };

  // Carries on by itself once the tokens land, as everywhere else.
  const afterTopUp = async () => {
    const id = pending;
    setTopUp(null);
    setPending(null);
    if (id) await unlock(id);
    else await load();
  };

  if (denied) return null;
  if (!data)  return <div style={{ ...page, color: V.quiet, fontFamily: T.body, padding: 32 }}>…</div>;

  const sets = tab === 'photos' ? data.photos : data.videos;

  // ── One set, open ────────────────────────────────────────
  if (open) {
    return (
      <div style={page}>
        <button onClick={() => { setOpen(null); navigate('/platform/collections'); }} style={backBtn}>← Back</button>

        <h1 style={{ ...h1, marginTop: 18 }}>{open.title}</h1>
        {open.photographer && <div style={credit}>Photographed by {open.photographer}</div>}
        {open.description && <p style={caption}>{open.description}</p>}

        {open.unlocked ? (
          <div style={grid}>
            {open.items.map((it, i) => (
              it.mediaType === 'video'
                ? <video key={it.id} src={it.mediaUrl} controls style={tile} />
                : <img key={it.id} src={it.mediaUrl} alt="" style={tile} onClick={() => setLightbox(i)} />
            ))}
          </div>
        ) : (
          <div style={lockPanel}>
            {open.coverUrl && <img src={open.coverUrl} alt="" style={lockCover} />}
            <Jaali />
            <div style={{ position: 'relative', textAlign: 'center' }}>
              <div style={{ fontFamily: T.display, fontSize: 'clamp(20px,3vw,28px)', color: V.ink }}>
                Behind the screen
              </div>
              <div style={{ fontFamily: T.body, fontSize: 12, color: V.quiet, marginTop: 6 }}>
                {open.itemCount} {open.itemCount === 1 ? 'piece' : 'pieces'}
              </div>
              <button onClick={() => unlock(open.id)} disabled={busy} style={{ ...unlockBtn, marginTop: 18 }}>
                {busy ? 'Opening…' : <>Open for <WonderCoinAmount amount={open.price} size={13} fontSize={13} textColor="#1A1410" /></>}
              </button>
              {error && <div style={errBox}>{error}</div>}
            </div>
          </div>
        )}

        {lightbox !== null && open.items?.[lightbox] && (
          <div style={overlay} onClick={() => setLightbox(null)}>
            <img src={open.items[lightbox].mediaUrl} alt="" style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain' }} />
          </div>
        )}

        {topUp !== null && (
          <TopUpModal requiredTokens={topUp} onClose={() => { setTopUp(null); setPending(null); }} onSuccess={afterTopUp} />
        )}
      </div>
    );
  }

  // ── The index ────────────────────────────────────────────
  return (
    <div style={page}>
      <div style={{ maxWidth: 760 }}>
        <div style={eyebrow}>By invitation</div>
        <h1 style={h1}>The Private Collection</h1>
        {/* States the date and nothing else. How it is earned, and that it can
            be earned again, is left to be discovered — a surprise explained in
            advance stops being one. */}
        {data.accessUntil && (
          <p style={accessLine}>
            Your access runs to {new Date(data.accessUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        )}
      </div>

      <div style={tabs}>
        {[['photos', 'Photographs'], ['videos', 'Films']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
                  style={{ ...tabBtn, ...(tab === k ? tabOn : {}) }}>
            {label}
            <span style={{ fontFamily: T.body, fontSize: 11, color: V.quiet, marginLeft: 8 }}>
              {(k === 'photos' ? data.photos : data.videos).length}
            </span>
          </button>
        ))}
      </div>

      {sets.length === 0 ? (
        <p style={{ ...caption, color: V.quiet }}>
          Nothing here yet. What arrives will arrive quietly.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 46 }}>
          {sets.map((s, i) => <SetCard key={s.id} set={s} flip={i % 2 === 1} onOpen={() => navigate(`/platform/collections/${s.id}`)} />)}
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => { setTopUp(null); setPending(null); }} onSuccess={afterTopUp} />
      )}
    </div>
  );
}

// Alternating sides rather than a grid: a collection of a dozen deserves to be
// walked past, not scanned. It also gives the captions somewhere to breathe,
// which is the point of them being longer here.
function SetCard({ set, flip, onOpen }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(reduced);

  useEffect(() => {
    if (reduced || !ref.current) return;
    const ob = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); ob.disconnect(); } },
      { rootMargin: '-40px' });
    ob.observe(ref.current);
    return () => ob.disconnect();
  }, []);

  return (
    <article ref={ref} onClick={onOpen}
             style={{
               display: 'grid', gap: 22, cursor: 'pointer', alignItems: 'center',
               gridTemplateColumns: 'minmax(0,1fr)',
               opacity: seen ? 1 : 0,
               transform: seen ? 'none' : 'translateY(14px)',
               transition: reduced ? 'none' : 'opacity 700ms ease, transform 700ms ease',
             }}>
      <div style={{ position: 'relative', borderRadius: 3, overflow: 'hidden', border: `1px solid ${V.edge}`, background: V.panel }}>
        {set.coverUrl
          ? <img src={set.coverUrl} alt="" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', aspectRatio: '4 / 3' }} />}
        {!set.unlocked && <Jaali />}
        {set.unlocked && (
          <div style={openedTag}>Opened</div>
        )}
      </div>

      <div style={{ order: flip ? -1 : 0 }}>
        <h2 style={h2}>{set.title}</h2>
        {set.photographer && <div style={credit}>{set.photographer}</div>}
        {set.description && <p style={caption}>{set.description}</p>}
        <div style={metaRow}>
          <span>{set.itemCount} {set.itemCount === 1 ? 'piece' : 'pieces'}</span>
          {!set.unlocked && (
            <>
              <span style={{ color: V.edge }}>·</span>
              <span style={{ color: V.gold }}>{set.price} tokens</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

const page = {
  background: `radial-gradient(1100px 620px at 50% -8%, #1B1428 0%, ${V.ground} 62%)`,
  minHeight: '100%', padding: '30px 22px 70px',
};
const eyebrow = { fontFamily: F.mono, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: V.goldDim };
const h1 = { fontFamily: T.display, fontSize: 'clamp(30px,5.5vw,48px)', color: V.ink, fontWeight: 400, margin: '10px 0 0', letterSpacing: '0.01em' };
const h2 = { fontFamily: T.display, fontSize: 'clamp(21px,3vw,27px)', color: V.ink, fontWeight: 400, margin: 0 };
const accessLine = { fontFamily: T.body, fontSize: 13, color: V.quiet, marginTop: 14, lineHeight: 1.7 };
const credit = { fontFamily: F.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: V.goldDim, marginTop: 8 };
const caption = { fontFamily: T.caption, fontSize: 'clamp(16px,2.2vw,19px)', fontStyle: 'italic', lineHeight: 1.75, color: '#CFC4B6', marginTop: 12, maxWidth: 620 };
const metaRow = { display: 'flex', gap: 10, alignItems: 'center', fontFamily: F.mono, fontSize: 11, color: V.quiet, marginTop: 14 };
const tabs = { display: 'flex', gap: 6, margin: '34px 0 30px', borderBottom: `1px solid ${V.edge}` };
const tabBtn = { background: 'none', border: 'none', borderBottom: '1px solid transparent', color: V.quiet, fontFamily: T.display, fontSize: 17, padding: '8px 14px', cursor: 'pointer', marginBottom: -1 };
const tabOn = { color: V.gold, borderBottomColor: V.gold };
const openedTag = { position: 'absolute', top: 12, left: 12, fontFamily: F.mono, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: V.gold, border: `1px solid ${V.edge}`, borderRadius: 2, padding: '4px 8px', background: 'rgba(11,9,16,0.66)' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, marginTop: 26 };
const tile = { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 2, cursor: 'pointer', display: 'block' };
const lockPanel = { position: 'relative', marginTop: 26, borderRadius: 4, overflow: 'hidden', border: `1px solid ${V.edge}`, background: V.panel, padding: '54px 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 };
const lockCover = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 };
const unlockBtn = { fontFamily: T.body, fontSize: 14, color: '#1A1410', background: V.gold, border: 'none', borderRadius: 2, padding: '12px 26px', cursor: 'pointer' };
const backBtn = { fontFamily: T.body, fontSize: 13, color: V.quiet, background: 'none', border: `1px solid ${V.edge}`, borderRadius: 2, padding: '7px 14px', cursor: 'pointer' };
const errBox = { fontFamily: T.body, fontSize: 13, color: '#D99A9A', marginTop: 14 };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(6,5,9,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, cursor: 'zoom-out' };