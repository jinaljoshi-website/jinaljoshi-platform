// backend/lib/integrity.js
//
// Catching somebody mapping the platform for a way in, and shutting the door
// on them in the same request.
//
// ── Why this is separate from moderation.js ─────────────────────────
//
// moderation.js handles conduct: a member who is rude or spamming gets 24
// hours, then 7 days, then 30, and it lifts itself. That is right for a member
// who went too far, where the point is to cool things down.
//
// Someone sending <img src=x onerror=...> as their display name is not a member
// who went too far. They should not occupy the first rung of a ladder built for
// members, and they should not be let back in because a day passed. So this
// sets its own flag, with no duration, lifted only by hand from Studio.
//
// ── What it watches, and why content rather than volume ─────────────
//
// The obvious instinct is to count: too many signups, too many requests. That
// was tried and it does not catch this. The signup limit is 30 per IP per hour
// and it is generous on purpose, because locking out a member who forgot their
// password is worse than a script getting a few tries. Eight accounts in 28
// minutes sits comfortably inside it, and tightening it would hurt real people
// to inconvenience a scanner.
//
// Content is the better signal, and by a wide margin. A member never types
// onerror= into their display name. Not once, in any language, by accident.
// So the detector keys on the shape of what was written, which catches a
// scanner on its first request rather than its thirtieth, and cannot plausibly
// misfire on somebody genuine.
//
// ── The rails ───────────────────────────────────────────────────────
//
// An automatic, indefinite block is a loaded weapon, so it points away from
// anyone who could be a real member:
//
//   · Jinal is never scanned and never blocked. She can type anything.
//   · Anyone who has ever paid is never auto-blocked. The write is still
//     refused, and she gets told, but the account stays open. One wrongly
//     locked supreme member costs more than a scanner getting twenty minutes.
//   · Only 'critical' blocks. Those are patterns with no innocent reading.
//     'suspicious' is recorded and reported, and does nothing on its own.
//   · Everything is logged and everything is reversible from Studio.
//
// Refusing the write is separate from blocking, and always happens. Even for
// Jinal's most valuable member, a payload does not get stored.

const pool = require('../db/pool');
const { logModerationAction } = require('./moderation');
const { getConfigValue } = require('./config');

// Required where it is used, not here. notify.js configures web-push as it
// loads and throws if the VAPID keys are absent, and a detector that refuses
// to load because the push keys are missing would be a security hole dressed
// as a configuration error. Refusing the write must never depend on being
// able to send a notification about it.
function notifyArtist(payload) {
  return require('./notify').notifyArtist(payload);
}

// Attacker input, stored bounded. Keeping the whole of it would be its own
// small denial of service.
const SAMPLE_MAX = 300;

