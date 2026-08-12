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
import { Website }       from '../sections/Website';
import { Invoices }      from '../sections/Invoices';
import { Selfies }       from '../sections/Selfies';
import { Photographers } from '../sections/Photographers';
import { Activity }      from '../sections/Activity';
import { MerchMedia }    from '../sections/MerchMedia';
import { RingWatch }     from '../components/RingWatch';

// Two groups, because two different jobs share this login. Jinal answers
// messages and takes calls; the pricing, tax and payout screens are somebody
// else's work and being one tap from her thumb mid-conversation is a hazard
// rather than a convenience.
//
// Names match what fans see. "Content" meant nothing to anyone reading the
// fan-side Gallery, and a Studio that uses different words for the same things
// makes every conversation about the platform slower than it needs to be.
const NAV = [
  { id: 'dashboard',     label: 'Dashboard'        },
  { id: 'messages',      label: 'Chat'             },
  { id: 'community',     label: 'Public Corner'    },
  { id: 'content',       label: 'Gallery'          },
  { id: 'calls',         label: 'Calls'            },
  { id: 'requests',      label: 'Custom Requests'  },
  { id: 'merch',         label: 'Merchandise'      },
  { id: 'activity',      label: 'Member Activity'  },
];

// Reached through a single door at the bottom rather than sitting in the list.
const ADMIN_NAV = [
  { id: 'members',       label: 'Members'       },
  { id: 'analytics',     label: 'Money'         },
  { id: 'invoices',      label: 'Invoices'      },
  { id: 'photographers', label: 'Photographers' },
  { id: 'merchmedia',    label: 'Media library' },
  { id: 'notifications', label: 'Send a push'   },
  { id: 'website',       label: 'Website'       },
  { id: 'settings',      label: 'Settings'      },
];

const ADMIN_IDS = new Set(ADMIN_NAV.map((n) => n.id));

// Screens that manage their own height rather than scrolling as a page. A chat
// is a fixed frame with a scrolling list inside it; putting one in a scrolling
// wrapper is what lets the keyboard push the composer around.
const FULLSCREEN_SECTIONS = new Set(['messages', 'community']);

// Availability, Selfie of the Day and the request menu are now tabs inside
// Calls, Gallery and Custom Requests. Kept resolvable so an old link or a
// dashboard card still lands on the right tab rather than an empty screen.
const MERGED_INTO = {
  availability: ['calls',    { filter: 'availability' }],
  selfies:      ['content',  { filter: 'selfies' }],
  extras:       ['requests', { filter: 'menu' }],
};

// One renderer for both layouts. The drawer and the sidebar had copies of the
// same markup, which is how they end up subtly different.
function NavList({ items, active, onSelect, fontSize, padding }) {
  return items.map((item) => (
    <button
      key={item.id}
      onClick={() => onSelect(item.id)}
      style={{
        background: active === item.id ? 'rgba(193,125,74,0.12)' : 'transparent',
        border:     active === item.id ? '1px solid rgba(193,125,74,0.2)' : '1px solid transparent',
        color:      active === item.id ? text : muted,
        fontFamily: sans, fontSize,
        padding, borderRadius: 8,
        cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%',
        marginBottom: 4, boxSizing: 'border-box',
      }}
    >
      {item.label}
    </button>
  ));
}

// The door to everything that is not day-to-day. Deliberately a step rather
// than a list item — the point is that nothing behind it is reachable by
// accident while she is mid-conversation.
function AdminDoor({ open, onToggle, active, onSelect }) {
  return (
    <div style={{ paddingTop: 14, borderTop: `1px solid ${border}` }}>
      {open && (
        <div style={{ marginBottom: 8 }}>
          <NavList items={ADMIN_NAV} active={active} onSelect={onSelect} fontSize={13} padding="9px 14px" />
        </div>
      )}
      <button onClick={onToggle}
        style={{
          background: 'transparent', border: `1px solid ${border}`, color: muted,
          fontFamily: sans, fontSize: 12, padding: '10px 14px', borderRadius: 8,
          cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
        <span>Admin &amp; settings</span>
        <span style={{ opacity: 0.7 }}>{open ? '\u2013' : '+'}</span>
      </button>
    </div>
  );
}

const SECTIONS = {
  dashboard:     Dashboard,
  analytics:     Analytics,
  messages:      Messages,
  content:       Content,
  selfies:       Selfies,
  photographers: Photographers,
  activity:      Activity,
  merchmedia:    MerchMedia,
  merch:         Merch,
  extras:        Extras,
  members:       Members,
  calls:         Calls,
  availability:  Availability,
  requests:      Requests,
  community:     Community,
  notifications: Notifications,
  website:       Website,
  invoices:      Invoices,
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

// Where the visible area is, and how tall.
//
// The thing that took four attempts to understand: iOS does not scroll the
// document when the keyboard opens. It slides the *visual viewport* upward to
// reveal the focused input, and nothing inside the page can prevent that --
// overflow: hidden does not apply, because no element is scrolling.
//
// So the shell stops fighting it and travels with it instead. Fixed to the
// viewport, sized to what is visible, and pushed down by exactly the amount iOS
// pushed the viewport up. The two cancel, and the page appears not to move at
// all while the keyboard takes its space from the message list.
function useVisualViewport() {
  const read = () => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    offset: window.visualViewport?.offsetTop ?? 0,
  });
  const [vp, setVp] = useState(read);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = null;
    const update = () => {
      // Coalesced into a frame. The viewport reports continuously while the
      // keyboard animates, and re-rendering the shell on every report is what
      // made an earlier version stutter.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setVp((prev) => {
          const next = read();
          return (Math.abs(next.height - prev.height) < 1 &&
                  Math.abs(next.offset - prev.offset) < 1) ? prev : next;
        });
      });
    };

    // scroll matters as much as resize here: offsetTop only changes on scroll,
    // and it is the half that keeps the shell still. Safe to listen to now that
    // nothing writes back to the scroll position.
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return vp;
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

