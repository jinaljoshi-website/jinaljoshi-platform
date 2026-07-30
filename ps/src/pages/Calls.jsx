import { useEffect, useState, useCallback, useRef } from 'react';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';
import GuestNudge from '../components/GuestNudge';
import CallTimer from '../components/CallTimer';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import CallStage from '../components/CallStage';
import NotificationNudge from '../components/NotificationNudge';

import {
  StreamVideo, StreamVideoClient, StreamCall, StreamTheme,
} from '@stream-io/video-react-sdk';
import '@stream-io/video-react-sdk/dist/css/styles.css';

async function requestMediaPermissions(callType) {
  const needsVideo = callType !== 'audio';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: needsVideo,
    });
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
  const [proposedTime, setProposedTime] = useState('');
  const [booking,     setBooking]     = useState(false);
  const [booked,      setBooked]      = useState(null);
  const [error,       setError]       = useState('');
  const [myCalls,     setMyCalls]     = useState([]);
  const [activeCall,  setActiveCall]  = useState(null);
  const [activeCallRecord, setActiveCallRecord] = useState(null);
  const [joining,     setJoining]     = useState(null);
  const [answering,   setAnswering]   = useState(false);
  const [declining,   setDeclining]   = useState(false);
  const [topUp,       setTopUp]       = useState(null);
  const [counterFor,  setCounterFor]  = useState(null);
  const [counterTime, setCounterTime] = useState('');
  const [permStatus,  setPermStatus]  = useState(null);
  const [justBookedPriority, setJustBookedPriority] = useState(false);

  const pollRef = useRef(null);

  const load = () => Promise.all([
    api.get('/api/calls/options'),
    api.get('/api/stream-calls/my-calls'),
  ]).then(([optData, callsData]) => {
    setData(optData);
    setMyCalls(callsData.calls || []);
  }).catch((err) => setError(err.message));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  // Poll for live updates — catches Jinal answering a priority call, starting a scheduled one,
  // confirming, or countering a time, without requiring the fan to manually refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (!activeCall) load();
    }, 5000);
    return () => clearInterval(interval);
  }, [activeCall]);

  const handleSelect = async (option) => {
    if (selected?.id === option.id) { setSelected(null); setPermStatus(null); return; }
    setSelected(option);
    setPermStatus({ checking: true });
    const result = await requestMediaPermissions(option.id);
    setPermStatus(result);
  };

  const isPriority = selected?.id === 'priority-video';

  const handleBook = async () => {
    if (!selected) return;
    if (!isPriority && !proposedTime) return;
    if (permStatus?.denied) {
      setError('Camera/microphone access was denied. Please allow access in your browser settings and try again.');
      return;
    }
    setError(''); setBooking(true);
    try {
      const payload = { callType: selected.id, durationMinutes: duration };
      if (!isPriority) payload.proposedTime = new Date(proposedTime).toISOString();

      const result = await api.post('/api/calls/book', payload);
      setBooked(result);
      setSelected(null);
      setPermStatus(null);
      setProposedTime('');
      if (isPriority) setJustBookedPriority(true);
      load();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(selected.coinsPerMin * duration);
      } else if (err.message === 'UNAVAILABLE') {
        setError('Jinal is unavailable for calls on this date.');
      } else if (err.message === 'DND_ACTIVE') {
        setError("Jinal isn't available for instant calls right now. Try scheduling a call instead — she'll get back to you.");
      } else if (err.message === 'TOO_SOON') {
        setError('That time is too soon — try Priority Video instead, or pick a later time at least a few hours ahead.');
      } else {
        setError(err.message);
      }
    } finally { setBooking(false); }
  };

  const respondToCall = async (id, action, extra) => {
    setError('');
    try {
      const res = await api.post(`/api/calls/${id}/respond`, { action, ...extra });
      setBooked(res);
      setCounterFor(null);
      setCounterTime('');
      load();
    } catch (err) { setError(err.message); }
  };

  const startPolling = useCallback((callId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { call } = await api.get(`/api/stream-calls/${callId}`);
        setActiveCallRecord(call);
        if (call.status === 'completed') {
          clearInterval(pollRef.current);
        }
      } catch {}
    }, 3000);
  }, []);

  const joinCall = useCallback(async (callRecord) => {
    setJoining(callRecord.stream_call_id);
    setAnswering(true);
    setError('');
    try {
      const tokenData = await api.post('/api/stream-calls/token', {});
      const client = new StreamVideoClient({
        apiKey: tokenData.apiKey,
        user:   { id: tokenData.userId, name: tokenData.userName },
        token:  tokenData.token,
      });
      const call = client.call('default', callRecord.stream_call_id);
      await call.join({ create: false });
      setActiveCall({ client, call });
      setActiveCallRecord(callRecord);
      await api.post(`/api/stream-calls/${callRecord.id}/joined`, {});
      startPolling(callRecord.id);
    } catch (err) {
      setError('Could not join the call. Please try again.');
    } finally { setJoining(null); setAnswering(false); }
  }, [startPolling]);

  const declineRinging = useCallback(async (callId) => {
    setDeclining(true);
    try {
      await api.post(`/api/stream-calls/${callId}/decline`, {});
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeclining(false);
    }
  }, []);

  const leaveCall = useCallback(async () => {
    if (!activeCall) return;
    try { await activeCall.call.leave(); await activeCall.client.disconnectUser(); } catch {}
    if (pollRef.current) clearInterval(pollRef.current);
    setActiveCall(null);
    setActiveCallRecord(null);
    load();
  }, [activeCall]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  // ── Ringing overlay takes over the whole screen, highest priority ──────────
  const ringingCall = myCalls.find((c) => c.status === 'ringing');
  if (ringingCall && !activeCall) {
    return (
      <IncomingCallOverlay
        call={ringingCall}
        answering={answering}
        onAnswer={() => joinCall(ringingCall)}
        onDecline={() => declineRinging(ringingCall.id)}
      />
    );
  }

  // ── Active call UI ──────────────────────────────────────────────────────────
  if (activeCall) {
    const durationMinutes = activeCallRecord ? Math.round(activeCallRecord.coins_charged / activeCallRecord.coins_per_min) : null;
    return (
      <StreamVideo client={activeCall.client}>
        <StreamCall call={activeCall.call}>
          <StreamTheme>
            <CallStage
              onLeave={leaveCall}
              timerNode={
                <CallTimer
                  callStartedAt={activeCallRecord?.call_started_at}
                  durationMinutes={durationMinutes}
                  onExpire={leaveCall}
                />
              }
            />
          </StreamTheme>
        </StreamCall>
      </StreamVideo>
    );
  }

  const totalCost = selected ? selected.coinsPerMin * duration : 0;
  const canAfford = (data?.coinBalance || 0) >= totalCost;
  const pastCalls = myCalls.filter((c) => ['completed', 'rejected', 'missed'].includes(c.status));
  const awaitingJinal = myCalls.filter((c) => c.status === 'pending' && c.proposed_by === 'fan');
  const needsMyResponse = myCalls.filter((c) => c.status === 'pending' && c.proposed_by === 'jinal');
  const scheduledCalls = myCalls.filter((c) => c.status === 'scheduled');

  const statusColor = (status) => {
    if (status === 'completed') return '#8FC88F';
    if (status === 'missed') return '#D9A45C';
    return '#D99A9A';
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Calls</div>
        <h1 style={title}>Video &amp; audio calls</h1>
        <p style={text}>
          Schedule a call with Jinal, or connect instantly if she&rsquo;s free right now.
          {data?.isPrimetime && <strong style={{ color: C.accent }}> Primetime rates active ({data.multiplier}×).</strong>}
        </p>
      </div>

      {justBookedPriority && <NotificationNudge forceShow />}

      <div style={balanceBar}>
        <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Your balance</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoinAmount amount={data?.coinBalance || 0} size={16} fontSize={16} />
          <button onClick={() => setTopUp(0)} style={topUpBtn}>Top up</button>
        </div>
      </div>

      {booked && <div style={successBox}>✓ {booked.message}</div>}
      {error  && <div style={errorBox}>{error}</div>}

      {needsMyResponse.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 12 }}>Jinal proposed a time</div>
          {needsMyResponse.map((c) => (
            <div key={c.id} style={{ ...card, border: `1px solid ${C.accent}`, marginBottom: 10 }}>
              <div style={{ fontFamily: F.display, fontSize: 18, color: C.text, marginBottom: 6 }}>{c.call_type} call</div>
              <div style={{ fontFamily: F.sans, fontSize: 14, color: C.accent, marginBottom: 14 }}>
                Proposed: {new Date(c.proposed_time).toLocaleString()}
              </div>

              {counterFor === c.id ? (
                <div>
                  <input
                    type="datetime-local"
                    value={counterTime}
                    onChange={(e) => setCounterTime(e.target.value)}
                    style={dateInput}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => respondToCall(c.id, 'counter', { proposedTime: new Date(counterTime).toISOString() })}
                      disabled={!counterTime}
                      style={{ ...smallBtn, opacity: counterTime ? 1 : 0.5 }}
                    >
                      Send new time
                    </button>
                    <button onClick={() => { setCounterFor(null); setCounterTime(''); }} style={smallGhostBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => respondToCall(c.id, 'accept')} style={smallBtn}>Accept this time</button>
                  {c.negotiation_round < 4 && (
                    <button onClick={() => setCounterFor(c.id)} style={smallGhostBtn}>Propose different time</button>
                  )}
                  <button onClick={() => respondToCall(c.id, 'reject')} style={{ ...smallGhostBtn, color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>Decline</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {scheduledCalls.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 12 }}>Scheduled</div>
          {scheduledCalls.map((c) => (
            <div key={c.id} style={{ ...card, marginBottom: 10 }}>
              <div style={{ fontFamily: F.display, fontSize: 18, color: C.text }}>{c.call_type} call</div>
              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 4 }}>
                {new Date(c.scheduled_at).toLocaleString()} · Jinal will call you at this time
              </div>
            </div>
          ))}
        </div>
      )}

      {awaitingJinal.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 12 }}>Awaiting confirmation</div>
          {awaitingJinal.map((c) => (
            <div key={c.id} style={{ ...card, marginBottom: 10 }}>
              <div style={{ fontFamily: F.display, fontSize: 18, color: C.text }}>{c.call_type} call</div>
              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 4 }}>
                Proposed {new Date(c.proposed_time).toLocaleString()} · {c.coins_charged} tokens · Jinal will confirm shortly
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={conductBox}>
        <div style={conductTitle}>Before you call</div>
        <p style={conductLine}>
          These are real conversations, and Jinal is on the other end of them. Please treat a call
          here the way you&rsquo;d treat a video call with anyone whose time you value.
        </p>
        <p style={conductLine}>
          Calls are for conversation. Anything abusive, obscene or sexual in nature ends the call
          immediately, without a refund, and may cost you access to the platform. Recording or
          capturing a call in any form is not permitted.
        </p>
        <p style={{ ...conductLine, marginBottom: 0, opacity: 0.75 }}>
          This almost never comes up &mdash; but it&rsquo;s worth saying plainly.
        </p>
      </div>

      {data?.isUnavailable && (
        <div style={unavailableBanner}>🗓 {data.unavailableMessage}</div>
      )}

      {!data?.isUnavailable && (
        <div style={grid}>
          {data?.options.map((option) => {
            const isSelectedOption = selected?.id === option.id;
            return (
              <div
                  key={option.id}
                  onClick={() => {
                    if (option.id === 'priority-video' && data?.dndActive) return;
                    handleSelect(option);
                  }}
                  style={{
                    ...card,
                    border: isSelectedOption ? `1px solid ${C.accent}` : (option.id === 'priority-video' ? '1px solid rgba(217,164,92,0.4)' : `1px solid ${C.border}`),
                    cursor: (option.id === 'priority-video' && data?.dndActive) ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: F.display, fontSize: 24, color: C.text }}>{option.title}</span>
                    {option.id === 'priority-video' && !data?.dndActive && <span style={instantBadge}>No waiting</span>}
                  </div>
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>{option.description}</div>
                  {option.id === 'priority-video' && data?.dndActive && (
                    <div style={offlineBadge}>Jinal is offline right now — schedule instead</div>
                  )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <WonderCoinAmount amount={option.coinsPerMin} size={16} />
                  <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>/ min</span>
                </div>
                {data.discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent }}>{data.discountPct}% member discount</div>}
                {data.isGuest && <div style={{ marginTop: 8 }}><GuestNudge compact message="Members pay less per minute" /></div>}
                {isSelectedOption && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 10 }}>✓ Selected</div>}
              </div>
            );
          })}
        </div>
      )}

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

      {selected && !data?.isUnavailable && (
        <div style={bookingPanel}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 16 }}>
            {isPriority ? `Call Jinal now` : `Book ${selected.title}`}
          </div>
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

          {!isPriority && (
            <div style={{ marginBottom: 20 }}>
              <div style={fieldLabel}>Propose a time (at least {data?.minLeadHours || 6} hours from now)</div>
              <input
                type="datetime-local"
                value={proposedTime}
                onChange={(e) => setProposedTime(e.target.value)}
                style={dateInput}
              />
            </div>
          )}

          {isPriority && (
            <div style={{ ...nudge, marginBottom: 20 }}>
              This connects instantly. Jinal will get an urgent alert and has about a minute to answer. If she can't, you're refunded automatically.
            </div>
          )}

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
            disabled={booking || !canAfford || (!isPriority && !proposedTime) || permStatus?.denied || permStatus?.checking}
            style={{ ...bookBtn, opacity: (booking || !canAfford || (!isPriority && !proposedTime) || permStatus?.denied || permStatus?.checking) ? 0.5 : 1, cursor: (booking || !canAfford) ? 'default' : 'pointer' }}
          >
            {booking ? (isPriority ? 'Calling…' : 'Booking…') : permStatus?.denied ? 'Allow camera/mic access first' : (!isPriority && !proposedTime) ? 'Propose a time first' : isPriority ? `Call now & pay ${totalCost} tokens` : `Book & pay ${totalCost} tokens`}
          </button>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
            {isPriority
              ? 'Tokens charged immediately. If Jinal cannot answer in time, you are refunded automatically.'
              : 'Tokens charged immediately. Jinal will confirm your proposed time, suggest another, or decline. If declined, your tokens are refunded automatically.'}
          </div>
        </div>
      )}

      {pastCalls.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 14 }}>Call history</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {pastCalls.map((c) => (
              <div key={c.id} style={historyCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, fontWeight: 600 }}>{c.call_type} call</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {c.coins_charged} tokens · {new Date(c.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontFamily: F.sans, fontSize: 12, color: statusColor(c.status), textTransform: 'capitalize' }}>{c.status}</span>
                </div>
                {(c.status === 'rejected' || c.status === 'missed') && c.rejection_reason && (
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: statusColor(c.status), background: 'rgba(156,90,90,0.08)', border: '1px solid rgba(156,90,90,0.25)', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>
                    {c.rejection_reason}
                  </div>
                )}
              </div>
            ))}
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
const historyCard     = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 };
const instantBadge    = { fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.accent, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.3)`, borderRadius: 4, padding: '3px 7px' };
const offlineBadge    = { fontFamily: F.sans, fontSize: 12, color: '#D9A45C', background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.25)', borderRadius: 6, padding: '7px 10px', marginBottom: 12 };
const conductBox      = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 20 };
const conductTitle    = { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 };
const conductLine     = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.7, margin: '0 0 10px' };
const nudge           = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginTop: 8 };
const permBox         = { border: '1px solid', borderRadius: 8, padding: '12px 16px', marginBottom: 16, transition: 'all 0.2s' };
const bookingPanel    = { background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 24 };
const fieldLabel      = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 10 };
const durationBtn     = { fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };
const dateInput       = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '10px 12px', borderRadius: 8, outline: 'none' };
const totalRow        = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 16 };
const bookBtn         = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 8, width: '100%' };
const smallBtn        = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };
const smallGhostBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };