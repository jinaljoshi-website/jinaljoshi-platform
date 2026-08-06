// ps/src/pages/Landing.jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api } from '../api';
import { WonderCoin } from '../components/WonderCoin';

// Two lists rather than one. The bar is a compact shortcut where Shop is a
// single destination; the cards have room to name what is actually inside it,
// so Outfits, Merch and Custom Requests get their own. Extras is gone from
// both -- it now redirects into Shop, so it was a card pointing at another
// card's destination.
const NAV_SECTIONS = [
  { path: '/platform/chat',       icon: '\u{1F4AC}', label: 'Messages'      },
  { path: '/platform/calls',      icon: '\u{1F4DE}', label: 'Calls'         },
  { path: '/platform/gallery',    icon: '\u{1F4F8}', label: 'Gallery'       },
  { path: '/platform/shop',       icon: '\u{1F6CD}', label: 'Shop'          },
  { path: '/platform/community',  icon: '\u2728',    label: 'Public Corner' },
  { path: '/platform/membership', icon: '\u{1F451}', label: 'Membership'    },
  { path: '/platform/coins',      icon: 'coin',       label: 'Coins'         },
  { path: '/platform/profile',    icon: '\u{1F464}', label: 'Profile'       },
];

const SECTIONS = [
  { path: '/platform/chat',              icon: '\u{1F4AC}', label: 'Chat',            desc: 'Send Jinal a message', live: 'chat'  },
  { path: '/platform/calls',             icon: '\u{1F4DE}', label: 'Calls',           desc: 'Book a personal call', live: 'calls' },
  { path: '/platform/gallery',           icon: '\u{1F4F8}', label: 'Gallery',         desc: 'Exclusive photo sets' },
  { path: '/platform/shop?tab=outfits',  icon: '\u{1F457}', label: 'Outfits',         desc: 'One of one, from set' },
  { path: '/platform/shop?tab=merch',    icon: '\u{1F6CD}', label: 'Merch',           desc: 'Limited drops'        },
  { path: '/platform/shop?tab=requests', icon: '\u{1F31F}', label: 'Custom Requests', desc: 'Ask for something'    },
  { path: '/platform/community',         icon: '\u2728',    label: 'Public Corner',   desc: 'Live fan space'       },
  { path: '/platform/membership',        icon: '\u{1F451}', label: 'Membership',      desc: 'Your member plan'     },
  { path: '/platform/coins',             icon: 'coin',       label: 'Coins',           desc: 'J Token wallet'       },
  { path: '/platform/profile',           icon: '\u{1F464}', label: 'Profile',         desc: 'Your details'         },
];

const SIGN_NAMES = {
  aries: 'Aries', taurus: 'Taurus', gemini: 'Gemini', cancer: 'Cancer',
  leo: 'Leo', virgo: 'Virgo', libra: 'Libra', scorpio: 'Scorpio',
  sagittarius: 'Sagittarius', capricorn: 'Capricorn', aquarius: 'Aquarius', pisces: 'Pisces',
};