// Notifications link to /calls, /merch, /requests and /messages, which match the
// section ids exactly. Studio has no router, so it reads the path itself and
// keeps the URL in step — a notification now opens the right section.
function sectionFromPath() {
  const seg = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return SECTIONS[seg] ? seg : 'dashboard';
}

export default function Studio() {
  const [active, setActive]     = useState(sectionFromPath);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate  = useNavigate();
  const user      = getUser();
  const isMobile  = useIsMobile();
  const vp = useVisualViewport();

  const handleLogout = () => { logout(); navigate('/login'); };
  const Section = SECTIONS[active] || Dashboard;
  // Opened automatically when an admin screen is showing, so a direct link or a
  // reload does not leave the door shut on the page she is looking at.
  const [adminOpen, setAdminOpen] = useState(ADMIN_IDS.has(active));
  useEffect(() => { if (ADMIN_IDS.has(active)) setAdminOpen(true); }, [active]);

  // What a section should open showing. A dashboard card saying three calls
  // need answering opens those three rather than the whole list.
  const [sectionState, setSectionState] = useState(null);

  // Cleared on a plain nav click, so a filter set by a dashboard card does not
  // silently persist the next time she opens that section herself.
  const goTo = (section, state = null) => {
    const merged = MERGED_INTO[section];
    if (merged) {
      setSectionState(merged[1]);
      selectSection(merged[0]);
      return;
    }
    setSectionState(state);
    selectSection(section);
  };

  const currentLabel = [...NAV, ...ADMIN_NAV].find((n) => n.id === active)?.label || 'Studio';

  const selectSection = (id) => {
    setActive(id);
    setMenuOpen(false);
    window.history.pushState({}, '', id === 'dashboard' ? '/' : `/${id}`);
  };

  // Back and forward should move between sections, not out of Studio.
  useEffect(() => {
    const onPop = () => setActive(sectionFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0,
                  height: `${vp.height}px`,
                  transform: `translateY(${vp.offset}px)`,
                  display: 'flex', flexDirection: 'column',
                  background: bg, color: text, overflow: 'hidden' }}>

      <RingWatch onOpenCalls={() => setActive('calls')} />

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
          <div style={{ ...drawer, height: `${vp.height}px`, transform: `translateY(${vp.offset}px)` }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.1em', marginBottom: 20, paddingBottom: 14, borderBottom: `1px solid ${border}` }}>
              {user?.email}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <NavList items={NAV} active={active} onSelect={(id) => goTo(id)} fontSize={15} padding="12px 14px" />
            </div>
            <div style={{ flexShrink: 0 }}>
              <AdminDoor open={adminOpen} onToggle={() => setAdminOpen(!adminOpen)}
                         active={active} onSelect={(id) => goTo(id)} />
              <button
                onClick={handleLogout}
                style={{ background: 'transparent', border: `1px solid ${border}`, color: muted, fontFamily: sans, fontSize: 13, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', marginTop: 12, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── CONTENT AREA ── */}
      {isMobile ? (
        <div style={FULLSCREEN_SECTIONS.has(active)
          ? { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
          : { flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, boxSizing: 'border-box' }}>
          <Section onNavigate={goTo} openWith={sectionState} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '220px 1fr', overflow: 'hidden' }}>
          <aside style={{ background: surface, borderRight: `1px solid ${border}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.1em', marginBottom: 24 }}>{user?.email}</div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <NavList items={NAV} active={active} onSelect={(id) => goTo(id)} fontSize={14} padding="10px 14px" />
            </div>
            <div style={{ flexShrink: 0 }}>
              <AdminDoor open={adminOpen} onToggle={() => setAdminOpen(!adminOpen)}
                         active={active} onSelect={(id) => goTo(id)} />
            </div>
          </aside>
          <main style={FULLSCREEN_SECTIONS.has(active)
            ? { minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 20 }
            : { padding: 32, overflowY: 'auto' }}>
            <Section onNavigate={goTo} openWith={sectionState} />
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
const drawer    = { position: 'fixed', top: 0, right: 0, width: 260, background: surface, borderLeft: `1px solid ${border}`, zIndex: 50, padding: '24px', boxSizing: 'border-box', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' };