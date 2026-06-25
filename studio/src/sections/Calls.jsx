// studio/src/sections/Calls.jsx
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, Badge, colors } from '../ui';

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
  const [creating,   setCreating]   = useState(null); // callRequestId being created
  const [activeCall, setActiveCall] = useState(null);
  const [joining,    setJoining]    = useState(null);
  const [error,      setError]      = useState('');

  useEffect(() => {
    api.get('/api/studio/calls')
      .then((d) => setCalls(d.calls || []))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (id, status) => {
    try {
      const data = await api.patch(`/api/studio/calls/${id}`, { status });
      setCalls((prev) => prev.map((c) => c.id === id ? data.call : c));
    } catch (err) { alert(err.message); }
  };

  const createCallRoom = async (callRequestId) => {
    setCreating(callRequestId); setError('');
    try {
      const data = await api.post('/api/stream-calls/create', { callRequestId });
      // Refresh calls list
      const updated = await api.get('/api/studio/calls');
      setCalls(updated.calls || []);
      // Auto-join
      joinCall(data.callId);
    } catch (err) {
      setError(err.message);
      setCreating(null);
    }
  };

  const joinCall = useCallback(async (streamCallId) => {
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
    } catch (err) {
      setError('Could not join the call: ' + err.message);
    } finally {
      setJoining(null);
      setCreating(null);
    }
  }, []);

  const leaveCall = useCallback(async () => {
    if (!activeCall) return;
    try {
      await activeCall.call.leave();
      await activeCall.client.disconnectUser();
    } catch (e) { console.error(e); }
    setActiveCall(null);
    // Refresh
    api.get('/api/studio/calls').then((d) => setCalls(d.calls || [])).catch(() => {});
  }, [activeCall]);

  if (loading) return <T.muted>Loading calls…</T.muted>;

  // ── Active call UI ──
  if (activeCall) {
    return (
      <StreamVideo client={activeCall.client}>
        <StreamCall call={activeCall.call}>
          <StreamTheme>
            <div style={{ height: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
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

  const pending   = calls.filter((c) => c.status === 'pending');
  const confirmed = calls.filter((c) => c.status === 'confirmed');
  const others    = calls.filter((c) => !['pending', 'confirmed'].includes(c.status));

  const sans = "'DM Sans', system-ui, sans-serif";

  return (
    <div>
      <Eyebrow>Call requests</Eyebrow>
      <T.title>Calls</T.title>

      {error && <div style={S.error}>{error}</div>}
      {calls.length === 0 && <T.muted>No call requests yet.</T.muted>}

      {/* Pending — start call */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Pending ({pending.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.map((c) => (
              <div key={c.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={{ ...S.rowSub, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      {c.coins_charged} tokens · {new Date(c.created_at).toLocaleDateString()} · <Badge tier={c.tier} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => createCallRoom(c.id)}
                      disabled={creating === c.id}
                      style={{ background: colors.accent, border: 'none', color: '#1A1714', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', opacity: creating === c.id ? 0.6 : 1 }}
                    >
                      {creating === c.id ? 'Starting…' : '▶ Start call'}
                    </button>
                    <button onClick={() => updateStatus(c.id, 'cancelled')} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmed — rejoin */}
      {confirmed.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Confirmed ({confirmed.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {confirmed.map((c) => (
              <div key={c.id} style={{ ...S.card, border: `1px solid rgba(193,125,74,0.3)` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={S.rowTitle}>{c.display_name || c.email} — {c.call_type}</div>
                    <div style={{ fontFamily: sans, fontSize: 12, color: colors.accent, marginTop: 4 }}>Room ready · fan can join</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {c.stream_call_id && (
                      <button
                        onClick={() => joinCall(c.stream_call_id)}
                        disabled={joining === c.stream_call_id}
                        style={{ background: colors.accent, border: 'none', color: '#1A1714', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', opacity: joining === c.stream_call_id ? 0.6 : 1 }}
                      >
                        {joining === c.stream_call_id ? 'Joining…' : '▶ Rejoin'}
                      </button>
                    )}
                    <button onClick={() => updateStatus(c.id, 'completed')} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px' }}>
                      Mark complete
                    </button>
                  </div>
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
              <div key={c.id} style={{ ...S.card, ...S.listRow }}>
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}