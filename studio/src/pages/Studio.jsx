// studio/src/pages/Studio.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser, logout } from '../api';
import { StudioNotificationBell } from '../components/NotificationBell';

import { Dashboard }     from '../sections/Dashboard';
import { Analytics }     from '../sections/Analytics';
import { Messages }      from '../sections/Messages';
import { Content }       from '../sections/Content';
import { Merch }         from '../sections/Merch';
import { Extras }        from '../sections/Extras';
import { Members }       from '../sections/Members';
import { Calls }         from '../sections/Calls';
import { Availability }  from '../sections/Availability';
import { Requests }      from '../sections/Requests';
import { Community }     from '../sections/Community';
import { Settings }      from '../sections/Settings';
import { Notifications } from '../sections/Notifications';

const NAV = [
  { id: 'dashboard',     label: 'Dashboard'     },
  { id: 'analytics',     label: 'Analytics'     },
  { id: 'messages',      label: 'Messages'      },
  { id: 'content',       label: 'Content'       },
  { id: 'merch',         label: 'Merchandise'   },
  { id: 'extras',        label: 'Extras'        },
  { id: 'members',       label: 'Members'       },
  { id: 'calls',         label: 'Calls'         },
  { id: 'availability',  label: 'Availability'  },
  { id: 'requests',      label: 'Requests'      },
  { id: 'community',     label: 'The Happening Place'     },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings',      label: 'Settings'      },
];

const SECTIONS = {
  dashboard:     Dashboard,
  analytics:     Analytics,
  messages:      Messages,
  content:       Content,
  merch:         Merch,
  extras:        Extras,
  members:       Members,
  calls:         Calls,
  availability:  Availability,
  requests:      Requests,
  community:     Community,
  notifications: Notifications,
  settings:      Settings,
};

const sans    = "'DM Sans', system-ui, sans-serif";
const display = "'Cormorant Garamond', Georgia, serif";
const mono    = "'DM Mono', 'Courier New', monospace";
const bg      = '#0D0C0A';
const surface = '#161410';
const text    = '#F2EBE0';
const muted   = '#9B8F83';
const border  = 'rgba(242,235,224,0.08)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function Studio() {
  const [active, setActive]     = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate  = useNavigate();
  const user      = getUser();
  const isMobile  = useIsMobile();

  const handleLogout = () => { logout(); navigate('/login'); };
  const Section = SECTIONS[active] || Dashboard;
  const currentLabel = NAV.find((n) => n.id === active)?.label || 'Studio';

  const selectSection = (id) => {
    setActive(id);
    setMenuOpen(false);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: bg, color: text, overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontFamily: display, fontSize: isMobile ? 20 : 22, color: text }}>Studio</span>
          {isMobile && <span style={{ fontFamily: sans, fontSize: 13, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {currentLabel}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <StudioNotificationBell />
          {isMobile ? (
            <button onClick={() => setMenuOpen(!menuOpen)} style={hamburgerBtn} aria-label="Menu">
              <span style={hamburgerIconWrap}>
                <span style={{ ...hamLine, transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none', transition: '0.2s' }} />
                <span style={{ ...hamLine, opacity: menuOpen ? 0 : 1, transition: '0.2s' }} />
                <span style={{ ...hamLine, transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none', transition: '0.2s' }} />
              </span>
              <span style={{ fontFamily: sans, fontSize: 13, color: text }}>Menu</span>
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
            <div style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.1em', marginBottom: 20, paddingBottom: 14, borderBottom: `1px solid ${border}` }}>
              {user?.email}
            </div>
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => selectSection(item.id)}
                style={{
                  background: active === item.id ? 'rgba(193,125,74,0.12)' : 'transparent',
                  border:     active === item.id ? '1px solid rgba(193,125,74,0.2)' : '1px solid transparent',
                  color:      active === item.id ? text : muted,
                  fontFamily: sans, fontSize: 15,
                  padding:    '12px 14px', borderRadius: 8,
                  cursor:     'pointer', textAlign: 'left', display: 'block', width: '100%',
                  marginBottom: 4, boxSizing: 'border-box',
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={handleLogout}
              style={{ background: 'transparent', border: `1px solid ${border}`, color: muted, fontFamily: sans, fontSize: 13, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', marginTop: 20 }}
            >
              Sign out
            </button>
          </div>
        </>
      )}

      {/* ── CONTENT AREA ── */}
      {isMobile ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, boxSizing: 'border-box' }}>
          <Section />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '220px 1fr', overflow: 'hidden' }}>
          <aside style={{ background: surface, borderRight: `1px solid ${border}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.1em', marginBottom: 24 }}>{user?.email}</div>
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                style={{
                  background: active === item.id ? 'rgba(193,125,74,0.12)' : 'transparent',
                  border:     active === item.id ? '1px solid rgba(193,125,74,0.2)' : '1px solid transparent',
                  color:      active === item.id ? text : muted,
                  fontFamily: sans, fontSize: 14,
                  padding:    '10px 14px', borderRadius: 8,
                  cursor:     'pointer', textAlign: 'left',
                }}
              >
                {item.label}
              </button>
            ))}
          </aside>
          <main style={{ padding: 32, overflowY: 'auto' }}>
            <Section />
          </main>
        </div>
      )}
    </div>
  );
}

const topBar    = { flexShrink: 0, minHeight: 56, height: `calc(56px + env(safe-area-inset-top, 0px))`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `env(safe-area-inset-top, 0px) 20px 0`, background: 'rgba(13,12,10,0.97)', borderBottom: `1px solid ${border}`, zIndex: 30, boxSizing: 'border-box' };
const ghostBtn  = { background: 'transparent', border: `1px solid ${border}`, color: text, fontFamily: sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const hamburgerBtn = { display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${border}`, cursor: 'pointer', padding: '7px 12px', borderRadius: 8, flexShrink: 0 };
const hamburgerIconWrap = { display: 'flex', flexDirection: 'column', gap: 5 };
const hamLine   = { display: 'block', width: 18, height: 2, background: text, borderRadius: 2 };
const backdrop  = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 40, backdropFilter: 'blur(4px)' };
const drawer    = { position: 'fixed', top: 0, right: 0, width: 260, height: '100vh', background: surface, borderLeft: `1px solid ${border}`, zIndex: 50, padding: '24px', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' };