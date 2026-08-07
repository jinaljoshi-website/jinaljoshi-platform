// studio/src/sections/Dashboard.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const notifRow  = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '11px 14px' };
const adminDoor = { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 18px', marginTop: 28 };
const dndRow = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 };

// One key per surface, because they are genuinely separate decisions — pausing
// instant calls during a shoot should not silence messages for the rest of the day.
const NOTIF_DESTINATIONS = {
  new_dm:            { section: 'messages', label: 'A new message',        verb: 'Reply'  },
  locked_media_sent: { section: 'messages', label: 'Locked media opened',  verb: 'See'    },
  call_confirmed:    { section: 'calls',    label: 'A call was confirmed', verb: 'Open'   },
  call_rejected:     { section: 'calls',    label: 'A call was declined',  verb: 'Open'   },
  custom_request:    { section: 'requests', label: 'A custom request',     verb: 'Review' },
  request_rejected:  { section: 'requests', label: 'A request was declined', verb: 'Open' },
  merch_order:       { section: 'merch',    label: 'An order came in',     verb: 'Open'   },
  token_grant:       { section: 'members',  label: 'Tokens were gifted',   verb: 'Open'   },
};

const DND_KEYS = { calls: 'artist_dnd_enabled', chat: 'dnd_chat_enabled' };

function DndToggle({ label, on, busy, onText, offText, onToggle }) {
  return (
    <div style={{
      flex: 1, minWidth: 260, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      background: on ? 'rgba(217,164,92,0.08)' : colors.surface,
      border: `1px solid ${on ? 'rgba(217,164,92,0.3)' : colors.border}`,
      borderRadius: 10, padding: '14px 18px',
    }}>
      <div>
        <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, fontWeight: 600, marginBottom: 2 }}>
          {label}{on ? ' · paused' : ''}
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, lineHeight: 1.5 }}>
          {on ? onText : offText}
        </div>
      </div>
      <button onClick={onToggle} disabled={busy} aria-label={`Do not disturb for ${label}`}
        style={{
          width: 50, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
          position: 'relative', flexShrink: 0,
          background: on ? '#D9A45C' : 'rgba(255,255,255,0.12)',
          opacity: busy ? 0.6 : 1, transition: 'background 180ms ease',
        }}>
        <div style={{
          position: 'absolute', top: 3, left: on ? 25 : 3, width: 22, height: 22, borderRadius: '50%',
          background: '#fff', transition: 'left 180ms ease',
        }} />
      </button>
    </div>
  );
}

