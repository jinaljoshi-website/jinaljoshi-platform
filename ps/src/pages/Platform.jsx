// ps/src/pages/Platform.jsx
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api, getUser, logout } from '../api';
import { TIERS } from '../data';
import { WonderCoinAmount } from '../components/WonderCoin';
import InstallPrompt    from '../components/InstallPrompt';
import NotificationBell from '../components/NotificationBell';

import Chat       from './Chat';
import Gallery    from './Gallery';
import HelpChat   from '../components/HelpChat';
import Membership from './Membership';
import Community  from './Community';
import Calls      from './Calls';
import Shop       from './Shop';
import Coins      from './Coins';
import Profile    from './Profile';

const navItems = [
  { to: '/platform/chat',       label: 'Chat',           live: 'chat'  },
  { to: '/platform/calls',      label: 'Calls',          live: 'calls' },
  { to: '/platform/gallery',    label: 'Gallery',        live: 'gallery' },
  { to: '/platform/shop',       label: 'Shop'          },
  { to: '/platform/community',  label: 'Public Corner' },
  { to: '/platform/membership', label: 'Membership'    },
  { to: '/platform/coins',      label: 'Coins'         },
  { to: '/platform/profile',    label: 'Profile'       },
];

const FULLSCREEN_PAGES = ['/platform/chat', '/platform/community'];

