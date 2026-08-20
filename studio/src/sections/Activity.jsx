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

export function Activity({ openWith }) {
  const [rows,   setRows]   = useState(null);
  const [filter, setFilter] = useState('all');
  const [error,  setError]  = useState('');
  // A notification about one member opens showing that member. Rows carry the
  // name rather than an id, which is also what somebody would scan for.
  const [who,    setWho]    = useState(openWith?.who || '');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/api/studio/analytics/member-activity')
      .then((d) => setRows(d.rows || []))
      .catch((e) => setError(e.message));
  }, []);

  const shown = (rows || []).filter((r) => {
    if (who && String(r.who || '').toLowerCase() !== who.toLowerCase()) return false;
    if (filter === 'needsReply') return r.kind === 'message' || r.kind === 'call' || r.kind === 'request';
    // Money in, and only that.
    //
    // Membership was counted here too, but a membership is bought with tokens
    // that were paid for earlier — it is the same rupee arriving twice in a
    // list meant to show rupees arriving. A recharge is money; everything
    // after it is that money moving.
    if (filter === 'money')      return r.kind === 'recharge';
    return true;
  });

  // Consecutive activity by one member, gathered into a single entry.
  //
  // Somebody opening nine sets in four minutes produced nine rows, and pushed
  // everybody else off the screen. A run is broken by anybody else acting, so
  // the order of events is never rearranged — only the repetition of one name
  // is folded away.
  const runs = [];
  for (const r of shown) {
    const last = runs[runs.length - 1];
    if (last && last.who === r.who) last.items.push(r);
    else runs.push({ who: r.who, tier: r.tier, items: [r] });
  }

  return (
    <div>
      <Eyebrow>Everything at once</Eyebrow>
      <T.title>Member Activity</T.title>

      {error && <div style={S.error}>{error}</div>}

      {who && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 0' }}>
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
            Showing {who}
          </span>
          <button onClick={() => setWho('')}
                  style={{ fontFamily: sans, fontSize: 11, padding: '4px 10px', borderRadius: 999,
                           background: 'transparent', border: `1px solid ${colors.border}`,
                           color: colors.muted, cursor: 'pointer' }}>
            Show everyone
          </button>
        </div>
      )}

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
          {runs.map((run, ri) => {
            const first = run.items[0];
            const k = KINDS[first.kind] || { label: first.kind, colour: colors.muted };
            const tokens = run.items.reduce((a, x) => a + (x.tokens || 0), 0);

            // One thing happened: show it plainly, as before.
            if (run.items.length === 1) {
              return (
                <div key={ri} style={row}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                      <span style={{ color: k.colour }}>{k.label}</span>{' · '}{run.who}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                      {when(first.at)} · {first.tier}
                      {first.detail && ` · ${first.detail}`}
                      {first.extra && first.kind === 'call' && ` · ${first.extra}`}
                    </div>
                  </div>
                  {first.tokens > 0 && (
                    <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, flexShrink: 0 }}>
                      {first.tokens} tokens
                    </span>
                  )}
                </div>
              );
            }

            // A run: one line, opened if you want the detail.
            const open = expanded === ri;
            const kinds = [...new Set(run.items.map((x) => (KINDS[x.kind] || {}).label || x.kind))];
            return (
              <div key={ri} style={row}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <button onClick={() => setExpanded(open ? null : ri)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                      <span style={{ color: colors.accent }}>{run.items.length} things</span>
                      {' · '}{run.who}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                      {when(run.items[run.items.length - 1].at)} – {when(first.at)} · {run.tier}
                      {' · '}{kinds.join(', ')}
                      {' · '}{open ? 'hide' : 'show each'}
                    </div>
                  </button>

                  {open && (
                    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: `1px solid ${colors.border}`, display: 'grid', gap: 8 }}>
                      {run.items.map((r, i) => {
                        const rk = KINDS[r.kind] || { label: r.kind, colour: colors.muted };
                        return (
                          <div key={i}>
                            <div style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
                              <span style={{ color: rk.colour }}>{rk.label}</span>
                              {r.tokens > 0 && <span style={{ color: colors.muted }}>{` · ${r.tokens} tokens`}</span>}
                            </div>
                            <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                              {when(r.at)}{r.detail && ` · ${r.detail}`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {tokens > 0 && (
                  <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, flexShrink: 0 }}>
                    {tokens} tokens
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