// ── Critical: no innocent reading ───────────────────────────────────
//
// Each of these was checked against the kind of thing members actually write,
// including Hinglish, punctuation and emoji. The notes are the reasoning, kept
// here because a pattern loosened later without it would quietly start
// blocking real people.
const CRITICAL = [
  // A script tag in any spelling, opening or closing.
  { signal: 'script_tag', re: /<\s*\/?\s*script\b/i },

  // svg and iframe are the usual carriers once script is filtered.
  { signal: 'svg_tag',    re: /<\s*svg\b/i },
  { signal: 'iframe_tag', re: /<\s*iframe\b/i },
  { signal: 'object_tag', re: /<\s*(?:object|embed|base)\b/i },

  // An inline event handler. The handler names are listed rather than matching
  // on* generally, because on its own /\bon\w+=/ would catch "on1=" in a
  // sentence about pricing.
  { signal: 'event_handler',
    re: /\bon(?:error|load|click|mouseover|mouseenter|focus|blur|submit|toggle|begin|animationstart|animationend|transitionend|pointerover|beforeprint)\s*=/i },

  // javascript: only where it is being used as a URL. Required to follow an
  // attribute, a quote, a bracket or an equals, so a member writing about the
  // language ("javascript: a good first language") does not trip it.
  { signal: 'js_scheme', re: /(?:href|src|action|formaction|data|=|\(|"|'|\[)\s*(?:javascript|vbscript)\s*:/i },

  // An img tag carrying any attribute. A bare <img> is odd but harmless; one
  // with attributes is a payload.
  { signal: 'img_tag_attr', re: /<\s*img\b[^>]*=/i },

  // document.cookie and friends: reading the session out of the page.
  { signal: 'session_theft', re: /document\s*\.\s*(?:cookie|domain|write)|localStorage\s*\.\s*getItem|\bfetch\s*\(\s*['"`]https?:/i },

  // A SQL tautology: ' OR 1=1, ' AND '1'='1, and the spacing variants.
  // Requires the quote, so an Irish surname and "and 1 more" are both safe.
  { signal: 'sql_tautology', re: /['"]\s*(?:or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d/i },

  { signal: 'sql_union',  re: /\bunion\s+(?:all\s+)?select\b/i },
  { signal: 'sql_delay',  re: /\b(?:pg_sleep|sleep|benchmark|waitfor\s+delay)\s*\(/i },
  { signal: 'sql_comment_probe', re: /(?:--|#|\/\*)\s*$|;\s*(?:drop|delete|update|insert)\s+/i },

  // Climbing out of a directory. Two levels, because a single ../ appears in
  // ordinary relative paths.
  { signal: 'path_traversal', re: /(?:\.\.[/\\]){2,}|%2e%2e(?:%2f|%5c)|\.\.%2f/i },

  // A null byte or a CRLF, both of which are only ever sent to break a parser.
  { signal: 'null_byte',      re: /%00|\u0000/ },
  { signal: 'crlf_injection', re: /%0d%0a|%0a%0d|\r\n\s*(?:set-cookie|location|content-length)\s*:/i },

  // The same payloads arriving pre-encoded, which is the next thing tried once
  // the plain ones are refused.
  { signal: 'encoded_payload',
    re: /&(?:lt|#0*60|#x0*3c);\s*\/?\s*(?:script|svg|img|iframe)|%3c\s*(?:script|svg|img|iframe)/i },

  // Server-side template injection, in the shapes scanners actually send:
  // braces wrapped around an expression, not braces on their own.
  { signal: 'template_injection',
    re: /\$\{\s*[\w.$[\]]*\s*[-+*/]\s*[\w.$[\]]*\s*\}|\{\{\s*[\w.]*\s*[-+*/]\s*[\w.]*\s*\}\}|\{\{\s*(?:config|self|request|__class__|globals)\b/i },

  // ${jndi:ldap://...} and relatives. Not exploitable here — that one needs
  // Java, and this is Node — but nothing except a scanner has ever sent it,
  // and catching it costs nothing. The point is identifying the sender, not
  // defending the hole.
  { signal: 'jndi_probe', re: /\$\{\s*(?:jndi|ldap|rmi|dns|iiop|corba|nis|nds)\s*:/i },

  // Node internals by name. No member writes these.
  { signal: 'node_gadget', re: /\b(?:child_process|require\s*\(\s*['"]fs['"]|process\s*\.\s*env|__proto__|constructor\s*\[)/i },
];

// ── Suspicious: worth telling her about, never blocks on its own ────
const SUSPICIOUS = [
  // A complete tag of some other kind. Real text can produce this ("x<y and
  // z>3"), rarely, which is exactly why it does not block.
  { signal: 'html_tag', re: /<\s*[a-z][a-z0-9]*(?:\s[^>]{0,200})?>/i },

  // Braces with something inside, short of the operator the critical pattern
  // wants. Template probing often starts here.
  { signal: 'template_braces', re: /\$\{[^}]{1,80}\}|\{\{[^}]{1,80}\}\}/ },

  // A URL where a person's name belongs, which is spam. Confined to name
  // fields by onlyFields, because running it everywhere flagged real members
  // pasting a Google share link into chat to show Jinal what they wanted —
  // which is not merely harmless, it is the feature working.
  { signal: 'url_in_name', re: /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i,
    onlyFields: /name/i },
];

// Scans one value. Critical wins over suspicious, and the first critical
// match is enough — there is nothing to gain from enumerating all of them.
//
// fieldName is what the value was called by the route, and some patterns only
// make sense somewhere: a URL is spam in a display name and ordinary in a chat
// message. A pattern carrying onlyFields is skipped where it does not apply,
// and a value scanned with no field name gets every pattern.
function scanValue(value, fieldName) {
  if (value == null) return null;
  const s = String(value);
  if (!s) return null;

  const applies = (p) => !p.onlyFields || (fieldName != null && p.onlyFields.test(fieldName));

  for (const p of CRITICAL)   if (applies(p) && p.re.test(s)) return { signal: p.signal, severity: 'critical' };
  for (const p of SUSPICIOUS) if (applies(p) && p.re.test(s)) return { signal: p.signal, severity: 'suspicious' };
  return null;
}

// Scans a set of named fields, returning the worst hit with the field that
// carried it. Takes { displayName: '...', message: '...' }.
function scanFields(fields) {
  let worst = null;
  for (const [field, value] of Object.entries(fields || {})) {
    const hit = scanValue(value, field);
    if (!hit) continue;
    if (hit.severity === 'critical') return { ...hit, field, sample: sampleOf(value) };
    if (!worst) worst = { ...hit, field, sample: sampleOf(value) };
  }
  return worst;
}

function sampleOf(value) {
  const s = String(value ?? '').replace(/\u0000/g, '');
  return s.length > SAMPLE_MAX ? `${s.slice(0, SAMPLE_MAX)}…` : s;
}

// The address the request came from, behind Railway's proxy.
function ipOf(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

// ── Who must not be auto-blocked ────────────────────────────────────
//
// Evidence of a real payment rather than a type name, because the ledger's type
// names will keep growing and a hardcoded list of them would silently stop
// protecting somebody. A row carrying money is a row carrying money.
async function standing(userId) {
  if (!userId) return { exists: false, isArtist: false, protected: false, email: null, tier: null };
  const { rows } = await pool.query(
    `SELECT u.email, u.tier, u.is_artist,
            (u.tier IS DISTINCT FROM 'guest') AS not_guest,
            EXISTS (
              SELECT 1 FROM coin_ledger cl
               WHERE cl.user_id = u.id
                 AND (cl.payment_amount_inr > 0
                      OR cl.processor_tx_id IS NOT NULL
                      OR cl.payment_id IS NOT NULL)
            ) AS has_paid
       FROM users u
      WHERE u.id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return { exists: false, isArtist: false, protected: false, email: null, tier: null };
  return {
    exists: true,
    isArtist: !!u.is_artist,
    // Protected from the automatic block, not from the refused write.
    protected: !!u.is_artist || !!u.has_paid || !!u.not_guest,
    email: u.email,
    tier: u.tier,
  };
}

// ── The block ───────────────────────────────────────────────────────
//
// Two parts, and the second is the one that bites. Setting the flag stops the
// next request; deleting the sessions kills the token they are already holding,
// so they are cut off mid-scan rather than at their next sign in.
async function applyIntegrityBlock(userId, reason) {
  await pool.query(
    `UPDATE users
        SET integrity_blocked_at = NOW(),
            integrity_reason     = $2
      WHERE id = $1
        AND integrity_blocked_at IS NULL`,
    [userId, reason || null]
  );

  // Every session, not just the one that made this request.
  const { rowCount } = await pool.query(`DELETE FROM active_sessions WHERE user_id = $1`, [userId]);

  await logModerationAction(userId, 'integrity_blocked', reason, { sessionsEnded: rowCount });
  return { sessionsEnded: rowCount };
}

async function liftIntegrityBlock(userId, note) {
  await pool.query(
    `UPDATE users SET integrity_blocked_at = NULL, integrity_reason = NULL WHERE id = $1`,
    [userId]
  );
  await logModerationAction(userId, 'integrity_lifted', note || null, null);
}

// ── Recording ───────────────────────────────────────────────────────
//
// Never throws. A failure to write the security log must not take down the
// request that was being refused anyway — the refusal matters more than the
// record of it.
async function recordEvent(e) {
  try {
    await pool.query(
      `INSERT INTO security_events
         (user_id, email, signal, severity, action, method, path, ip, sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.userId || null, e.email || null, e.signal, e.severity, e.action,
       e.method || null, e.path || null, e.ip || null, e.sample || null]
    );
  } catch (err) {
    console.error('integrity/recordEvent error:', err.message);
  }
}

// ── Telling her ─────────────────────────────────────────────────────
//
// One push per account per ten minutes. A scanner sends hundreds of payloads,
// and a phone that buzzes hundreds of times is a phone that gets silenced,
// which is worse than no alerting at all. The events are all recorded; it is
// only the buzzing that is rationed.
const LAST_PUSH = new Map();
const PUSH_GAP_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - PUSH_GAP_MS;
  for (const [k, at] of LAST_PUSH) if (at < cutoff) LAST_PUSH.delete(k);
}, 15 * 60 * 1000).unref?.();

async function alert({ key, blocked, signal, who, field, severity }) {
  // Critical always reaches her phone. Suspicious does not, unless she turns
  // it on — because 'suspicious' is the tier that can fire on real text ("a <
  // b and b > c" trips the loose tag pattern), and a phone that buzzes for
  // that gets silenced, taking the real alerts down with it. Nothing is lost:
  // every suspicious event is still in the Security panel. Flip
  // security_push_suspicious to 1 in config to have them pushed as well.
  if (severity !== 'critical') {
    const on = await getConfigValue('security_push_suspicious').catch(() => null);
    if (String(on) !== '1') return;
  }

  const last = LAST_PUSH.get(key);
  if (last && Date.now() - last < PUSH_GAP_MS) return;
  LAST_PUSH.set(key, Date.now());

  try {
    await notifyArtist({
      title: blocked ? 'Account blocked — security' : 'Security: attempt refused',
      body: blocked
        ? `${who} was blocked immediately. Sent ${signal.replace(/_/g, ' ')} in ${field}.`
        : `${who} sent ${signal.replace(/_/g, ' ')} in ${field}. Refused, account left open.`,
      url: '/security',
    });
  } catch (err) {
    console.error('integrity/alert error:', err.message);
  }
}

// ── The stored reason, in words ─────────────────────────────────────
//
// This string outlives the detector: it sits on the user row and in
// moderation_log, and it is what Jinal reads months later when she wonders why
// an account is shut. "Automatic: event_handler in message" tells her nothing,
// so the reason is written as a sentence here, where the signal is known,
// rather than left for a screen to decode.
const PHRASES = {
  script_tag:         'a script tag',
  svg_tag:            'an SVG carrying code',
  iframe_tag:         'a hidden frame',
  object_tag:         'an embedded object',
  event_handler:      'code hidden in an image or tag',
  js_scheme:          'a link that runs code',
  img_tag_attr:       'code hidden in an image tag',
  session_theft:      'code that reads a login session',
  sql_tautology:      'a database check bypass',
  sql_union:          'a query for other database tables',
  sql_delay:          'a database weakness test',
  sql_comment_probe:  'a truncated database query',
  path_traversal:     'a path pointing outside the app',
  null_byte:          'a byte meant to break a parser',
  crlf_injection:     'a forged response header',
  encoded_payload:    'a disguised script',
  template_injection: 'code wrapped in a template',
  jndi_probe:         'a known remote-code probe',
  node_gadget:        'a reference to the server internals',
  html_tag:           'raw HTML',
  template_braces:    'template braces',
  url_in_name:        'a link where a name belongs',
};

const WHERE = {
  displayName: 'their display name',
  message:     'a chat message',
  post:        'a Public Corner post',
  topic:       'a request topic',
  details:     'a request description',
};

function reasonText(hit) {
  const what  = PHRASES[hit.signal] || String(hit.signal).replace(/_/g, ' ');
  const where = WHERE[hit.field] || hit.field;
  return `Sent ${what} in ${where}. Blocked automatically.`;
}

// ── The one call routes make ────────────────────────────────────────
//
// Returns null when the input is clean, or a { status, body } to send back.
// Routes stay two lines longer and know nothing about any of the above:
//
//   const bad = await integrity.screen(req, { displayName });
//   if (bad) return res.status(bad.status).json(bad.body);
//
// Works before sign in too, with no userId, which is how a payload display
// name is refused at signup — so the account never exists in that shape.
async function screen(req, fields) {
  const hit = scanFields(fields);
  if (!hit) return null;

  const userId = req.user?.userId || null;
  const who = await standing(userId);

  // Jinal is not scanned at all.
  if (who.isArtist) return null;

  const email = who.email || (req.body?.email || '').toLowerCase().trim() || null;
  const label = email || (userId ? `member ${userId.slice(0, 8)}` : 'a visitor');

  // Critical, on an account that exists and is not protected, is blocked here
  // and now. Everything else is refused and reported.
  const willBlock = hit.severity === 'critical' && who.exists && !who.protected;

  if (willBlock) {
    try {
      await applyIntegrityBlock(userId, reasonText(hit));
    } catch (err) {
      console.error('integrity/applyIntegrityBlock error:', err.message);
    }
  }

  await recordEvent({
    userId, email,
    signal: hit.signal,
    severity: hit.severity,
    action: willBlock ? 'blocked' : (hit.severity === 'critical' ? 'alerted' : 'logged'),
    method: req.method,
    path: req.originalUrl || req.path,
    ip: ipOf(req),
    sample: hit.sample,
  });

  await alert({
    key: userId || email || ipOf(req) || 'unknown',
    blocked: willBlock,
    signal: hit.signal,
    who: label,
    field: hit.field,
    severity: hit.severity,
  });

  // What the sender is told. Deliberately flat and uninformative: naming the
  // pattern that caught them is free tuning advice for the next attempt.
  if (willBlock) {
    return {
      status: 403,
      body: { error: 'ACCOUNT_RESTRICTED',
              message: 'This account has been restricted. Contact support if you believe this is a mistake.' },
    };
  }

  return {
    status: 400,
    body: { error: 'INVALID_INPUT',
            message: 'That contains characters we cannot accept. Please use plain text.' },
  };
}

module.exports = {
  screen,
  scanValue,
  scanFields,
  standing,
  applyIntegrityBlock,
  liftIntegrityBlock,
  recordEvent,
  ipOf,
  // Exported for the false-positive test, which needs the patterns themselves.
  CRITICAL,
  SUSPICIOUS,
};
