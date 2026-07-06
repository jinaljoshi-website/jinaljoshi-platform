// studio/src/sections/Calls.jsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, Badge, colors } from '../ui';
import { CallTimer } from '../components/CallTimer';

// Stream Video
import {
  StreamVideo,
  StreamVideoClient,
  StreamCall,
  CallControls,
  SpeakerLayout,
  StreamTheme,
} from '@stream-io/video-react-sdk';
import '@stream-io/video-react-sdk/dist/css/styles.css';

export function Calls() {
  const [calls,      setCalls]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [activeCallRecord, setActiveCallRecord] = useState(null);
  const [joining,    setJoining]    = useState(null);
  const [error,      setError]      = useState('');
  const [rejecting,  setRejecting]  = useState(null);
  const [reason,     setReason]     = useState('');
  const [counterFor, setCounterFor] = useState(null);
  const [counterTime, setCounterTime] = useState('');

  const pollRef = useRef(null);

  const load = () => api.get('/api/studio/calls')
    .then((d) => setCalls(d.calls || []))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // Poll for live updates — catches a fan proposing a new time or accepting, without manual refresh
  useEffect(() => {
    const listPollInterval = setInterval(() => {
      if (!activeCall) load();
    }, 5000);
    return () => clearInterval(listPollInterval);
  }, [activeCall]);

  const startReject  = (id) => { setRejecting(id); setReason(''); };
  const cancelReject = () => { setRejecting(null); setReason(''); };

  const respondToCall = async (id, action, extra) => {
    setError('');
    try {
      const data = await api.post(`/api/stream-calls/${id}/artist-respond`, { action, ...extra });
      setRejecting(null); setReason('');
      setCounterFor(null); setCounterTime('');
      load();
    } catch (err) { setError(err.message); }
  };

  const createCallRoom = async (callRequestId) => {
    setCreating(callRequestId); setError('');
    try {
      const data = await api.post('/api/stream-calls/create', { callRequestId });
      const updated = await api.get('/api/studio/calls');
      setCalls(updated.calls || []);
      joinCall(data.callId, callRequestId);
    } catch (err) {
      setError(err.message);
      setCreating(null);
    }
  };

  const startPolling = useCallback((callRequestId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { call } = await api.get(`/api/stream-calls/${callRequestId}`);
        setActiveCallRecord(call);
        if (call.status === 'completed') clearInterval(pollRef.current);
      } catch {}
    }, 3000);
  }, []);

  const joinCall = useCallback(async (streamCallId, callRequestId) => {
    setJoining(streamCallId); setError('');
    try {
      const tokenData = await api.post('/api/stream-calls/token', {});
      const client = new StreamVideoClient({
        apiKey: tokenData.apiKey,
        user:   { id: tokenData.userId, name: tokenData.userName },
        token:  tokenData.token,
      });
      const call = client.call('default', streamCallId);
      await call.join({ create: false });
      setActiveCall({ client, call, callId: streamCallId });
      if (callRequestId) {
        await api.post(`/api/stream-calls/${callRequestId}/joined`, {});
        startPolling(callRequestId);
      }
    } catch (err) {
      setError('Could not join the call: ' + err.message);
    } finally {
      setJoining(null);
      setCreating(null);
    }
  }, [startPolling]);

  const leaveCall = useCallback(async () => {
    if (!activeCall) return;
    try {
      await activeCall.call.leave();
      await activeCall.client.disconnectUser();
    } catch (e) { console.error(e); }
    if (pollRef.current) clearInterval(pollRef.current);
    setActiveCall(null);
    setActiveCallRecord(null);
    api.get('/api/studio/calls').then((d) => setCalls(d.calls || [])).catch(() => {});
  }, [activeCall]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (loading) return <T.muted>Loading calls…</T.muted>;

  // ── Active call UI ──
  if (activeCall) {
    const durationMinutes = activeCallRecord ? Math.round(activeCallRecord.coins_charged / activeCallRecord.coins_per_min) : null;
    return (
      <StreamVideo client={activeCall.client}>
        <StreamCall call={activeCall.call}>
          <StreamTheme>
            <div style={{ height: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
              <div style={{ padding: 10, display: 'flex', justifyContent: 'center' }}>
                <CallTimer
                  callStartedAt={activeCallRecord?.call_started_at}
                  durationMinutes={durationMinutes}
                  onExpire={leaveCall}
                />
              </div>
              <SpeakerLayout />
              <div style={{ padding: 16, background: colors.surface, display: 'flex', justifyContent: 'center', gap: 12 }}>
                <CallControls />
                <button onClick={leaveCall} style={{ background: '#9C5A5A', border: 'none', color: '#fff', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 8, cursor: 'pointer' }}>
                  End & leave
                </button>
              </div>
            </div>
          </StreamTheme>
        </StreamCall>
      </StreamVideo>
    );
  }

  const needsResponse = calls.filter((c) => c.status === 'pending' && c.proposed_by === 'fan');
  const waitingOnFan  = calls.filter((c) => c.status === 'pending' && c.proposed_by === 'jinal');
  const scheduled     = calls.filter((c) => c.status === 'scheduled');
  const confirmed     = calls.filter((c) => c.status === 'confirmed');
  const others        = calls.filter((c) => ['completed', 'rejected'].includes(c.status));

  const sans = "'DM Sans', system-ui, sans-serif";

  return (
    <div>
      <Eyebrow>Call requests</Eyebrow>
      <T.title>Calls</T.title>

      {error && <div style={S.error}>{error}</div>}
      {calls.length === 0 && <T.muted>No call requests yet.</T.muted>}

      {/* Needs Jinal's response */}
      {needsResponse.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Needs your response ({needsResponse.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {needsResponse.map((c) => (
              <div key={c.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={S.rowTitle}>
                      {c.display_name || c.email} — {c.call_type}
                      {c.call_type === 'priority-video' && <span style={{ marginLeft: 8, fontSize: 11, color: '#D99A9A' }}>🔴 PRIORITY</span>}
                    </div>
                    <div style={{ ...S.rowSub, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      {c.coins_charged} tokens · <Badge tier={c.tier} />
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 13, color: colors.accent, marginTop: 6 }}>
                      Proposed: {new Date(c.proposed_time).toLocaleString()}
                    </div>
                  </div>
                </div>

                {rejecting === c.id ? (
                  <div>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for declining (shown to the fan, and their tokens will be refunded)"
                      style={{ width: '100%', boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid rgba(156,90,90,0.3)`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '10px 12px', borderRadius: 8, outline: 'none', resize: 'vertical', marginBottom: 10 }}
                      rows={2}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => respondToCall(c.id, 'reject', { reason })} disabled={!reason.trim()} style={{ ...S.btn, background: '#9C5A5A', border: 'none', fontSize: 12, padding: '6px 12px', opacity: reason.trim() ? 1 : 0.5 }}>
                        Confirm decline &amp; refund
                      </button>
                      <button onClick={cancelReject} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : counterFor === c.id ? (
                  <div>
                    <input
                      type="datetime-local"
                      value={counterTime}
                      onChange={(e) => setCounterTime(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid ${colors.border}`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '10px 12px', borderRadius: 8, outline: 'none', marginBottom: 10 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => respondToCall(c.id, 'counter', { proposedTime: new Date(counterTime).toISOString() })}
                        disabled={!counterTime}
                        style={{ ...S.btn, fontSize: 12, padding: '6px 12px', opacity: counterTime ? 1 : 0.5 }}
                      >
                        Send alternate time
                      </button>
                      <button onClick={() => { setCounterFor(null); setCounterTime(''); }} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => respondToCall(c.id, 'accept')} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Accept this time</button>
                    {c.negotiation_round < 4 && (
                      <button onClick={() => setCounterFor(c.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Suggest alternate time</button>
                    )}
                    <button onClick={() => startReject(c.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting on fan's decision */}
      {waitingOnFan.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Waiting on fan ({waitingOnFan.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {waitingOnFan.map((c) => (
              <div key={c.id} style={S.card}>
                <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 4 }}>
                  You proposed {new Date(c.proposed_time).toLocaleString()} · awaiting their response
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled — start when the time comes */}
      {scheduled.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Scheduled ({scheduled.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {scheduled.map((c) => (
              <div key={c.id} style={{ ...S.card, border: `1px solid rgba(193,125,74,0.3)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: colors.accent, marginTop: 4 }}>
                      {new Date(c.scheduled_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => createCallRoom(c.id)}
                    disabled={creating === c.id}
                    style={{ background: colors.accent, border: 'none', color: '#1A1714', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', opacity: creating === c.id ? 0.6 : 1 }}
                  >
                    {creating === c.id ? 'Starting…' : '▶ Start call'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmed — rejoin */}
      {confirmed.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Room ready ({confirmed.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {confirmed.map((c) => (
              <div key={c.id} style={{ ...S.card, border: `1px solid rgba(193,125,74,0.3)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: colors.accent, marginTop: 4 }}>Room ready · fan notified</div>
                  </div>
                  {c.stream_call_id && (
                    <button
                      onClick={() => joinCall(c.stream_call_id, c.id)}
                      disabled={joining === c.stream_call_id}
                      style={{ background: colors.accent, border: 'none', color: '#1A1714', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', opacity: joining === c.stream_call_id ? 0.6 : 1 }}
                    >
                      {joining === c.stream_call_id ? 'Joining…' : '▶ Rejoin'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {others.length > 0 && (
        <div>
          <T.sectionTitle>History</T.sectionTitle>
          <div style={{ display: 'grid', gap: 8 }}>
            {others.map((c) => (
              <div key={c.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={{ ...S.rowSub, display: 'flex', gap: 8, marginTop: 4 }}>
                      {c.coins_charged} tokens · {new Date(c.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontFamily: sans, fontSize: 12, color: c.status === 'completed' ? colors.success : '#D99A9A', textTransform: 'capitalize' }}>
                    {c.status}
                  </span>
                </div>
                {c.status === 'rejected' && c.rejection_reason && (
                  <div style={{ fontFamily: sans, fontSize: 13, color: '#D99A9A', background: 'rgba(156,90,90,0.08)', border: '1px solid rgba(156,90,90,0.25)', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>
                    {c.rejection_reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}