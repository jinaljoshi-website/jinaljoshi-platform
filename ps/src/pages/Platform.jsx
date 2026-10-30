import Notices from './Notices';
// ps/src/pages/Platform.jsx
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api, getUser, logout } from '../api';
import { track } from '../lib/traffic';
import { TIERS, setDisplayCurrency , PHYSICAL_GOODS } from '../data';
import CurrencyPicker from '../components/CurrencyPicker';
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
// Loaded only when somebody goes there.
//
// A static import puts the whole page — its strings, its lattice, its API
// paths — into the one bundle every visitor downloads, so anybody who opened
// the developer tools and searched for it would find it in seconds. That does
// not breach anything, since the server answers 404 to whoever cannot open it,
// but it does mean the section is not unknown, and being unremarkable is most
// of what discretion here amounts to.
//
// Split out, the main bundle carries only a reference. The chunk itself is
// fetched the first time somebody navigates to the section, which is somebody
// who already has access.
const Collections = lazy(() => import('./Collections'));
import Coins      from './Coins';
import Profile    from './Profile';

// Gallery first. It holds nearly everything there is to look at, it is where
// most visits end up, and it was third.
//
// Calls is no longer here. It is one destination with one purpose, reached from
// the chat header instead — somebody who wants a call is already in the
// conversation, and the tab spent a slot saying so a second time. The route is
// unchanged, so every existing link to it still works.
//
// `badge` marks the two that can carry a count. It replaces an older `live`
// property that did double duty: it drove these counts and also a green
// "available now" dot beside Chat and Calls, which has gone.
const navItems = [
  { to: '/platform/gallery',    label: 'Gallery',        badge: 'gallery' },
  { to: '/platform/chat',       label: 'Chat',           badge: 'chat'    },
  // Named for what it now holds. With the outfits and merchandise gone to their
  // own subdomain, what remains is custom requests, and calling that a shop
  // promises a catalogue that is not there.
  { to: PHYSICAL_GOODS ? '/platform/shop' : '/platform/requests',
    label: PHYSICAL_GOODS ? 'Shop' : 'Requests' },
  { to: '/platform/community',  label: 'Public Corner' },
  { to: '/platform/membership', label: 'Membership'    },
  { to: '/platform/coins',      label: 'Coins'         },
  { to: '/platform/notices',    label: 'Notices'       },
  { to: '/platform/profile',    label: 'Profile'       },
];

// Added to the list only for somebody who can open it. The membership status
// carries no key at all for anybody else — not a false one — so there is
// nothing here to notice, and nothing that appears greyed out or locked.
// No label here. A name in the bundle is a name everybody can read, so it comes
// from the server with the access check — and only to somebody who has access.
const collectionsNav = { to: '/platform/collections', gilt: true };

// Reachable, but not in the list — so the mobile header still has a name for
// them. The title used to be read off the nav item, which meant a page that was
// not in the nav was headed "Personal Space".
const OFF_NAV_TITLES = {
  '/platform/calls': 'Calls',
};

// The one nav item that is not the same as the others, because getting to it
// was not the same as getting to the others.
//
// Gold rather than a badge or a dot: a count would say there is something to
// clear, which is the opposite of the register here. The shimmer is light
// crossing gilt — slow enough to be caught out of the corner of an eye rather
// than watched, and long enough between passes that it never nags. Nothing
// moves for anybody who has asked the system not to move things.
const GILT_CSS = `
@keyframes ps-gilt-sweep {
  0%, 82%  { background-position: 180% 0; }
  100%     { background-position: -60% 0; }
}
.ps-gilt {
  background-image: linear-gradient(100deg,
    #C9A96A 0%, #C9A96A 40%, #FFF3D4 50%, #C9A96A 60%, #C9A96A 100%);
  background-size: 260% 100%;
  background-position: 180% 0;
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  animation: ps-gilt-sweep 9s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ps-gilt { animation: none; background-position: 50% 0; }
}
`;

// A shatkona, the figure the screen on the collection page is cut from. Small
// enough to read as a mark rather than an icon.
function GiltMark() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden style={{ flexShrink: 0, opacity: 0.85 }}>
      <path d="M4.5 0.4 L8.3 2.6 L8.3 7 L4.5 9.2 L0.7 7 L0.7 2.6 Z"
            fill="none" stroke="#C9A96A" strokeWidth="0.8" />
    </svg>
  );
}

const FULLSCREEN_PAGES = ['/platform/chat', '/platform/community'];