function useReachable() {
  const [state, setState] = useState({ chatLive: false, callsAvailable: false, unread: 0, unseenSets: 0 });
  useEffect(() => {
    let alive = true;
    const check = () => api.get('/api/landing')
      .then((d) => { if (alive) setState({
        chatLive: !!d.chatLive, callsAvailable: !!d.callsAvailable,
        unread: d.unreadMessages || 0, unseenSets: d.unseenSets || 0,
      }); })
      .catch(() => {});
    check();
    const id = setInterval(check, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return state;
}

// A dot beside the label rather than a second line — the sidebar is a list of
// destinations, and a status line under two of them would break its rhythm.
function LiveDot({ show }) {
  if (!show) return null;
  return <span style={navDot} title="Available now" />;
}
const TOP_BAR_H = 56;
const PROFILE_POLL_MS = 20000;

// The height of what is actually visible, keyboard included.
//
// 100vh on a phone is the viewport with the browser chrome hidden -- taller
// than the screen -- so the page ran off the bottom and the composer sat below
// the fold. 100dvh fixes that but still leaves iOS free to scroll the whole
// document up when the keyboard opens, which is what made the page appear to
// expand and shrink.
//
// visualViewport reports the region genuinely in view. Pinning the shell to it
// means the keyboard takes space from the message list, and nothing else moves.
function useViewportHeight() {
  const [h, setH] = useState(() => window.visualViewport?.height || window.innerHeight);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // The document itself must not scroll. Everything inside the shell manages
    // its own overflow, so any scroll at this level is the browser moving the
    // page to reveal something -- which is exactly the movement being fixed.
    const html = document.documentElement;
    const prev = { htmlH: html.style.height, bodyH: document.body.style.height,
                   bodyOverflow: document.body.style.overflow,
                   bodyPosition: document.body.style.position };
    html.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';

    // Only the height, and only on resize.
    //
    // The previous version also corrected document scroll on every scroll
    // event, which fed itself: the correction fired a scroll event, which
    // fired the correction. On a phone that reads as the screen vibrating.
    // With the body fixed there is nothing to correct anyway.
    //
    // Rounded, and only written when it actually changes, so a one-pixel
    // fluctuation as the keyboard animates does not re-render the whole shell
    // forty times on the way.
    let last = 0;
    const update = () => {
      const next = Math.round(vv.height);
      if (Math.abs(next - last) < 2) return;
      last = next;
      setH(next);
    };
    update();
    vv.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      vv.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      html.style.height = prev.htmlH;
      document.body.style.height = prev.bodyH;
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.position = prev.bodyPosition;
    };
  }, []);
  return h;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

// Persistent tier + token balance, visible on every page — refreshes periodically
// and whenever the route changes, so it stays accurate right after a purchase/unlock.
function StatusBadge({ isMobile }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState(null);

  const load = () => api.get('/api/auth/profile').then((d) => setProfile(d.user)).catch(() => {});

  useEffect(() => {
    load();
    const interval = setInterval(load, PROFILE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { load(); }, [location.pathname]);

  if (!profile) return null;

  const isActive = profile.membership_expires_at && new Date(profile.membership_expires_at) > new Date();
  const tierName = isActive ? (TIERS[profile.tier]?.name || profile.tier) : 'Guest';

  return (
    <div style={statusBadge}>
      <span style={{ fontFamily: F.sans, fontSize: isMobile ? 11 : 12, color: isActive ? C.accent : C.muted, fontWeight: 600 }}>
        {tierName}
      </span>
      <span style={{ color: C.border }}>·</span>
      {/* One number in a cramped bar. It shows everything spendable, with a small gift
          mark when part of it is gifted credit — the two pots are broken out on Coins. */}
      <WonderCoinAmount
        amount={profile.total_balance ?? profile.coin_balance}
        size={14}
        fontSize={isMobile ? 11 : 12}
        textColor={C.text}
        gap={4}
      />
      {profile.gifted_balance > 0 && (
        <span
          title={`${profile.gifted_balance} gifted${profile.gifted_expires_in_days != null ? ` · expires in ${profile.gifted_expires_in_days} days` : ''}`}
          style={{ fontSize: 10, lineHeight: 1 }}
        >🎁</span>
      )}
      <button onClick={() => navigate('/platform/coins')} style={topUpMiniBtn}>+</button>
    </div>
  );
}

export default function Platform() {
  const user      = getUser();
  const navigate  = useNavigate();
  const location  = useLocation();
  const isMobile  = useIsMobile();
  const viewportH = useViewportHeight();
  const [menuOpen, setMenuOpen] = useState(false);

  const isFullscreen = FULLSCREEN_PAGES.includes(location.pathname);
  const reachable    = useReachable();
  const isLive = (item) =>
    (item.live === 'chat'  && reachable.chatLive) ||
    (item.live === 'calls' && reachable.callsAvailable);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/auth?mode=login'); };

  const currentNav = navItems.find((n) => n.to === location.pathname);

  return (
    <div style={{ height: viewportH ? `${viewportH}px` : '100dvh', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isMobile ? (
            <button onClick={() => navigate(-1)} style={backButton} aria-label="Back">←</button>
          ) : (
            <div style={{ fontFamily: F.display, fontSize: 22 }}>Personal Space</div>
          )}
          <div style={{ fontFamily: isMobile ? F.display : F.sans, fontSize: isMobile ? 17 : 11, color: isMobile ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isMobile ? (currentNav?.label || 'Personal Space') : user?.email}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <StatusBadge isMobile={isMobile} />
          <NotificationBell />
          {isMobile ? (
            <button onClick={() => setMenuOpen(!menuOpen)} style={hamburgerBtn} aria-label="Menu">
              <span style={hamburgerIconWrap}>
                <span style={{ ...hamLine, transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none', transition: '0.2s' }} />
                <span style={{ ...hamLine, opacity: menuOpen ? 0 : 1, transition: '0.2s' }} />
                <span style={{ ...hamLine, transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none', transition: '0.2s' }} />
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.text }}>Menu</span>
            </button>
          ) : (
            <button onClick={handleLogout} style={ghostBtn}>Sign out</button>
          )}
        </div>
      </div>

      {/* ── MOBILE DRAWER ── */}
      {isMobile && menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={backdrop} />
          <div style={drawer}>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, paddingBottom: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
              {user?.email}
            </div>
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{ ...drawerLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {item.label}
                  {item.live === 'chat'    && reachable.unread > 0
                    ? <span style={unreadPill}>{reachable.unread}</span>
                    : item.live === 'gallery' && reachable.unseenSets > 0
                    ? <span style={unreadPill}>{reachable.unseenSets}</span>
                    : <LiveDot show={isLive(item)} />}
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              style={{ ...drawerLink, color: C.muted, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', marginTop: 'auto', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}
            >
              Sign out
            </button>
          </div>
        </>
      )}

      {/* ── CONTENT AREA ── */}
      {isMobile ? (
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: isFullscreen ? 'hidden' : 'auto',
          width: '100%',
          boxSizing: 'border-box',
          padding: isFullscreen ? 0 : '16px',
        }}>
          <Routes>
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="chat"       element={<Chat />}       />
            <Route path="gallery"    element={<Gallery />}    />
            <Route path="selfies"    element={<Navigate to="/platform/gallery?tab=selfies" replace />} />
            <Route path="membership" element={<Membership />} />
            <Route path="community"  element={<Community />}  />
            <Route path="calls"      element={<Calls />}      />
            <Route path="shop"       element={<Shop />}       />
            {/* Custom requests moved into Shop. Request notifications still link
                here, so this redirects rather than 404s. */}
            <Route path="extras"     element={<Navigate to="/platform/shop?tab=requests" replace />} />
            <Route path="coins"      element={<Coins />}      />
            <Route path="profile"    element={<Profile />}    />
            <Route path="*"          element={<Navigate to="chat" replace />} />
          </Routes>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: isFullscreen ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...desktopLayout, flex: 1, minHeight: 0, gridTemplateRows: isFullscreen ? '1fr' : 'auto' }}>
            <aside style={sidebar}>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 12 }}>{user?.email}</div>
              {navItems.map((item) => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{ ...navLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, border: active ? `1px solid ${C.border}` : '1px solid transparent', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {item.label}
                    {item.live === 'chat'    && reachable.unread > 0
                      ? <span style={unreadPill}>{reachable.unread}</span>
                      : item.live === 'gallery' && reachable.unseenSets > 0
                      ? <span style={unreadPill}>{reachable.unseenSets}</span>
                      : <LiveDot show={isLive(item)} />}
                  </Link>
                );
              })}
            </aside>
            <main style={{ minHeight: isFullscreen ? 0 : '70vh', height: isFullscreen ? '100%' : 'auto', overflow: isFullscreen ? 'hidden' : 'visible', display: isFullscreen ? 'flex' : 'block', flexDirection: 'column' }}>
              <Routes>
                <Route index element={<Navigate to="chat" replace />} />
                <Route path="chat"       element={<Chat />}       />
                <Route path="gallery"    element={<Gallery />}    />
            <Route path="selfies"    element={<Navigate to="/platform/gallery?tab=selfies" replace />} />
                <Route path="membership" element={<Membership />} />
                <Route path="community"  element={<Community />}  />
                <Route path="calls"      element={<Calls />}      />
                <Route path="shop"       element={<Shop />}       />
                {/* Custom requests moved into Shop. Request notifications still link
                here, so this redirects rather than 404s. */}
            <Route path="extras"     element={<Navigate to="/platform/shop?tab=requests" replace />} />
                <Route path="coins"      element={<Coins />}      />
                <Route path="profile"    element={<Profile />}    />
                <Route path="*"          element={<Navigate to="chat" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      )}

      <HelpChat />
      <InstallPrompt />
    </div>
  );
}

// A count where there is one, the availability dot otherwise — the same slot,
// so the nav keeps its shape either way.
const unreadPill = { background: C.accent, color: '#1A1714', fontFamily: F.sans, fontSize: 10, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 };
const navDot = { width: 6, height: 6, borderRadius: '50%', background: '#8FC88F', flexShrink: 0, boxShadow: '0 0 0 3px rgba(143,200,143,0.18)' };

const topBar      = { flexShrink: 0, minHeight: TOP_BAR_H, height: `calc(${TOP_BAR_H}px + env(safe-area-inset-top, 0px))`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `env(safe-area-inset-top, 0px) 16px 0`, background: 'rgba(13,12,10,0.97)', borderBottom: `1px solid ${C.border}`, zIndex: 30, boxSizing: 'border-box' };
const statusBadge = { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 10px' };
const topUpMiniBtn = { background: C.accent, border: 'none', color: '#1A1714', fontWeight: 700, width: 18, height: 18, borderRadius: '50%', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 };
const hamburger   = { display: 'flex', flexDirection: 'column', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, flexShrink: 0 };
const hamburgerBtn = { display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${C.border}`, cursor: 'pointer', padding: '7px 12px', borderRadius: 8, flexShrink: 0 };
const hamburgerIconWrap = { display: 'flex', flexDirection: 'column', gap: 5 };
const hamLine     = { display: 'block', width: 22, height: 2, background: C.text, borderRadius: 2 };
const backButton  = { background: 'transparent', border: 'none', color: C.text, fontSize: 22, cursor: 'pointer', padding: '0 6px', lineHeight: 1, flexShrink: 0 };
const ghostBtn    = { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: F.sans, fontSize: 13 };
const backdrop    = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 40, backdropFilter: 'blur(4px)' };
const drawer      = { position: 'fixed', top: 0, right: 0, width: 260, height: '100dvh', background: C.surface, borderLeft: `1px solid ${C.border}`, zIndex: 50, padding: '24px', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' };
const drawerLink  = { textDecoration: 'none', fontFamily: F.sans, fontSize: 15, padding: '12px 14px', borderRadius: 8, display: 'block' };
const desktopLayout = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: '24px', maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' };
const sidebar     = { display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'start', position: 'sticky', top: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const navLink     = { textDecoration: 'none', fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, display: 'block' };