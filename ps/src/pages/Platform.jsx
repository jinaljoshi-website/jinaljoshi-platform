// ps/src/pages/Platform.jsx
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { getUser, logout } from '../api';
import InstallPrompt    from '../components/InstallPrompt';
import NotificationBell from '../components/NotificationBell';

import Chat       from './Chat';
import Gallery    from './Gallery';
import Membership from './Membership';
import Community  from './Community';
import Calls      from './Calls';
import Shop       from './Shop';
import Extras     from './Extras';
import Coins      from './Coins';

const navItems = [
  { to: '/platform/chat',       label: 'Chat'       },
  { to: '/platform/community',  label: 'Community'  },
  { to: '/platform/gallery',    label: 'Gallery'    },
  { to: '/platform/calls',      label: 'Calls'      },
  { to: '/platform/shop',       label: 'Shop'       },
  { to: '/platform/extras',     label: 'Extras'     },
  { to: '/platform/membership', label: 'Membership' },
  { to: '/platform/coins',      label: 'Coins'      },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function Platform() {
  const user      = getUser();
  const navigate  = useNavigate();
  const location  = useLocation();
  const isMobile  = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/auth?mode=login'); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>

      {/* ── TOP BAR ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isMobile && (
            <button onClick={() => setMenuOpen(!menuOpen)} style={hamburger} aria-label="Menu">
              <span style={{ ...hamLine, transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none', transition: '0.2s' }} />
              <span style={{ ...hamLine, opacity: menuOpen ? 0 : 1, transition: '0.2s' }} />
              <span style={{ ...hamLine, transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none', transition: '0.2s' }} />
            </button>
          )}
          <div>
            <div style={{ fontFamily: F.display, fontSize: isMobile ? 18 : 22 }}>Personal Space</div>
            {!isMobile && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted }}>{user?.email}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <NotificationBell />
          <button onClick={handleLogout} style={ghostBtn}>{isMobile ? '↩' : 'Sign out'}</button>
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
                <Link key={item.to} to={item.to} style={{ ...drawerLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted }}>
                  {item.label}
                </Link>
              );
            })}
            <button onClick={handleLogout} style={{ ...drawerLink, color: C.muted, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', marginTop: 'auto', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              Sign out
            </button>
          </div>
        </>
      )}

      {/* ── MAIN LAYOUT ── */}
      {isMobile ? (
        // Mobile — full width, no sidebar
        <div style={{ padding: '16px 16px', minHeight: 'calc(100vh - 60px)' }}>
          <Routes>
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="chat"       element={<Chat />}       />
            <Route path="gallery"    element={<Gallery />}    />
            <Route path="membership" element={<Membership />} />
            <Route path="community"  element={<Community />}  />
            <Route path="calls"      element={<Calls />}      />
            <Route path="shop"       element={<Shop />}       />
            <Route path="extras"     element={<Extras />}     />
            <Route path="coins"      element={<Coins />}      />
            <Route path="*"          element={<Navigate to="chat" replace />} />
          </Routes>
        </div>
      ) : (
        // Desktop — sidebar + content
        <div style={desktopLayout}>
          <aside style={sidebar}>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 12 }}>{user?.email}</div>
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link key={item.to} to={item.to} style={{ ...navLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, border: active ? `1px solid ${C.border}` : '1px solid transparent' }}>
                  {item.label}
                </Link>
              );
            })}
          </aside>
          <main style={{ minHeight: '70vh' }}>
            <Routes>
              <Route index element={<Navigate to="chat" replace />} />
              <Route path="chat"       element={<Chat />}       />
              <Route path="gallery"    element={<Gallery />}    />
              <Route path="membership" element={<Membership />} />
              <Route path="community"  element={<Community />}  />
              <Route path="calls"      element={<Calls />}      />
              <Route path="shop"       element={<Shop />}       />
              <Route path="extras"     element={<Extras />}     />
              <Route path="coins"      element={<Coins />}      />
              <Route path="*"          element={<Navigate to="chat" replace />} />
            </Routes>
          </main>
        </div>
      )}

      <InstallPrompt />
    </div>
  );
}

const topBar    = { position: 'sticky', top: 0, zIndex: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'rgba(13,12,10,0.95)', borderBottom: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' };
const hamburger = { display: 'flex', flexDirection: 'column', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6 };
const hamLine   = { display: 'block', width: 22, height: 2, background: C.text, borderRadius: 2 };
const ghostBtn  = { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: F.sans, fontSize: 13 };
const backdrop  = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 40, backdropFilter: 'blur(4px)' };
const drawer    = { position: 'fixed', top: 0, left: 0, width: 260, height: '100vh', background: C.surface, borderRight: `1px solid ${C.border}`, zIndex: 50, padding: 24, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' };
const drawerLink = { textDecoration: 'none', fontFamily: F.sans, fontSize: 15, padding: '12px 14px', borderRadius: 8, display: 'block' };
const desktopLayout = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: '24px', maxWidth: 1200, margin: '0 auto' };
const sidebar   = { display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'start', position: 'sticky', top: 80, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const navLink   = { textDecoration: 'none', fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, display: 'block' };