function useReachable() {
  const [state, setState] = useState({ unread: 0, unseenSets: 0 });
  useEffect(() => {
    let alive = true;
    const check = () => api.get('/api/landing')
      .then((d) => { if (alive) setState({
        unread: d.unreadMessages || 0, unseenSets: d.unseenSets || 0,
      }); })
      .catch(() => {});
    check();
    const id = setInterval(check, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return state;
}

const TOP_BAR_H = 56;
const PROFILE_POLL_MS = 60000;
// How recently a fetch has to have happened for a route change to skip its own.
// Long enough to collapse a walk through the app into one request, short enough
// that the balance after a purchase is never stale on the page it lands on.
const MIN_PROFILE_GAP_MS = 10000;

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
// Holds the document still for as long as the app shell is on screen.
//
// Deliberately scoped to the shell rather than set globally in CSS. Sign up,
// sign in and the policy pages render outside it and are ordinary scrolling
// pages -- locking those made a long form impossible to finish on a phone,
// which is how somebody found this.
// Time left, in the largest unit that still reads as urgent.
function bonusEndsIn(endsAt) {
  const ms = new Date(endsAt) - Date.now();
  if (ms <= 0) return 'ending now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} left`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48)  return `${hrs} hour${hrs === 1 ? '' : 's'} left`;
  return `until ${new Date(endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

function useLockedDocument() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

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

// Persistent tier + token balance, visible on every page — refreshes periodically
// and whenever the route changes, so it stays accurate right after a purchase/unlock.
function StatusBadge({ isMobile }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState(null);

  // Asked for far less often than it was.
  //
  // This refetched on a twenty-second timer *and* on every route change, with
  // nothing between the two — so a fan walking through six screens made
  // twenty-six requests to this one endpoint in under a minute, each paying the
  // round trip to the server. The badge shows a tier and a token balance;
  // neither changes often enough to be worth that.
  //
  // What it keeps is the reason the route-change refetch existed at all: the
  // balance must be right immediately after a purchase or an unlock, and both
  // of those navigate. So a route change still refreshes — unless the last one
  // was moments ago, which is what a walk through the app looks like.
  const lastAt = useRef(0);

  const load = (force = false) => {
    if (!force && Date.now() - lastAt.current < MIN_PROFILE_GAP_MS) return;
    lastAt.current = Date.now();
    api.get('/api/auth/profile').then((d) => setProfile(d.user)).catch(() => {});
  };

  useEffect(() => {
    load(true);
    // Nothing to refresh for somebody who is not looking. A phone with the app
    // in the background was polling every twenty seconds regardless, which on
    // mobile data is a radio waking for no reason.
    const tick = () => { if (!document.hidden) load(true); };
    const interval = setInterval(tick, PROFILE_POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
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
  const vp = useVisualViewport();
  useLockedDocument();

  // Which currency this fan reads prices in. Their own if they chose one and
  // are actually abroad; rupees otherwise. Fetched once here rather than per
  // screen, since every price on the platform depends on it.
  //
  // The counter exists only to force one re-render when the answer arrives, so
  // prices drawn in rupees a moment earlier are rewritten rather than left
  // inconsistent with the rest of the page.
  const [currencyReady, setCurrencyReady] = useState(0);

  const [offer, setOffer] = useState(null);
  useEffect(() => {
    const load = () => api.get('/api/coins/bonus-offer')
      .then((d) => setOffer(d.offer || null))
      .catch(() => {});
    load();
    // Re-read every few minutes so a banner does not outlive the offer it
    // advertises, and so one starting mid-session appears without a reload.
    const id = setInterval(load, 180000);
    return () => clearInterval(id);
  }, []);

  const [currency, setCurrency] = useState(null);
  const [noticeSeen, setNoticeSeen] = useState(() => {
    try { return localStorage.getItem('currencyNoticeSeen') === '1'; } catch { return true; }
  });

  const applyCurrency = (d) => {
    const chosen = (d.options || []).find((o) => o.currency === d.current);
    // bufferPct travels on the response rather than on each option, and money()
    // needs it to match what the server actually charges.
    setDisplayCurrency(d.isForeign && chosen ? { ...chosen, bufferPct: d.bufferPct } : null);
    setCurrency(d);
    setCurrencyReady((n) => n + 1);
  };

  useEffect(() => {
    api.get('/api/coins/currencies')
      .then(applyCurrency)
      .catch(() => setCurrencyReady((n) => n + 1));
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);

  const isFullscreen = FULLSCREEN_PAGES.includes(location.pathname);
  const reachable    = useReachable();

  // The count beside a nav item, or nothing. Returned as a number so the two
  // render sites below cannot disagree about which item carries which figure,
  // which is what happened when each spelled the condition out for itself.
  const badgeCount = (item) =>
    item.badge === 'chat'    ? reachable.unread
  : item.badge === 'gallery' ? reachable.unseenSets
  : 0;

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/auth?mode=login'); };

  // Asked once, from the status the app already fetches. The key is absent for
  // anybody without access, so this is simply false for them and no separate
  // request is ever made that would say the section exists.
  const [canSeeCollections, setCanSeeCollections] = useState(false);
  useEffect(() => {
    let live = true;
    api.get('/api/membership/status')
      .then((d) => { if (live) setCanSeeCollections(d.collections?.label || false); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const nav = canSeeCollections ? [...navItems, { ...collectionsNav, label: canSeeCollections }] : navItems;

  // Injected only when there is something to gild, so the stylesheet carries no
  // trace of the section for anybody who cannot see it.
  useEffect(() => {
    if (!canSeeCollections || document.getElementById('ps-gilt')) return;
    const el = document.createElement('style');
    el.id = 'ps-gilt';
    el.textContent = GILT_CSS;
    document.head.appendChild(el);
  }, [canSeeCollections]);
  const currentNav = nav.find((n) => n.to === location.pathname);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0,
                  height: `${vp.height}px`,
                  transform: `translateY(${vp.offset}px)`,
                  display: 'flex', flexDirection: 'column',
                  background: C.bg, color: C.text, overflow: 'hidden' }}>

      {/* ── TOP BAR ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isMobile ? (
            <button onClick={() => navigate(-1)} style={backButton} aria-label="Back">←</button>
          ) : (
            // The way out.
            //
            // The wordmark was a plain div, so once somebody was inside the
            // platform there was no route back to the homepage at all — the
            // one place every site puts it, and the first place anybody looks.
            <div onClick={() => navigate('/')}
                 role="link" tabIndex={0}
                 onKeyDown={(e) => { if (e.key === 'Enter') navigate('/'); }}
                 title="Back to the homepage"
                 style={{ fontFamily: F.display, fontSize: 22, cursor: 'pointer' }}>
              Personal Space
            </div>
          )}
          <div style={{ fontFamily: isMobile ? F.display : F.sans, fontSize: isMobile ? 17 : 11, color: isMobile ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isMobile ? (currentNav?.label || OFF_NAV_TITLES[location.pathname] || 'Personal Space') : user?.email}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <StatusBadge isMobile={isMobile} />
          <CurrencyPicker state={currency} compact={isMobile}
                          onChange={(code) => setCurrency((s) => ({ ...s, current: code, isForeign: code !== 'INR' }))} />
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
          <div style={{ ...drawer, height: `${vp.height}px`, transform: `translateY(${vp.offset}px)` }}>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, paddingBottom: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
              {user?.email}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {nav.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => track('nav_click', { to: item.to })}
                  style={{ ...drawerLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {item.gilt && <GiltMark />}
                  <span className={item.gilt ? 'ps-gilt' : undefined}>{item.label}</span>
                  {badgeCount(item) > 0 && <span style={unreadPill}>{badgeCount(item)}</span>}
                </Link>
              );
            })}
            </div>
            <div style={{ flexShrink: 0, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%', boxSizing: 'border-box', display: 'block', textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: F.sans, fontSize: 15, color: C.muted,
                  padding: '12px 14px', borderRadius: 8,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {currency?.autoSelected && !noticeSeen && (
        <div style={currencyNotice}>
          <span style={{ flex: 1, minWidth: 200 }}>
            You are outside India, so prices are shown in{' '}
            <strong style={{ color: C.text }}>
              {currency.options?.find((o) => o.currency === currency.autoSelected)?.label || currency.autoSelected}
            </strong>
            . You can change that any time from the top of the page.
          </span>
          <button onClick={() => { setNoticeSeen(true); localStorage.setItem('currencyNoticeSeen', '1'); }}
                  style={noticeClose}>Got it</button>
        </div>
      )}

      {offer && (
        <div style={offerBanner} onClick={() => navigate('/platform/coins')}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <strong style={{ color: '#1A1714' }}>
              {offer.label || `${offer.bonusPct}% bonus tokens`}
            </strong>
            {' — '}
            {offer.minTokens > 0 ? `on ${offer.minTokens} tokens or more. ` : 'on every top up. '}
            {bonusEndsIn(offer.endsAt)}
          </span>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Top up →</span>
        </div>
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
            <Route path="gallery/:setId" element={<Gallery />} />
            <Route path="selfies"    element={<Navigate to="/platform/gallery?tab=selfies" replace />} />
            <Route path="membership" element={<Membership />} />
            <Route path="collections" element={<Suspense fallback={null}><Collections /></Suspense>} />
            <Route path="collections/:setId" element={<Suspense fallback={null}><Collections /></Suspense>} />
            <Route path="community"  element={<Community />}  />
            <Route path="calls"      element={<Calls />}      />
            {/* Named for what it holds.
                //
                // It was the shop, and with the outfits and merchandise gone to
                // their own subdomain what remains is custom requests. The old
                // paths all still resolve: notifications, emails and messages
                // sent months ago point at them, and none of those can be
                // rewritten after the fact. */}
            <Route path="requests"        element={<Shop />} />
            <Route path="requests/:itemId" element={<Shop />} />
            <Route path="shop"            element={<Navigate to="/platform/requests" replace />} />
            <Route path="shop/:itemId"    element={<Shop />} />
            <Route path="outfits/:itemId" element={<Shop />} />
            <Route path="extras"          element={<Navigate to="/platform/requests" replace />} />
            <Route path="notices"    element={<Notices />}    />
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
              {nav.map((item) => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => track('nav_click', { to: item.to })}
                    style={{ ...navLink, background: active ? 'rgba(193,125,74,0.12)' : 'transparent', color: active ? C.text : C.muted, border: active ? `1px solid ${C.border}` : '1px solid transparent', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {item.gilt && <GiltMark />}
                    <span className={item.gilt ? 'ps-gilt' : undefined}>{item.label}</span>
                    {badgeCount(item) > 0 && <span style={unreadPill}>{badgeCount(item)}</span>}
                  </Link>
                );
              })}
            </aside>
            <main style={{ minHeight: isFullscreen ? 0 : '70vh', height: isFullscreen ? '100%' : 'auto', overflow: isFullscreen ? 'hidden' : 'visible', display: isFullscreen ? 'flex' : 'block', flexDirection: 'column' }}>
              <Routes>
                <Route index element={<Navigate to="chat" replace />} />
                <Route path="chat"       element={<Chat />}       />
                <Route path="gallery"    element={<Gallery />}    />
            <Route path="gallery/:setId" element={<Gallery />} />
            <Route path="selfies"    element={<Navigate to="/platform/gallery?tab=selfies" replace />} />
                <Route path="membership" element={<Membership />} />
                <Route path="collections" element={<Suspense fallback={null}><Collections /></Suspense>} />
                <Route path="collections/:setId" element={<Suspense fallback={null}><Collections /></Suspense>} />
                <Route path="community"  element={<Community />}  />
                <Route path="calls"      element={<Calls />}      />
                <Route path="requests"        element={<Shop />} />
            <Route path="requests/:itemId" element={<Shop />} />
            <Route path="shop"            element={<Navigate to="/platform/requests" replace />} />
            <Route path="shop/:itemId"    element={<Shop />} />
            <Route path="outfits/:itemId" element={<Shop />} />
                {/* Custom requests moved into Shop. Request notifications still link
                here, so this redirects rather than 404s. */}
            <Route path="extras"          element={<Navigate to="/platform/requests" replace />} />
                <Route path="notices"    element={<Notices />}    />
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

// A count where there is one, and nothing where there isn't. The green
// availability dot that used to share this slot has gone.
const unreadPill = { background: C.accent, color: '#1A1714', fontFamily: F.sans, fontSize: 10, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 };

const offerBanner = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0, background: C.accent, color: '#1A1714', fontFamily: F.sans, fontSize: 13, lineHeight: 1.5, padding: '10px 16px', cursor: 'pointer' };

const currencyNotice = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0, background: 'rgba(193,125,74,0.08)', borderBottom: `1px solid rgba(193,125,74,0.2)`, color: C.muted, fontFamily: F.sans, fontSize: 12, lineHeight: 1.6, padding: '10px 16px' };
const noticeClose    = { background: 'transparent', border: `1px solid ${C.border}`, color: C.accent, fontFamily: F.sans, fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', flexShrink: 0 };

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
const drawer      = { position: 'fixed', top: 0, right: 0, width: 260, background: C.surface, borderLeft: `1px solid ${C.border}`, zIndex: 50, padding: '24px', boxSizing: 'border-box', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' };
const drawerLink  = { textDecoration: 'none', fontFamily: F.sans, fontSize: 15, padding: '12px 14px', borderRadius: 8, display: 'block' };
const desktopLayout = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: '24px', maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' };
const sidebar     = { display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'start', position: 'sticky', top: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 };
const navLink     = { textDecoration: 'none', fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, display: 'block' };