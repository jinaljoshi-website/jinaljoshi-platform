// backend/middleware/rateLimit.js
//
// Refusing the tenth attempt at something nobody does nine times.
//
// ── What this is for ────────────────────────────────────────────────
//
// Nothing here stops a determined attacker; it stops a script. Password
// guessing, bulk account creation, and — the one that costs real money —
// hammering the endpoints that send email, because every one of those spends
// somebody's quota and a bounced domain is far harder to undo than a blocked
// request.
//
// ── Deliberately generous ───────────────────────────────────────────
//
// Every limit is set far above what a person could plausibly do. Ten logins in
// a quarter of an hour is not somebody who mistyped; it is a machine. Setting
// these tightly would trade a real risk — locking out a member who genuinely
// forgot their password — against an imagined one, and the real risk is worse.
//
// ── Held in memory, and honest about it ─────────────────────────────
//
// A Map, not a table. No per-request write, no dependency, nothing to maintain.
// It resets when the service restarts, which means a deploy hands an attacker a
// fresh allowance — acceptable at this size, and worth saying plainly rather
// than implying a guarantee this does not make. If the platform ever runs on
// two instances this becomes two half-limits, and would need moving to Postgres
// or Redis.

const WINDOWS = new Map();

// Cleared periodically, or the map grows for ever on a long-running process.
// Every ten minutes is often enough that it never holds more than a few
// thousand entries, and rare enough to cost nothing.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of WINDOWS) {
    if (now > entry.resetAt) WINDOWS.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

function hit(key, limit, windowMs) {
  const now = Date.now();
  const entry = WINDOWS.get(key);

  if (!entry || now > entry.resetAt) {
    WINDOWS.set(key, { count: 1, resetAt: now + windowMs, warned: false });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  return {
    ok: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
    count: entry.count,
    entry,
  };
}

// The address the request really came from, not the proxy's.
function ipOf(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * limit({ name, max, windowMs, by })
 *
 * `by` returns the thing being counted against — an address, an email, a user
 * id. Returning null skips the check entirely, which is how the artist is let
 * through: she uses Studio far harder than any fan uses the API, and locking
 * her out mid-upload would be a self-inflicted outage.
 */
function limit({ name, max, windowMs, by }) {
  return (req, res, next) => {
    let subject;
    try { subject = by(req); } catch { subject = ipOf(req); }
    if (!subject) return next();

    const key = `${name}:${subject}`;
    const r = hit(key, max, windowMs);

    if (r.ok) return next();

    // Logged once per window, not once per request — an attacker hammering an
    // endpoint would otherwise write the log rather than be recorded in it.
    if (r.entry && !r.entry.warned) {
      r.entry.warned = true;
      console.warn(`rate limit hit: ${name} · ${subject} · ${r.count} in ${Math.round(windowMs / 60000)}m`);
    }

    const waitSeconds = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', waitSeconds);
    return res.status(429).json({
      error: 'TOO_MANY',
      // Told how long to wait.
      //
      // This does tell somebody probing the endpoint what the window is. That
      // is a poor trade to worry about: the alternative is a member who forgot
      // their password being refused with no idea whether to try again in a
      // minute or tomorrow, and the window is guessable in a few requests
      // anyway.
      retryAfterSeconds: waitSeconds,
      message: waitSeconds > 90
        ? `Too many attempts. Try again in ${Math.ceil(waitSeconds / 60)} minutes.`
        : `Too many attempts. Try again in ${waitSeconds} seconds.`,
    });
  };
}

const MIN = 60 * 1000;

// Two keys for login, because they are two different attacks.
//
// Ten attempts from one address is somebody working through passwords. Ten
// addresses against one email is somebody working through a list of stolen
// ones, and an address limit would never see it.
const loginByIp = limit({
  name: 'login-ip', max: 10, windowMs: 15 * MIN, by: ipOf,
});
const loginByEmail = limit({
  name: 'login-email', max: 10, windowMs: 15 * MIN,
  by: (req) => (req.body?.email || '').trim().toLowerCase() || null,
});

const signup = limit({
  name: 'signup', max: 5, windowMs: 60 * MIN, by: ipOf,
});

// Anything that sends an email is limited by the address it would send to.
// Each one spends the mail quota, and a domain marked as a sender of unwanted
// mail is far harder to undo than a refused request.
const byEmailInBody = (req) => (req.body?.email || '').trim().toLowerCase() || null;

const resendVerification = limit({
  name: 'resend-verification', max: 3, windowMs: 60 * MIN, by: byEmailInBody,
});
const forgotPassword = limit({
  name: 'forgot-password', max: 3, windowMs: 60 * MIN, by: byEmailInBody,
});

// Upload URLs, per signed-in member. Generous: a real upload of several hundred
// photographs asks for one of these per file, and being cut off halfway would
// lose the lot.
const presign = limit({
  name: 'presign', max: 400, windowMs: 60 * MIN,
  by: (req) => (req.user?.isArtist ? null : req.user?.userId || ipOf(req)),
});

module.exports = {
  limit, ipOf,
  loginByIp, loginByEmail, signup,
  resendVerification, forgotPassword, presign,
};