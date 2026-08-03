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
import Membership from './Membership';
import Community  from './Community';
import Calls      from './Calls';
import Shop       from './Shop';
import Coins      from './Coins';
import Profile    from './Profile';

const navItems = [
  { to: '/platform/community',  label: 'Public Corner'  },
  { to: '/platform/gallery',    label: 'Gallery'    },
  { to: '/platform/membership', label: 'Membership' },
  { to: '/platform/shop',       label: 'Shop'       },
  { to: '/platform/calls',      label: 'Calls'      },
  { to: '/platform/chat',       label: 'Messages'   },
  { to: '/platform/coins',      label: 'Coins'      },
  { to: '/platform/profile',    label: 'Profile'    },
];

const FULLSCREEN_PAGES = ['/platform/chat', '/platform/community'];
const TOP_BAR_H = 56;
const PROFILE_POLL_MS = 20000;

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
  const [menuOpen, setMenuOpen] = useState(false);

  const isFullscreen = FULLSCREEN_PAGES.includes(location.pathname);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/auth?mode=login'); };

  const currentNav = navItems.find((n) => n.to === location.pathname);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, overflow: 'hidden' }}>

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
                  style={{ ...drawerLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted }}
                >
                  {item.label}
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
                    style={{ ...navLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, border: active ? `1px solid ${C.border}` : '1px solid transparent' }}
                  >
                    {item.label}
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

      <InstallPrompt />
    </div>
  );
}

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
const drawer      = { position: 'fixed', top: 0, right: 0, width: 260, height: '100vh', background: C.surface, borderLeft: `1px solid ${C.border}`, zIndex: 50, padding: '24px', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' };
const drawerLink  = { textDecoration: 'none', fontFamily: F.sans, fontSize: 15, padding: '12px 14px', borderRadius: 8, display: 'block' };
const desktopLayout = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: '24px', maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' };
const sidebar     = { display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'start', position: 'sticky', top: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const navLink     = { textDecoration: 'none', fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, display: 'block' };