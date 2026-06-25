import { useEffect, useState, useCallback } from 'react';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

import {
  StreamVideo, StreamVideoClient, StreamCall,
  CallControls, SpeakerLayout, StreamTheme,
} from '@stream-io/video-react-sdk';
import '@stream-io/video-react-sdk/dist/css/styles.css';

// Request camera/mic permissions early — before the call starts
async function requestMediaPermissions(callType) {
  const needsVideo = callType !== 'audio';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: needsVideo,
    });
    // Stop all tracks immediately — we just needed the permission grant
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true, video: needsVideo };
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return { granted: false, denied: true, video: needsVideo };
    }
    return { granted: false, error: err.message, video: needsVideo };
  }
}

export default function Calls() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [duration,    setDuration]    = useState(10);
  const [booking,     setBooking]     = useState(false);
  const [booked,      setBooked]      = useState(null);
  const [error,       setError]       = useState('');
  const [myCalls,     setMyCalls]     = useState([]);
  const [activeCall,  setActiveCall]  = useState(null);
  const [joining,     setJoining]     = useState(null);
  const [topUp,       setTopUp]       = useState(null);

  // Permission state
  const [permStatus,  setPermStatus]  = useState(null);
  // null | { granted, denied, error, video, checking }

  const load = () => Promise.all([
    api.get('/api/calls/options'),
    api.get('/api/stream-calls/my-calls'),
  ]).then(([optData, callsData]) => {
    setData(optData);
    setMyCalls(callsData.calls || []);
  }).catch((err) => setError(err.message));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  // When user selects a call type — request permissions immediately
  const handleSelect = async (option) => {
    if (selected?.id === option.id) { setSelected(null); setPermStatus(null); return; }
    setSelected(option);
    setPermStatus({ checking: true });
    const result = await requestMediaPermissions(option.id);
    setPermStatus(result);
  };

  const handleBook = async () => {
    if (!selected) return;
    if (permStatus?.denied) {
      setError('Camera/microphone access was denied. Please allow access in your browser settings and try again.');
      return;
    }
    setError(''); setBooking(true);
    try {
      const result = await api.post('/api/calls/book', {
        callType:        selected.id,
        durationMinutes: duration,
      });
      setBooked(result);
      setSelected(null);
      setPermStatus(null);
      load();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(selected.coinsPerMin * duration);
      } else if (err.message === 'UNAVAILABLE') {
        setError('Jinal is unavailable for calls on this date.');
      } else {
        setError(err.message);
      }
    } finally { setBooking(false); }
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
      setActiveCall({ client, call });
    } catch (err) {
      setError('Could not join the call. Please try again.');
    } finally { setJoining(null); }
  }, []);

  const leaveCall = useCallback(async () => {
    if (!activeCall) return;
    try { await activeCall.call.leave(); await activeCall.client.disconnectUser(); } catch {}
    setActiveCall(null); load();
  }, [activeCall]);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  // ── Active call UI ──────────────────────────────────────────────────────────
  if (activeCall) {
    return (
      <StreamVideo client={activeCall.client}>
        <StreamCall call={activeCall.call}>
          <StreamTheme>
            <div style={{ height: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
              <SpeakerLayout />
              <div style={{ padding: 16, background: C.surface, display: 'flex', justifyContent: 'center', gap: 12 }}>
                <CallControls />
                <button onClick={leaveCall} style={{ background: '#9C5A5A', border: 'none', color: '#fff', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 8, cursor: 'pointer' }}>
                  Leave call
                </button>
              </div>
            </div>
          </StreamTheme>
        </StreamCall>
      </StreamVideo>
    );
  }

  const totalCost = selected ? selected.coinsPerMin * duration : 0;
  const canAfford = (data?.coinBalance || 0) >= totalCost;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Bookings</div>
        <h1 style={title}>Virtual sessions</h1>
        <p style={text}>
          Book a private audio or video call with Jinal. Tokens are charged at booking.
          {data?.isPrimetime && <strong style={{ color: C.accent }}> Primetime rates active ({data.multiplier}×).</strong>}
        </p>
      </div>

      <div style={balanceBar}>
        <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Your balance</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoinAmount amount={data?.coinBalance || 0} size={16} fontSize={16} />
          <button onClick={() => setTopUp(0)} style={topUpBtn}>Top up</button>
        </div>
      </div>

      {booked && <div style={successBox}>✓ {booked.message}</div>}
      {error  && <div style={errorBox}>{error}</div>}

      {/* Confirmed calls ready to join */}
      {myCalls.filter((c) => c.status === 'confirmed' && c.stream_call_id).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 12 }}>Ready to join</div>
          {myCalls.filter((c) => c.status === 'confirmed' && c.stream_call_id).map((c) => (
            <div key={c.id} style={{ ...card, border: `1px solid rgba(193,125,74,0.4)`, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: F.display, fontSize: 20, color: C.text }}>{c.call_type} call</div>
                  <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 4 }}>Confirmed by Jinal — tap to join</div>
                </div>
                <button onClick={() => joinCall(c.stream_call_id)} disabled={joining === c.stream_call_id} style={{ background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 8, cursor: 'pointer', opacity: joining === c.stream_call_id ? 0.6 : 1 }}>
                  {joining === c.stream_call_id ? 'Connecting…' : 'Join now'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.isUnavailable && (
        <div style={unavailableBanner}>🗓 {data.unavailableMessage}</div>
      )}

      {/* Call options */}
      {!data?.isUnavailable && (
        <div style={grid}>
          {data?.options.map((option) => {
            const isSelected = selected?.id === option.id;
            return (
              <div
                key={option.id}
                onClick={() => handleSelect(option)}
                style={{ ...card, border: isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`, cursor: 'pointer' }}
              >
                <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 6 }}>{option.title}</div>
                <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>{option.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <WonderCoinAmount amount={option.coinsPerMin} size={16} />
                  <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>/ min</span>
                </div>
                {data.discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent }}>{data.discountPct}% member discount</div>}
                {data.isGuest && <div style={nudge}>Members pay less — join a plan</div>}
                {isSelected && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 10 }}>✓ Selected</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Permission status — shown when a call type is selected */}
      {selected && permStatus && (
        <div style={{
          ...permBox,
          borderColor: permStatus.checking  ? C.border
                     : permStatus.granted   ? 'rgba(100,160,100,0.4)'
                     : 'rgba(156,90,90,0.4)',
          background: permStatus.checking  ? C.surface
                    : permStatus.granted   ? 'rgba(100,160,100,0.06)'
                    : 'rgba(156,90,90,0.06)',
        }}>
          {permStatus.checking && (
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>
              ⏳ Requesting {selected.id !== 'audio' ? 'camera and microphone' : 'microphone'} access…
            </span>
          )}
          {!permStatus.checking && permStatus.granted && (
            <span style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F' }}>
              ✓ {selected.id !== 'audio' ? 'Camera and microphone' : 'Microphone'} access granted — you're ready to connect
            </span>
          )}
          {!permStatus.checking && permStatus.denied && (
            <div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A', marginBottom: 6 }}>
                ✗ Access denied. To proceed, allow {selected.id !== 'audio' ? 'camera and microphone' : 'microphone'} access in your browser settings.
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted }}>
                On Safari: Settings → Personal Space → Camera &amp; Microphone → Allow.
                On Chrome: click the 🔒 icon in the address bar → allow permissions → reload.
              </div>
            </div>
          )}
          {!permStatus.checking && !permStatus.granted && !permStatus.denied && permStatus.error && (
            <span style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A' }}>
              Could not access {selected.id !== 'audio' ? 'camera/microphone' : 'microphone'}: {permStatus.error}
            </span>
          )}
        </div>
      )}

      {/* Booking panel */}
      {selected && !data?.isUnavailable && (
        <div style={bookingPanel}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 16 }}>Book {selected.title}</div>
          <div style={{ marginBottom: 20 }}>
            <div style={fieldLabel}>Duration</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[1, 3, 5, 10, 15].map((min) => (
                <button key={min} onClick={() => setDuration(min)} style={{ ...durationBtn, background: duration === min ? C.accent : 'transparent', color: duration === min ? '#1A1714' : C.muted, border: duration === min ? 'none' : `1px solid ${C.border}` }}>
                  {min} min
                </button>
              ))}
            </div>
          </div>
          <div style={totalRow}>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>{duration} min × {selected.coinsPerMin} tokens/min</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Total</span>
              <WonderCoinAmount amount={totalCost} size={20} fontSize={22} textColor={canAfford ? C.text : '#D99A9A'} />
            </div>
          </div>
          {!canAfford && (
            <div style={{ ...errorBox, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>You need {totalCost - (data?.coinBalance || 0)} more tokens.</span>
              <button onClick={() => setTopUp(totalCost)} style={inlineTopUp}>Top up now</button>
            </div>
          )}
          <button
            onClick={handleBook}
            disabled={booking || !canAfford || permStatus?.denied || permStatus?.checking}
            style={{ ...bookBtn, opacity: (booking || !canAfford || permStatus?.denied || permStatus?.checking) ? 0.5 : 1, cursor: (booking || !canAfford || permStatus?.denied || permStatus?.checking) ? 'default' : 'pointer' }}
          >
            {booking ? 'Booking…' : permStatus?.denied ? 'Allow camera/mic access first' : `Book & pay ${totalCost} tokens`}
          </button>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
            Tokens charged immediately. A "Join now" button appears once Jinal confirms.
          </div>
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

const eyebrow         = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title           = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text            = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const balanceBar      = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16 };
const topUpBtn        = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' };
const inlineTopUp     = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const unavailableBanner = { background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', color: '#D99A9A', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const successBox      = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const errorBox        = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const grid            = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 16 };
const card            = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column' };
const nudge           = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginTop: 8 };
const permBox         = { border: '1px solid', borderRadius: 8, padding: '12px 16px', marginBottom: 16, transition: 'all 0.2s' };
const bookingPanel    = { background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 24 };
const fieldLabel      = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 10 };
const durationBtn     = { fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };
const totalRow        = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 16 };
const bookBtn         = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 8, width: '100%' };