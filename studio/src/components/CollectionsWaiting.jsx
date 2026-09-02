// studio/src/components/CollectionsWaiting.jsx
//
// Who has earned their way in, and whether they get in.
//
// Spending past the threshold used to open the collection by itself. It now
// records that somebody has qualified and waits here. The days they earned
// start counting from the moment she says yes, not from the payment, so
// nothing is lost to how long this sits unread.
//
// Deliberately not a queue that nags. There is no badge and no red dot: this is
// a decision about who is let into the most private thing on the platform, and
// it should be made when she has a view, not when a number is bothering her.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

export default function CollectionsWaiting() {
  const [waiting, setWaiting] = useState(null);
  const [busy,    setBusy]    = useState(null);
  const [error,   setError]   = useState('');
  const [asking,  setAsking]  = useState(null);   // id being declined

  const load = () => api.get('/api/studio/collections/waiting')
    .then((d) => setWaiting(d.waiting || []))
    .catch(() => setWaiting([]));

  useEffect(() => { load(); }, []);

  const approve = async (m) => {
    setBusy(m.id); setError('');
    try {
      await api.post(`/api/studio/collections/${m.id}/approve`, {});
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  const decline = async (m) => {
    setBusy(m.id); setError('');
    try {
      await api.post(`/api/studio/collections/${m.id}/decline`, {});
      setAsking(null);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  // Nothing waiting is the ordinary state and does not need a panel saying so.
  if (!waiting || waiting.length === 0) return null;

  return (
    <Card style={{ marginBottom: 20, borderColor: colors.accent }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: colors.accent, marginBottom: 6 }}>
        Waiting on you
      </div>
      <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 1.6 }}>
        {waiting.length === 1 ? 'Somebody has' : `${waiting.length} people have`} spent
        enough to earn the collection. Nothing opens until you say so, and the
        days they earned start counting from then.
      </div>

      {error && (
        <div style={{ fontFamily: sans, fontSize: 12, color: '#D99A9A', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {waiting.map((m) => (
          <div key={m.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: sans, fontSize: 15, color: colors.text }}>
                  {m.who}
                  {m.alreadyIn && (
                    <span style={{ fontFamily: mono, fontSize: 10, color: colors.success, marginLeft: 10 }}>
                      already in
                    </span>
                  )}
                </div>

                {/* Enough to decide on without opening another screen. Who they
                    are, what they have spent, and how long they have been here
                    — the three things that make this a judgement rather than a
                    rubber stamp. */}
                <div style={{ fontFamily: mono, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.7 }}>
                  {m.tier} · ₹{Number(m.paidInr || 0).toLocaleString('en-IN')} spent
                  {m.messages > 0 && ` · ${m.messages.toLocaleString('en-IN')} messages`}
                  <br />
                  member since {new Date(m.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  {m.eligibleSince && ` · qualified ${timeAgo(m.eligibleSince)}`}
                </div>

                <div style={{ fontFamily: sans, fontSize: 13, color: colors.accent, marginTop: 8 }}>
                  {m.daysOwed} days waiting
                  {m.alreadyIn && m.holdsUntil && (
                    <span style={{ color: colors.muted }}>
                      {' '}· would extend past {new Date(m.holdsUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {asking === m.id ? (
                  <>
                    <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, alignSelf: 'center', maxWidth: 190 }}>
                      They are not told either way. Sure?
                    </span>
                    <button onClick={() => decline(m)} disabled={busy === m.id}
                            style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px',
                                     color: '#D99A9A', borderColor: 'rgba(156,90,90,0.4)' }}>
                      {busy === m.id ? '…' : 'Not this time'}
                    </button>
                    <button onClick={() => setAsking(null)} disabled={busy === m.id}
                            style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
                      Back
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => approve(m)} disabled={busy === m.id}
                            style={{ ...S.btn, fontSize: 13, padding: '8px 18px' }}>
                      {busy === m.id ? '…' : m.alreadyIn ? 'Extend' : 'Let them in'}
                    </button>
                    <button onClick={() => setAsking(m.id)} disabled={busy === m.id}
                            style={{ ...S.ghostBtn, fontSize: 13, padding: '8px 14px' }}>
                      Not yet
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// How long somebody has been waiting, in words. A date tells you when; this
// tells you whether it has been sitting.
function timeAgo(when) {
  const days = Math.floor((Date.now() - new Date(when).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}