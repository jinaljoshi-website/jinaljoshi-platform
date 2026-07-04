// studio/src/pages/Studio.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser, logout } from '../api';
import { StudioNotificationBell } from '../components/NotificationBell';

import { Dashboard }     from '../sections/Dashboard';
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
  { id: 'messages',      label: 'Messages'      },
  { id: 'content',       label: 'Content'       },
  { id: 'merch',         label: 'Merchandise'   },
  { id: 'extras',        label: 'Extras'        },
  { id: 'members',       label: 'Members'       },
  { id: 'calls',         label: 'Calls'         },
  { id: 'availability',  label: 'Availability'  },
  { id: 'requests',      label: 'Requests'      },
  { id: 'community',     label: 'Community'     },
  { id: 'notifications', label: 'Notifications' },
  { id: 'settings',      label: 'Settings'      },
];

const SECTIONS = {
  dashboard:     Dashboard,
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

export default function Studio() {
  const [active, setActive] = useState('dashboard');
  const navigate = useNavigate();
  const user     = getUser();

  const handleLogout = () => { logout(); navigate('/login'); };
  const Section = SECTIONS[active] || Dashboard;

  return (
    <div style={{ minHeight: '100vh', background: bg, color: text, display: 'grid', gridTemplateColumns: '220px 1fr' }}>
      <aside style={{ background: surface, borderRight: `1px solid ${border}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontFamily: display, fontSize: 22, color: text }}>Studio</div>
          <StudioNotificationBell />
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.1em', marginBottom: 24 }}>{user?.email}</div>

        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            style={{
              background:   active === item.id ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:       active === item.id ? '1px solid rgba(193,125,74,0.2)' : '1px solid transparent',
              color:        active === item.id ? text : muted,
              fontFamily:   sans, fontSize: 14,
              padding:      '10px 14px', borderRadius: 8,
              cursor:       'pointer', textAlign: 'left',
            }}
          >
            {item.label}
          </button>
        ))}

        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
          <button
            onClick={handleLogout}
            style={{ background: 'transparent', border: `1px solid ${border}`, color: muted, fontFamily: sans, fontSize: 13, padding: '9px 14px', borderRadius: 8, cursor: 'pointer', width: '100%' }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ padding: 32, overflowY: 'auto' }}>
        <Section />
      </main>
    </div>
  );
}