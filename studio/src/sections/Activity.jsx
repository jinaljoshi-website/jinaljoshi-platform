// studio/src/sections/Activity.jsx
// What members have been doing, in one stream.
//
// Unlocks, messages, calls, memberships, top-ups and requests each had their
// own screen. Knowing what had happened meant visiting five of them and
// remembering how each looked last time — which turns opening Studio into a
// task you prepare for rather than something you glance at.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, colors } from '../ui';

const sans    = "'DM Sans', system-ui, sans-serif";
const mono    = "'DM Mono', 'Courier New', monospace";

// Each kind gets a word rather than a code, and a colour that groups them:
// money in is green, her time is accent, everything else is quiet.
const KINDS = {
  unlock:     { label: 'Opened a set',      colour: colors.muted },
  message:    { label: 'Sent a message',    colour: colors.accent },
  call:       { label: 'Asked for a call',  colour: colors.accent },
  membership: { label: 'Membership',        colour: '#8FC88F' },
  recharge:   { label: 'Bought tokens',     colour: '#8FC88F' },
  request:    { label: 'Custom request',    colour: colors.accent },
};

const FILTERS = [
  { key: 'all',        label: 'Everything' },
  { key: 'needsReply', label: 'Needs you'  },
  { key: 'money',      label: 'Money'      },
];

function when(ts) {
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function Activity() {
  const [rows,   setRows]   = useState(null);
  const [filter, setFilter] = useState('all');
  const [error,  setError]  = useState('');

  useEffect(() => {
    api.get('/api/studio/analytics/member-activity')
      .then((d) => setRows(d.rows || []))
      .catch((e) => setError(e.message));
  }, []);

  const shown = (rows || []).filter((r) => {
    if (filter === 'needsReply') return r.kind === 'message' || r.kind === 'call' || r.kind === 'request';
    if (filter === 'money')      return r.kind === 'recharge' || r.kind === 'membership';
    return true;
  });

  return (
    <div>
      <Eyebrow>Everything at once</Eyebrow>
      <T.title>Member Activity</T.title>

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 20px', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{
              fontFamily: sans, fontSize: 13, padding: '7px 16px', borderRadius: 999, cursor: 'pointer',
              background: filter === f.key ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     filter === f.key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
              color:      filter === f.key ? colors.accent : colors.muted,
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {!rows ? <T.muted>Loading…</T.muted>
       : shown.length === 0 ? <T.muted>Nothing here yet.</T.muted>
       : (
        <div style={{ display: 'grid', gap: 6 }}>
          {shown.map((r, i) => {
            const k = KINDS[r.kind] || { label: r.kind, colour: colors.muted };
            return (
              <div key={i} style={row}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                    <span style={{ color: k.colour }}>{k.label}</span>
                    {' · '}{r.who}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                    {when(r.at)} · {r.tier}
                    {r.detail && ` · ${r.detail}`}
                    {r.extra && r.kind === 'call' && ` · ${r.extra}`}
                  </div>
                </div>
                {r.tokens > 0 && (
                  <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, flexShrink: 0 }}>
                    {r.tokens} tokens
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '11px 14px' };