export default function Landing() {
  const navigate    = useNavigate();
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [activeCard, setActiveCard] = useState(0);
  const scrollRef   = useRef(null);

  // The bar hides its scrollbar, so with eight items there is nothing showing
  // that it moves. A thin rail underneath tracks position and, more usefully,
  // tells you there is more before you have discovered it by accident.
  const navRef = useRef(null);
  const [navScroll, setNavScroll] = useState({ ratio: 0, scrollable: false });

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setNavScroll({ ratio: max > 0 ? el.scrollLeft / max : 0, scrollable: max > 8 });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, []);
  const cardRefs    = useRef([]);

  useEffect(() => {
    api.get('/api/landing')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Track active card on scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const scrollLeft = el.scrollLeft;
      const cardWidth  = el.offsetWidth * 0.8 + 16;
      setActiveCard(Math.round(scrollLeft / cardWidth));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: F.sans, color: C.muted, fontSize: 14 }}>A moment…</div>
      </div>
    );
  }

  const greeting   = data?.greeting || 'Welcome';
  const name       = data?.name || 'there';
  const sunSign    = data?.sunSign;
  const emoji      = data?.sunSignEmoji;
  const horoscope  = data?.horoscope;
  const quote      = data?.quote;
  const thought    = data?.thought;
  const jinalQuote = data?.jinalQuote;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', flexDirection: 'column' }}>

      {/* ── Persistent top navigation — reaches every section without scrolling ── */}
      <div ref={navRef} style={topNavBar}>
        {NAV_SECTIONS.map((section) => (
          <button key={section.path} onClick={() => navigate(section.path)} style={topNavBtn} title={section.label}>
            <span style={{ fontSize: 16, display: 'inline-flex', alignItems: 'center' }}>
              {section.icon === 'coin' ? <WonderCoin size={16} /> : section.icon}
            </span>
            <span style={topNavLabel}>{section.label}</span>
          </button>
        ))}
      </div>

      {navScroll.scrollable && (
        <div style={navRail}>
          <div style={{
            ...navRailThumb,
            // Sits proportionally along the rail, so its position says where you
            // are and its existence says there is somewhere to go.
            left: `${navScroll.ratio * 62}%`,
          }} />
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>
          Personal Space
        </div>
        <h1 style={{ fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,6vw,52px)', margin: '0 0 4px', lineHeight: 1.1 }}>
          {greeting},<br /><span style={{ color: C.accent }}>{name}</span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <button onClick={() => navigate('/platform/gallery?tab=selfies')} style={selfieLink}>
            Selfie of the day →
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* Jinal's note */}
        {jinalQuote && (
          <div style={noteCard}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
              A note from Jinal
            </div>
            <div style={{ fontFamily: F.display, fontSize: 18, color: C.text, lineHeight: 1.6, fontStyle: 'italic' }}>
              "{jinalQuote}"
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 10, textAlign: 'right' }}>
              — Jinal ✦
            </div>
          </div>
        )}

        {/* Horoscope */}
        {sunSign && (
          <div style={sectionCard}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              {emoji} {SIGN_NAMES[sunSign]} · Today's Horoscope
            </div>
            {horoscope ? (
              <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.8 }}>
                {horoscope}
              </div>
            ) : (
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, fontStyle: 'italic' }}>
                The stars are quiet today — a perfect day to listen to your own inner voice.
              </div>
            )}
          </div>
        )}

        {/* Thought of the day */}
        {thought && (
          <div style={sectionCard}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              ☀️ Thought of the Day
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 15, color: C.text, lineHeight: 1.7 }}>
              {thought}
            </div>
          </div>
        )}

        {/* Famous quote */}
        {quote && (
          <div style={sectionCard}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              💫 Quote of the Day
            </div>
            <div style={{ fontFamily: F.display, fontSize: 17, color: C.text, lineHeight: 1.65, fontStyle: 'italic' }}>
              "{quote.text}"
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 8 }}>
              — {quote.author}
            </div>
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: `1px solid ${C.border}`, margin: '24px 0 20px' }} />

        {/* Section label */}
        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
          Where would you like to go?
        </div>
      </div>

      {/* ── Swipe cards ── */}
      <div style={{ flexShrink: 0, paddingBottom: 32 }}>
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            padding: '4px 24px 12px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {SECTIONS.map((section, idx) => (
            <div
              key={section.path}
              ref={(el) => { cardRefs.current[idx] = el; }}
              onClick={() => navigate(section.path)}
              style={{
                flexShrink: 0,
                width: '75vw',
                maxWidth: 280,
                scrollSnapAlign: 'start',
                background: activeCard === idx ? 'rgba(193,125,74,0.12)' : C.surface,
                border: `1px solid ${activeCard === idx ? 'rgba(193,125,74,0.4)' : C.border}`,
                borderRadius: 14,
                padding: '20px 20px 18px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 28, display: 'flex', alignItems: 'center' }}>
                {section.icon === 'coin' ? <WonderCoin size={28} /> : section.icon}
              </div>
              <div style={{ fontFamily: F.display, fontSize: 20, color: C.text }}>{section.label}</div>
              {section.live === 'chat'  && data?.chatLive && (
                <div style={liveNow}><span style={liveDot} />Live now</div>
              )}
              {section.live === 'calls' && data?.callsAvailable && (
                <div style={liveNow}><span style={liveDot} />Available now</div>
              )}
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{section.desc}</div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, marginTop: 4 }}>Enter →</div>
            </div>
          ))}
        </div>

        {/* Dot indicators */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          {SECTIONS.map((s, idx) => (
            <button
              key={idx}
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTo({ left: idx * (el.scrollWidth / SECTIONS.length), behavior: 'smooth' });
              }}
              aria-label={s.label}
              title={s.label}
              style={{
                width: activeCard === idx ? 18 : 6,
                height: 6,
                borderRadius: 3,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: activeCard === idx ? C.accent : C.border,
                transition: 'all 0.3s',
              }}
            />
          ))}
        </div>

        {/* Stated as well as shown. Dots alone read as decoration until you have
            already worked out the row moves. */}
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 6 }}>
          {activeCard + 1} of {SECTIONS.length} · swipe for more
        </div>
      </div>
    </div>
  );
}

const noteCard = {
  background: 'rgba(193,125,74,0.06)',
  border: `1px solid rgba(193,125,74,0.2)`,
  borderRadius: 12,
  padding: '20px 22px',
  marginBottom: 16,
};

const sectionCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: '18px 20px',
  marginBottom: 14,
};

// A dot before the words, so it reads as a live status rather than a label.
const liveNow = { display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: F.sans, fontSize: 11, color: '#8FC88F', marginTop: -2 };
const liveDot = { width: 6, height: 6, borderRadius: '50%', background: '#8FC88F', flexShrink: 0, boxShadow: '0 0 0 3px rgba(143,200,143,0.18)' };

const navRail      = { height: 2, background: 'rgba(255,255,255,0.06)', margin: '0 24px', borderRadius: 2, position: 'relative', flexShrink: 0 };
const navRailThumb = { position: 'absolute', top: 0, height: 2, width: '38%', background: 'rgba(193,125,74,0.55)', borderRadius: 2, transition: 'left 0.15s' };
const selfieLink   = { background: 'rgba(193,125,74,0.1)', border: `1px solid rgba(193,125,74,0.3)`, color: C.accent, fontFamily: F.sans, fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap' };

const topNavBar = { display: 'flex', gap: 4, overflowX: 'auto', padding: '10px 16px', flexShrink: 0, borderBottom: `1px solid ${C.border}`, scrollbarWidth: 'none' };
const topNavBtn = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: '6px 10px', borderRadius: 8, flexShrink: 0, minWidth: 56 };
const topNavLabel = { fontFamily: F.sans, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 56 };