export function Dashboard({ onNavigate }) {
  // Carries a filter with it, so a card saying three calls need answering opens
  // those three rather than the whole list to be searched through.
  const go = (section, state) => onNavigate?.(section, state);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [dnd,     setDnd]     = useState({ calls: false, chat: false });
  const [dndBusy, setDndBusy] = useState(null);

  useEffect(() => {
    api.get('/api/studio/config').then((d2) => setDnd({
      calls: d2.config?.artist_dnd_enabled === 'true',
      chat:  d2.config?.dnd_chat_enabled  === 'true',
    })).catch(() => {});
  }, []);

  const toggleDnd = async (which) => {
    const next = !dnd[which];
    setDndBusy(which);
    // Applied locally first so the switch responds immediately, and put back if
    // the save fails — a toggle that lags feels broken even when it works.
    setDnd((prev) => ({ ...prev, [which]: next }));
    try {
      await api.post('/api/studio/config', { changes: { [DND_KEYS[which]]: next ? 'true' : 'false' } });
    } catch {
      setDnd((prev) => ({ ...prev, [which]: !next }));
    } finally { setDndBusy(null); }
  };
  const [error,   setError]   = useState('');
  const [busyId,  setBusyId]  = useState(null);

  // Inline reply state (DMs)
  const [replyDrafts, setReplyDrafts] = useState({});

  // Inline call response state
  const [callAction,  setCallAction]  = useState({}); // id -> 'reject' | 'counter' | null
  const [callReason,   setCallReason]   = useState('');
  const [callCounterTime, setCallCounterTime] = useState('');

  // Inline request response state
  const [reqAction, setReqAction] = useState({});
  const [reqReason, setReqReason] = useState('');
  const [reqCounterPrice, setReqCounterPrice] = useState('');
  const [reqCounterNote,  setReqCounterNote]  = useState('');

  const load = () => api.get('/api/studio/dashboard')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  if (loading) return <T.muted>Loading dashboard…</T.muted>;

  const { notifications, pendingCalls, pendingRequests, recentMembers, unreadDMs, lowStockMerch, pendingReports } = data;

  // ── DMs ──────────────────────────────────────────────────────────────────
  const sendQuickReply = async (dm) => {
    const content = (replyDrafts[dm.fan_id || dm.sender_id] || '').trim();
    if (!content) return;
    const fanId = dm.sender_id;
    setBusyId(dm.id);
    setError('');
    try {
      await api.post(`/api/studio/dms/${fanId}/reply`, { content });
      await api.get(`/api/studio/dms/${fanId}`); // marks their messages read as a side effect
      setReplyDrafts((prev) => ({ ...prev, [fanId]: '' }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ── Calls ────────────────────────────────────────────────────────────────
  const respondToCall = async (id, action, extra) => {
    setBusyId(id); setError('');
    try {
      await api.post(`/api/stream-calls/${id}/artist-respond`, { action, ...extra });
      setCallAction((prev) => ({ ...prev, [id]: null }));
      setCallReason(''); setCallCounterTime('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ── Requests ─────────────────────────────────────────────────────────────
  const updateRequest = async (id, status, reasonText) => {
    setBusyId(id); setError('');
    try {
      await api.patch(`/api/studio/requests/${id}`, { status, reason: reasonText });
      setReqAction((prev) => ({ ...prev, [id]: null }));
      setReqReason('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const counterRequest = async (id) => {
    const price = parseInt(reqCounterPrice);
    if (!price) return;
    setBusyId(id); setError('');
    try {
      await api.post(`/api/studio/requests/${id}/counter`, { counterPrice: price, note: reqCounterNote.trim() || undefined });
      setReqAction((prev) => ({ ...prev, [id]: null }));
      setReqCounterPrice(''); setReqCounterNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ── Reports ──────────────────────────────────────────────────────────────
  const resolveReport = async (id, action) => {
    setBusyId(id); setError('');
    try {
      await api.post(`/api/studio/reports/${id}/resolve`, { action });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // ── Merch ────────────────────────────────────────────────────────────────
  const restock = async (item, amount) => {
    setBusyId(item.id); setError('');
    try {
      await api.patch(`/api/studio/merch/${item.id}`, { remaining: item.remaining + amount });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const totalActionable = (unreadDMs?.length || 0) + (pendingCalls?.length || 0) + (pendingRequests?.length || 0) + (pendingReports?.length || 0) + (lowStockMerch?.length || 0);

  return (
    <div>
      <Eyebrow>Overview</Eyebrow>
      <T.title>Dashboard</T.title>

      {/* Both interruptions in one place. Being unavailable is a decision made
          at a moment — walking into a shoot, sitting down to dinner — not
          something to go hunting through Settings for. */}
      <div style={dndRow}>
        <DndToggle
          label="Calls"
          on={dnd.calls}
          busy={dndBusy === 'calls'}
          onText="Instant calls paused — fans can still schedule ahead"
          offText="Fans can call you instantly with Priority Video"
          onToggle={() => toggleDnd('calls')}
        />
        <DndToggle
          label="Messages"
          on={dnd.chat}
          busy={dndBusy === 'chat'}
          onText="No notifications — messages still arrive, quietly"
          offText="You'll be notified when a fan messages"
          onToggle={() => toggleDnd('chat')}
        />
      </div>

      {error && <div style={S.error}>{error}</div>}

      <div style={S.statsRow}>
        <StatCard label="Unread messages"  value={unreadDMs?.length || 0}
                  onGo={() => go('messages')}  goLabel="Reply" />
        <StatCard label="Calls to answer"  value={pendingCalls?.length || 0}
                  onGo={() => go('calls', { filter: 'pending' })} goLabel="Respond" />
        <StatCard label="Requests waiting" value={pendingRequests?.length || 0}
                  onGo={() => go('requests', { filter: 'pending' })} goLabel="Review" />
        <StatCard label="Reported"         value={pendingReports?.length || 0}
                  onGo={() => go('community')} goLabel="Look" />
        <StatCard label="Low stock"        value={lowStockMerch?.length || 0}
                  onGo={() => go('merch', { filter: 'low' })} goLabel="Check" />
      </div>

      {totalActionable === 0 && recentMembers?.length === 0 && (
        <T.muted>All clear — no pending items.</T.muted>
      )}

      {/* ── Unread DMs — quick reply inline ── */}
      {unreadDMs?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Unread messages</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12 }}>
            {unreadDMs.map((dm) => (
              <div key={dm.id} style={rowCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={S.rowTitle}>{dm.display_name || dm.email}</div>
                    <div style={S.rowSub}>{dm.content?.slice(0, 100)}</div>
                  </div>
                  <Badge tier={dm.tier} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={replyDrafts[dm.sender_id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [dm.sender_id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendQuickReply(dm); }}
                    placeholder="Quick reply…"
                    style={{ flex: 1, boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid ${colors.border}`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '8px 12px', borderRadius: 8, outline: 'none' }}
                  />
                  <button onClick={() => sendQuickReply(dm)} disabled={busyId === dm.id || !replyDrafts[dm.sender_id]?.trim()} style={{ ...S.btn, fontSize: 12, padding: '8px 14px', opacity: (busyId === dm.id || !replyDrafts[dm.sender_id]?.trim()) ? 0.5 : 1 }}>
                    Send
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Pending calls — accept/counter/reject inline ── */}
      {pendingCalls?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Pending call requests</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12 }}>
            {pendingCalls.map((c) => (
              <div key={c.id} style={rowCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={S.rowSub}>{c.coins_charged} tokens · proposed {new Date(c.proposed_time).toLocaleString()}</div>
                  </div>
                  <Badge tier={c.tier} />
                </div>
                {callAction[c.id] === 'reject' ? (
                  <div>
                    <textarea value={callReason} onChange={(e) => setCallReason(e.target.value)} placeholder="Reason (tokens refunded)" style={textareaStyle} rows={2} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => respondToCall(c.id, 'reject', { reason: callReason })} disabled={!callReason.trim()} style={{ ...S.btn, background: '#9C5A5A', border: 'none', fontSize: 12, padding: '6px 12px', opacity: callReason.trim() ? 1 : 0.5 }}>Confirm decline</button>
                      <button onClick={() => setCallAction((p) => ({ ...p, [c.id]: null }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : callAction[c.id] === 'counter' ? (
                  <div>
                    <input type="datetime-local" value={callCounterTime} onChange={(e) => setCallCounterTime(e.target.value)} style={inputStyle} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => respondToCall(c.id, 'counter', { proposedTime: new Date(callCounterTime).toISOString() })} disabled={!callCounterTime} style={{ ...S.btn, fontSize: 12, padding: '6px 12px', opacity: callCounterTime ? 1 : 0.5 }}>Send</button>
                      <button onClick={() => setCallAction((p) => ({ ...p, [c.id]: null }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => respondToCall(c.id, 'accept')} disabled={busyId === c.id} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Accept</button>
                    <button onClick={() => setCallAction((p) => ({ ...p, [c.id]: 'counter' }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Suggest alternate time</button>
                    <button onClick={() => setCallAction((p) => ({ ...p, [c.id]: 'reject' }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Pending custom requests — accept/counter/reject inline ── */}
      {pendingRequests?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Pending custom requests</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12 }}>
            {pendingRequests.map((r) => (
              <div key={r.id} style={rowCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={S.rowTitle}>{r.display_name || r.email} — {r.topic || r.type}</div>
                    <div style={S.rowSub}>{r.coins_charged} tokens offered</div>
                  </div>
                  <Badge tier={r.tier} />
                </div>
                {reqAction[r.id] === 'reject' ? (
                  <div>
                    <textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="Reason (tokens refunded as credit)" style={textareaStyle} rows={2} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => updateRequest(r.id, 'rejected', reqReason)} disabled={!reqReason.trim()} style={{ ...S.btn, background: '#9C5A5A', border: 'none', fontSize: 12, padding: '6px 12px', opacity: reqReason.trim() ? 1 : 0.5 }}>Confirm decline</button>
                      <button onClick={() => setReqAction((p) => ({ ...p, [r.id]: null }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : reqAction[r.id] === 'counter' ? (
                  <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <input type="number" min={0} value={reqCounterPrice} onChange={(e) => setReqCounterPrice(e.target.value)} placeholder="Counter price" style={{ ...inputStyle, width: 140 }} />
                      <input value={reqCounterNote} onChange={(e) => setReqCounterNote(e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => counterRequest(r.id)} disabled={!reqCounterPrice} style={{ ...S.btn, background: '#D9A45C', border: 'none', color: '#1A1714', fontSize: 12, padding: '6px 12px', opacity: reqCounterPrice ? 1 : 0.5 }}>Send counter</button>
                      <button onClick={() => setReqAction((p) => ({ ...p, [r.id]: null }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => updateRequest(r.id, 'confirmed')} disabled={busyId === r.id} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Accept</button>
                    <button onClick={() => { setReqAction((p) => ({ ...p, [r.id]: 'counter' })); setReqCounterPrice(String(r.coins_charged)); }} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D9A45C', border: '1px solid rgba(217,164,92,0.3)' }}>Counter</button>
                    <button onClick={() => setReqAction((p) => ({ ...p, [r.id]: 'reject' }))} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Pending community reports ── */}
      {pendingReports?.length > 0 && (
        <Card style={{ marginBottom: 20, border: '1px solid rgba(156,90,90,0.3)' }}>
          <T.sectionTitle>Pending reports</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12 }}>
            {pendingReports.map((r) => (
              <div key={r.id} style={rowCard}>
                <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 6 }}>
                  Reported by {r.reporter_name || r.reporter_email} · post by {r.author_name || r.author_email}
                </div>
                <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, background: '#0D0C0A', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>{r.post_content}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => resolveReport(r.id, 'dismiss')} disabled={busyId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Dismiss</button>
                  <button onClick={() => resolveReport(r.id, 'remove')} disabled={busyId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A' }}>Remove</button>
                  <button onClick={() => resolveReport(r.id, 'remove_and_mute')} disabled={busyId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D9A45C' }}>Remove + Mute</button>
                  <button onClick={() => resolveReport(r.id, 'remove_and_block')} disabled={busyId === r.id} style={{ ...S.btn, background: '#9C5A5A', border: 'none', fontSize: 12, padding: '6px 12px' }}>Remove + Restrict</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Low stock merch ── */}
      {lowStockMerch?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Low stock merchandise</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {lowStockMerch.map((item) => (
              <div key={item.id} style={{ ...rowCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={S.rowTitle}>{item.title}</div>
                  <div style={{ ...S.rowSub, color: item.remaining === 0 ? '#D99A9A' : '#D9A45C' }}>{item.remaining} remaining</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => restock(item, 5)} disabled={busyId === item.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>+5</button>
                  <button onClick={() => restock(item, 10)} disabled={busyId === item.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>+10</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {recentMembers?.length > 0 && (
        <Card>
          <T.sectionTitle>Recent members</T.sectionTitle>
          {recentMembers.map((m) => (
            <div key={m.id} style={S.listRow}>
              <div>
                <div style={S.rowTitle}>{m.display_name || m.email}</div>
                <div style={S.rowSub}>Joined {new Date(m.created_at).toLocaleDateString()}</div>
              </div>
              <Badge tier={m.tier} />
            </div>
          ))}
        </Card>
      )}

      {notifications?.length > 0 && (
        <>
          <T.sectionTitle style={{ marginTop: 28 }}>Just happened</T.sectionTitle>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {notifications.slice(0, 8).map((n) => {
              const dest = NOTIF_DESTINATIONS[n.type];
              return (
                <div key={n.id}
                     onClick={dest ? () => go(dest.section) : undefined}
                     style={{ ...notifRow, cursor: dest ? 'pointer' : 'default' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                      {dest?.label || n.type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 2 }}>
                      {new Date(n.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {dest && (
                    <span style={{ fontFamily: sans, fontSize: 11, color: colors.accent, flexShrink: 0 }}>
                      {dest.verb} →
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Past everything that needs her, not before it. */}
      <div style={adminDoor}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>Admin &amp; settings</div>
          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 3 }}>
            Pricing, members, money, invoices and the website
          </div>
        </div>
        <button onClick={() => go('settings')} style={{ ...S.ghostBtn, fontSize: 12, padding: '8px 16px' }}>
          Open →
        </button>
      </div>
    </div>
  );
}

// A count that leads somewhere. These were figures with nothing behind them —
// she would read "3 pending calls" and then have to find the calls screen
// herself, which is the difference between being told and being helped.
//
// A card with nothing waiting is deliberately quiet and does not invite a tap;
// one with something to do carries the accent and a nudge.
function StatCard({ label, value, onGo, goLabel }) {
  const has = value > 0;
  const clickable = has && onGo;
  return (
    <div
      onClick={clickable ? onGo : undefined}
      role={clickable ? 'button' : undefined}
      style={{
        ...S.statCard,
        cursor: clickable ? 'pointer' : 'default',
        border: has ? `1px solid rgba(193,125,74,0.35)` : S.statCard.border,
        transition: 'border-color 150ms ease',
      }}
    >
      <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 36, color: has ? colors.accent : colors.muted }}>{value}</div>
      {clickable && (
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.accent, marginTop: 4 }}>
          {goLabel || 'Open'} →
        </div>
      )}
    </div>
  );
}

const rowCard = { background: '#161410', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14 };
const inputStyle = { width: '100%', boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid ${colors.border}`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '8px 12px', borderRadius: 8, outline: 'none' };
const textareaStyle = { ...inputStyle, resize: 'vertical', marginBottom: 8 };