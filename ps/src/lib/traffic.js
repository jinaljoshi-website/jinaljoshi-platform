// ps/src/lib/traffic.js
//
// Counting a visit, without getting in its way.
//
// Everything here is best-effort. A count that delays a page, throws in a
// console, or blocks a click is worse than no count at all — nobody visits a
// website to be measured, and a measurement that costs them anything has got
// its priorities backwards. Every call is fire-and-forget and every failure is
// swallowed.
//
// sendBeacon where the browser has it: it survives the page being closed, which
// is exactly when the last and most interesting event happens. fetch with
// keepalive is the fallback, and if neither works the count is simply lost.

const API  = import.meta.env.VITE_API_URL || '';
const SITE = 'ps';

// The campaign that brought somebody here, kept for the whole visit rather than
// only the first page — otherwise every referral looks like it landed and
// bounced, because the parameters vanish on the second click.
let campaign = null;
try {
  const q = new URLSearchParams(window.location.search);
  const source = q.get('utm_source');
  if (source) {
    campaign = { utm_source: source, utm_campaign: q.get('utm_campaign') || null };
    sessionStorage.setItem('ps_campaign', JSON.stringify(campaign));
  } else {
    const held = sessionStorage.getItem('ps_campaign');
    if (held) campaign = JSON.parse(held);
  }
} catch { /* private browsing, or no storage — the visit still counts */ }

function send(body) {
  try {
    const payload = JSON.stringify({ site: SITE, ...campaign, ...body });
    const url = `${API}/api/traffic/hit`;

    // A token when there is one, so a member's browsing can be attributed.
    // sendBeacon cannot set headers, so anything needing the token goes by
    // fetch; the rest can use the beacon and survive the page closing.
    const token = localStorage.getItem('jwt');
    if (token) {
      fetch(url, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload,
      }).catch(() => {});
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {});
    }
  } catch { /* never worth surfacing */ }
}

// A page was looked at.
export function pageView(path) {
  send({ path: path || window.location.pathname, referrer: document.referrer || null });
}

// Something was done that the API will never hear about.
//
// Anything the server already records — a set opened, a message sent, tokens
// bought — is deliberately not sent here. Two counts of one event drift apart,
// and then neither can be trusted.
export function track(event, meta) {
  send({ path: window.location.pathname, event, meta: meta || undefined });
}

// Errors, so a page that renders but does nothing is visible as a number rather
// than only when somebody happens to try it.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    track('error', { msg: String(e.message || '').slice(0, 140) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    track('error', { msg: String(e.reason?.message || e.reason || '').slice(0, 140) });
  });
}