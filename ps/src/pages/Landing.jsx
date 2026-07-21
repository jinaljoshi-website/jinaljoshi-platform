// ps/src/pages/Landing.jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api } from '../api';

const SECTIONS = [
  { path: '/platform/community',  icon: '✨', label: 'Public Corner',  desc: 'Live fan space'         },
  { path: '/platform/gallery',    icon: '📸', label: 'Gallery',    desc: 'Exclusive photo sets'   },
  { path: '/platform/membership', icon: '👑', label: 'Membership', desc: 'Your member plan'       },
  { path: '/platform/shop',       icon: '🛍️', label: 'Shop',       desc: 'Merch & exclusives'     },
  { path: '/platform/extras',     icon: '🌟', label: 'Extras',     desc: 'Custom requests'        },
  { path: '/platform/calls',      icon: '📞', label: 'Calls',      desc: 'Book a personal call'   },
  { path: '/platform/chat',       icon: '💬', label: 'Messages',   desc: 'Send Jinal a message'   },
  { path: '/platform/coins',      icon: '🪙', label: 'Coins',      desc: 'J Token wallet'         },
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
      <div style={topNavBar}>
        {SECTIONS.map((section) => (
          <button key={section.path} onClick={() => navigate(section.path)} style={topNavBtn} title={section.label}>
            <span style={{ fontSize: 16 }}>{section.icon}</span>
            <span style={topNavLabel}>{section.label}</span>
          </button>
        ))}
      </div>

      {/* ── Header ── */}
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>
          Personal Space
        </div>
        <h1 style={{ fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,6vw,52px)', margin: '0 0 4px', lineHeight: 1.1 }}>
          {greeting},<br /><span style={{ color: C.accent }}>{name}</span>
        </h1>
        <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginTop: 8 }}>
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
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
              <div style={{ fontSize: 28 }}>{section.icon}</div>
              <div style={{ fontFamily: F.display, fontSize: 20, color: C.text }}>{section.label}</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{section.desc}</div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, marginTop: 4 }}>Enter →</div>
            </div>
          ))}
        </div>

        {/* Dot indicators */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          {SECTIONS.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: activeCard === idx ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: activeCard === idx ? C.accent : C.border,
                transition: 'all 0.3s',
              }}
            />
          ))}
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

const topNavBar = { display: 'flex', gap: 4, overflowX: 'auto', padding: '10px 16px', flexShrink: 0, borderBottom: `1px solid ${C.border}`, scrollbarWidth: 'none' };
const topNavBtn = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: '6px 10px', borderRadius: 8, flexShrink: 0, minWidth: 56 };
const topNavLabel = { fontFamily: F.sans, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 56 };