// studio/src/sections/Security.jsx
//
// What the integrity detector saw, and the control to undo what it did.
//
// The block it applies is immediate and has no expiry, which is right for
// somebody probing the platform and unforgiving if it ever catches the wrong
// person. So the undo is not tucked away: the blocked accounts sit at the top
// of the screen with a Let back in button on each, and the log is underneath
// for when she wants to know what happened rather than act on it.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans    = "'DM Sans', system-ui, sans-serif";
const mono    = "'DM Mono', 'Courier New', monospace";
const display = "'Cormorant Garamond', Georgia, serif";

// 'event_handler' reads as jargon on a screen Jinal uses. These say what was
// actually attempted, in the words someone would use to describe it.
const SIGNAL_LABELS = {
  script_tag:          'tried to inject a script',
  svg_tag:             'tried to inject an SVG',
  iframe_tag:          'tried to embed a hidden frame',
  object_tag:          'tried to embed an object',
  event_handler:       'hid code in an image or tag',
  js_scheme:           'sent a link that runs code',
  img_tag_attr:        'hid code in an image tag',
  session_theft:       'tried to read a login session',
  sql_tautology:       'tried to bypass a database check',
  sql_union:           'tried to read other database tables',
  sql_delay:           'tested the database for a weakness',
  sql_comment_probe:   'tried to cut a database query short',
  path_traversal:      'tried to reach files on the server',
  null_byte:           'sent a byte meant to break a parser',
  crlf_injection:      'tried to forge part of a response',
  encoded_payload:     'sent a disguised script',
  template_injection:  'tried to run code through a template',
  jndi_probe:          'sent a known remote-code probe',
  node_gadget:         'tried to reach the server internals',
  html_tag:            'sent raw HTML',
  template_braces:     'sent template braces',
  url_in_name:         'put a link in their name',
};

const label = (signal) => SIGNAL_LABELS[signal] || String(signal || '').replace(/_/g, ' ');

const ACTION_LABELS = {
  blocked: 'Blocked, cut off immediately',
  alerted: 'Refused — account left open',
  logged:  'Noted only',
};

function when(at) {
  if (!at) return '';
  const d = new Date(at);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
       + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function Security() {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [busy,    setBusy]    = useState(null);
  const [days,    setDays]    = useState(30);
  const [showAll, setShowAll] = useState(false);

  const load = (d = days) => api.get(`/api/studio/security?days=${d}`)
    .then(setData).catch((e) => setError(e.message));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const lift = async (row) => {
    setBusy(row.userId); setError(''); setSuccess('');
    try {
      await api.post(`/api/studio/security/lift/${row.userId}`, {});
      setSuccess(`${row.displayName || row.email} can sign in again.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  if (!data && !error) return <T.muted>Loading…</T.muted>;

  const events   = data?.events || [];
  const blocked  = data?.blocked || [];
  const critical = events.filter((e) => e.severity === 'critical');
  const shown    = showAll ? events : events.filter((e) => e.severity === 'critical');

  return (
    <div>
      <T.title>Security</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <div style={S.statsRow}>
        <div style={S.statCard}>
          <Eyebrow>Blocked now</Eyebrow>
          <div style={{ fontFamily: display, fontSize: 32, color: blocked.length ? '#D99A9A' : colors.text }}>
            {blocked.length}
          </div>
        </div>
        <div style={S.statCard}>
          <Eyebrow>Attempts refused</Eyebrow>
          <div style={{ fontFamily: display, fontSize: 32, color: colors.text }}>{critical.length}</div>
          <div style={S.rowSub}>last {data?.days || days} days</div>
        </div>
        <div style={S.statCard}>
          <Eyebrow>Noted</Eyebrow>
          <div style={{ fontFamily: display, fontSize: 32, color: colors.muted }}>
            {events.length - critical.length}
          </div>
          <div style={S.rowSub}>nothing was done</div>
        </div>
      </div>

      {/* ── Blocked accounts ──────────────────────────────────────── */}
      <T.sectionTitle>Blocked accounts</T.sectionTitle>
      <Card style={{ marginBottom: 28 }}>
        {!blocked.length && (
          <T.muted>Nobody is blocked. An account blocked here stays blocked until you lift it.</T.muted>
        )}
        {blocked.map((b) => (
          <div key={b.userId} style={{ ...S.listRow, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={S.rowTitle}>{b.displayName || b.email}</div>
              <div style={S.rowSub}>
                {b.email}{b.tier ? ` · ${b.tier}` : ''} · blocked {when(b.at)}
                {b.eventCount > 1 ? ` · ${b.eventCount} attempts` : ''}
              </div>
              {b.reason && (
                <div style={{ ...S.rowSub, fontFamily: mono, marginTop: 4, color: colors.muted }}>
                  {b.reason}
                </div>
              )}
            </div>
            <button
              onClick={() => lift(b)}
              disabled={busy === b.userId}
              style={{ ...S.ghostBtn, whiteSpace: 'nowrap', opacity: busy === b.userId ? 0.5 : 1 }}>
              {busy === b.userId ? 'Lifting…' : 'Let back in'}
            </button>
          </div>
        ))}
      </Card>

      {/* ── The log ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <T.sectionTitle>What was caught</T.sectionTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="How far back to look"
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 3 months</option>
            <option value={365}>Last year</option>
          </select>
          <button
            onClick={() => setShowAll(!showAll)}
            aria-pressed={showAll}
            style={{ ...S.ghostBtn, padding: '6px 12px',
                     ...(showAll ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
            {showAll ? 'Serious only' : 'Show everything'}
          </button>
        </div>
      </div>

      <Card>
        {!shown.length && (
          <T.muted>
            {events.length
              ? 'Nothing serious in this period. Show everything to see what was noted and ignored.'
              : 'Nothing caught in this period.'}
          </T.muted>
        )}
        {shown.map((e) => (
          <div key={e.id} style={{ ...S.listRow, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={S.rowTitle}>
                {e.who} {label(e.signal)}
                {e.severity !== 'critical' && (
                  <span style={{ color: colors.muted, fontSize: 12 }}> · minor</span>
                )}
              </div>
              <div style={S.rowSub}>
                {when(e.at)} · {ACTION_LABELS[e.action] || e.action}
                {e.path ? ` · ${e.method} ${e.path}` : ''}
              </div>
              {/* What they actually sent. Kept as plain text in a monospace
                  block: React escapes it, so it cannot do anything here, and
                  seeing it is the point. */}
              {e.sample && (
                <div style={{ fontFamily: mono, fontSize: 11, color: colors.muted, marginTop: 5,
                              background: '#0D0C0A', border: `1px solid ${colors.border}`,
                              borderRadius: 6, padding: '6px 8px',
                              wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                  {e.sample}
                </div>
              )}
            </div>
            {e.stillBlocked && (
              <span style={{ fontFamily: sans, fontSize: 11, color: '#D99A9A', whiteSpace: 'nowrap' }}>
                blocked
              </span>
            )}
          </div>
        ))}
      </Card>

      <div style={{ ...S.rowSub, marginTop: 18, lineHeight: 1.6 }}>
        Serious attempts always reach your phone. Minor ones are recorded here and stay quiet,
        because the minor tier can fire on ordinary text — a member writing “a &lt; b” trips it —
        and a phone that buzzes for that gets silenced. To be pushed those as well, set
        <span style={{ fontFamily: mono }}> security_push_suspicious </span> to 1 in Settings.
      </div>
    </div>
  );
}
