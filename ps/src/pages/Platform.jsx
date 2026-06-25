// ps/src/pages/Platform.jsx
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { getUser, logout } from '../api';
import InstallPrompt      from '../components/InstallPrompt';
import NotificationBell   from '../components/NotificationBell';

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

export default function Platform() {
  const user     = getUser();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/auth?mode=login'); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* Top bar */}
      <div style={topBar}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 24 }}>Personal Space</div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>{user?.email || 'member'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <NotificationBell />
          <button onClick={handleLogout} style={ghostBtn}>Sign out</button>
        </div>
      </div>

      <div style={layout}>
        {/* Sidebar */}
        <aside style={sidebar}>
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  ...navLink,
                  background: active ? 'rgba(193,125,74,0.12)' : 'transparent',
                  color:      active ? C.text : C.muted,
                  border:     active ? `1px solid ${C.border}` : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </aside>

        {/* Main */}
        <main style={mainArea}>
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

      <InstallPrompt />
    </div>
  );
}

const topBar   = { position: 'sticky', top: 0, zIndex: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: 'rgba(13,12,10,0.92)', borderBottom: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' };
const layout   = { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, padding: 24 };
const sidebar  = { display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'start', position: 'sticky', top: 92, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const navLink  = { textDecoration: 'none', fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8 };
const mainArea = { minHeight: '70vh' };
const ghostBtn = { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontFamily: F.sans };