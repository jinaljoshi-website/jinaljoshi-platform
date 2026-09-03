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
  // Video for anything that is not an audio call, instant or scheduled. Testing
  // against the single string 'audio' would have asked an instant audio caller
  // for their camera — a permission prompt for hardware the call never uses,
  // which is the sort of thing that makes somebody abandon a purchase.
  const needsVideo = !String(callType).endsWith('audio');
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
  const [custom,       setCustom]       = useState(false);

  // Times offered from now rather than from midnight. The value is in the
  // format datetime-local expects, and the label is what a person would say.
  const leadHours = data?.minLeadHours ?? 1;
  const toLocalInput = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const roundToNext15 = (d) => {
    const x = new Date(d);
    x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15, 0, 0);
    return x;
  };
  const minDateTimeLocal = toLocalInput(roundToNext15(new Date(Date.now() + leadHours * 3600000)));
  const quickSlots = [1, 2, 3].map((h) => {
    const at = roundToNext15(new Date(Date.now() + Math.max(h, leadHours) * 3600000));
    return {
      label: `In ${Math.max(h, leadHours)} hour${Math.max(h, leadHours) === 1 ? '' : 's'}`,
      at: at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      value: toLocalInput(at),
    };
  });
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

  // Instant is a prefix now, not one type. Comparing against a single string
  // would have treated an instant audio call as a scheduled one — asking for a
  // time instead of ringing anybody.
  const isPriority = Boolean(selected?.id?.startsWith('priority-'));

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
      if (err.code === 'INSUFFICIENT_TOKENS') {
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

      // An audio call joins with the camera off.
      //
      // Stream's default is video on for every call type, so buying a voice
      // call opened the camera anyway — the fan appeared on video having paid
      // the audio rate and chosen audio, which is worse than a billing error.
      // The camera is disabled before joining rather than after, so it is never
      // briefly live.
      const isAudioOnly = String(callRecord.call_type || '').endsWith('audio');
      if (isAudioOnly) { try { await call.camera.disable(); } catch {} }

      await call.join({ create: false });
      // Again after joining: the SDK applies its own defaults as the call
      // connects, and can turn the camera back on doing so.
      if (isAudioOnly) { try { await call.camera.disable(); } catch {} }
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
    const id = activeCallRecord?.id;
    try { await activeCall.call.leave(); await activeCall.client.disconnectUser(); } catch {}
    if (pollRef.current) clearInterval(pollRef.current);
    setActiveCall(null);
    setActiveCallRecord(null);
    // Tell the server the call is over. Leaving used to tear down the local
    // connection and say nothing, so the row stayed in_progress until the
    // duration cutoff came round — Studio went on showing the call as live for
    // the whole paid duration, and the room stayed open behind it.
    if (id) { try { await api.post(`/api/stream-calls/${id}/leave`, {}); } catch {} }
    // Awaited, so the frozen list is replaced before anything reads it again.
    await load();
  }, [activeCall, activeCallRecord]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // A fan who requested a priority call has already consented to it. Asking them
  // to "answer" once Jinal picks up is a second, pointless gate — so once we see
  // Jinal join a call this fan was already waiting on, connect them straight away.
  // A call the fan started connects itself the moment Jinal picks up.
  //
  // Asking somebody to accept a call they placed thirty seconds ago is the
  // wrong question — they have already consented, twice: once by choosing the
  // call and once by paying for it. The accept step belongs to a call that
  // arrives unbidden, which here means a scheduled one Jinal rings.
  //
  // proposed_by is the discriminator and it is already on the row. An earlier
  // attempt at this watched for the waiting state with a ref and only joined if
  // it had seen one — but the list polls every five seconds, so a call answered
  // inside that window never showed a waiting state at all, and the fan was
  // asked to accept their own call. The faster Jinal answered, the more
  // reliably it broke. Reading the row rather than remembering a previous
  // render removes the race entirely.
  const fanStarted = (c) => c?.proposed_by === 'fan';

  useEffect(() => {
    const ringing = myCalls.find((c) => c.status === 'ringing');
    if (!ringing || activeCall || answering) return;
    if (!fanStarted(ringing) || !ringing.artist_joined_at) return;
    joinCall(ringing);
  }, [myCalls, activeCall, answering, joinCall]);

  // Built here and rendered inside whichever card was chosen, rather than
  // returned further down the page.
  //
  // Choosing a call type used to load the permission notice and the whole
  // booking panel below the fold — the page looked as though nothing had
  // happened, while everything needed to actually place the call sat off
  // screen. Somebody who did not think to scroll simply never booked.
  // Functions, not values.
  //
  // These were consts holding JSX, which evaluates immediately — and the
  // booking one reads totalCost and canAfford, both declared further down. So
  // it read them before they existed and the page went blank on the first tap.
  // A function body is not evaluated until it is called, and it is called from
  // the returned tree, by which point everything exists.
  const renderPerm = () => (selected && permStatus) ? (
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
              ⏳ Requesting {selected.media === 'video' ? 'camera and microphone' : 'microphone'} access…
            </span>
          )}
          {!permStatus.checking && permStatus.granted && (
            <span style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F' }}>
              ✓ {selected.media === 'video' ? 'Camera and microphone' : 'Microphone'} access granted — you're ready to connect
            </span>
          )}
          {!permStatus.checking && permStatus.denied && (
            <div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A', marginBottom: 6 }}>
                ✗ Access denied. To proceed, allow {selected.media === 'video' ? 'camera and microphone' : 'microphone'} access in your browser settings.
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted }}>
                On Safari: Settings → Personal Space → Camera &amp; Microphone → Allow.
                On Chrome: click the 🔒 icon in the address bar → allow permissions → reload.
              </div>
            </div>
          )}
          {!permStatus.checking && !permStatus.granted && !permStatus.denied && permStatus.error && (
            <span style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A' }}>
              Could not access {selected.media === 'video' ? 'camera/microphone' : 'microphone'}: {permStatus.error}
            </span>
          )}
        </div>
  ) : null;

  // No heading and no border on this: it now sits inside the card that already
  // says what was chosen and what it costs, so repeating either would just be
  // saying the same thing twice in a smaller font.
  const renderBooking = () => (selected && !data?.isUnavailable) ? (
        <div>
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
              <div style={fieldLabel}>When would you like to talk?</div>

              {/* Offering times rather than an empty picker. Choosing a date and
                  a time from scratch is real work for something most people
                  want soon — and the old label never changed once a time was
                  set, so there was nothing confirming the choice had landed. */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: custom ? 12 : 0 }}>
                {quickSlots.map((s) => {
                  const on = !custom && proposedTime === s.value;
                  return (
                    <button key={s.label}
                            onClick={() => { setCustom(false); setProposedTime(s.value); }}
                            style={on ? slotOn : slotOff}>
                      <div style={{ fontSize: 13 }}>{s.label}</div>
                      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{s.at}</div>
                    </button>
                  );
                })}
                <button onClick={() => { setCustom(true); setProposedTime(''); }}
                        style={custom ? slotOn : slotOff}>
                  <div style={{ fontSize: 13 }}>Another time</div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>pick your own</div>
                </button>
              </div>

              {custom && (
                <input
                  type="datetime-local"
                  value={proposedTime}
                  min={minDateTimeLocal}
                  onChange={(e) => setProposedTime(e.target.value)}
                  style={dateInput}
                />
              )}

              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
                {proposedTime
                  ? `You're asking for ${new Date(proposedTime).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Jinal can accept or suggest another time.`
                  : `At least ${data?.minLeadHours || 1} hour${(data?.minLeadHours || 1) === 1 ? '' : 's'} from now.`}
              </div>
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
            <div style={{ ...errorBox, marginBottom: 12 }}>
              {totalCost - (data?.coinBalance || 0)} tokens short — topping up takes a moment.
            </div>
          )}
          {/* Short of tokens opens the top-up with the exact difference. Only the
              things that genuinely prevent a call — no time chosen, no camera
              permission — keep the button disabled. */}
          <button
            onClick={() => canAfford ? handleBook() : setTopUp(totalCost - (data?.coinBalance || 0))}
            disabled={booking || (!isPriority && !proposedTime) || permStatus?.denied || permStatus?.checking}
            style={{ ...bookBtn, opacity: (booking || (!isPriority && !proposedTime) || permStatus?.denied || permStatus?.checking) ? 0.5 : 1, cursor: booking ? 'default' : 'pointer' }}
          >
            {booking ? (isPriority ? 'Calling…' : 'Booking…')
              : permStatus?.denied ? 'Allow camera/mic access first'
              : (!isPriority && !proposedTime) ? 'Propose a time first'
              : !canAfford ? `Top up to ${isPriority ? 'call' : 'book'}`
              : isPriority ? `Call now & pay ${totalCost} tokens` : `Book & pay ${totalCost} tokens`}
          </button>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8 }}>
            {isPriority
              ? 'Tokens charged immediately. If Jinal cannot answer in time, you are refunded automatically.'
              : 'Tokens charged immediately. Jinal will confirm your proposed time, suggest another, or decline. If declined, your tokens are refunded automatically.'}
          </div>
        </div>
  ) : null;

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  // ── Ringing overlay takes over the whole screen, highest priority ──────────
  // A ring that has not expired.
  //
  // myCalls stops refreshing while a call is active — the poll runs only when
  // there is no active call — so it stays frozen at the moment the call began,
  // when the row still said ringing. The instant the call ended and activeCall
  // cleared, that stale row brought the incoming-call overlay back and the
  // phone rang again, for a call that had just finished.
  //
  // Checking the ring window closes that: a call that actually rang and was
  // answered has a window long past, so a stale row cannot ring anybody.
  const ringingCall = myCalls.find((c) =>
    c.status === 'ringing'
    && (!c.ring_expires_at || new Date(c.ring_expires_at) > new Date()));
  if (ringingCall && !activeCall) {
    return (
      <IncomingCallOverlay
        call={ringingCall}
        answering={answering}
        // A call the fan placed is never presented as something to accept, at
        // any point — not while it rings and not in the seconds after Jinal
        // picks up, when the connection is being made. Passing this rather than
        // deriving it from artist_joined_at is what keeps an Answer button from
        // flashing up on a call somebody already made.
        selfInitiated={ringingCall.proposed_by === 'fan'}
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
        // Two cards, in the order the decision is actually made: now or later,
        // then audio or video. Before this there were three flat options with
        // the instant one last — so the thing most people want sat at the
        // bottom, and audio and video were split across separate cards as
        // though they were different products rather than the same call.
        //
        // The chosen card expands in place. Everything needed to book sits
        // inside the card that says what it costs, instead of a stack of
        // full-width bars further down the page with the price scrolled away.
        <div style={groupWrap}>
          {(data?.groups || []).map((group) => {
            const isInstant = group.id === 'instant';
            const blocked   = isInstant && data?.dndActive;
            const chosen    = group.options.find((o) => o.id === selected?.id);
            const openHere  = Boolean(chosen);

            return (
              <div key={group.id}
                   style={{ ...groupCard,
                            borderColor: openHere ? C.accent : (isInstant ? 'rgba(217,164,92,0.35)' : C.border),
                            opacity: blocked ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: F.display, fontSize: 24, color: C.text }}>{group.title}</span>
                  {isInstant && !blocked && <span style={instantBadge}>No waiting</span>}
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, margin: '6px 0 14px', lineHeight: 1.6 }}>
                  {group.description}
                </div>

                {blocked ? (
                  <div style={offlineBadge}>Jinal is offline right now — schedule instead</div>
                ) : (
                  <div style={{ ...mediaRow, gridTemplateColumns: group.options.length > 1 ? '1fr 1fr' : '1fr' }}>
                    {group.options.map((option) => {
                      const on = selected?.id === option.id;
                      return (
                        <button key={option.id} onClick={() => handleSelect(option)}
                                style={{ ...mediaBtn,
                                         borderColor: on ? C.accent : C.border,
                                         background: on ? 'rgba(193,125,74,0.12)' : 'transparent' }}>
                          <span style={{ fontFamily: F.sans, fontSize: 14, color: C.text }}>{option.label}</span>
                          {/* The unit goes on both lines rather than after the
                              pair, or "27" over "₹1,782" followed by "/ min"
                              reads as a price for twenty-seven minutes. */}
                          <WonderCoinAmount amount={option.coinsPerMin} size={13} fontSize={13}
                                            suffix="a minute" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {data.discountPct > 0 && !blocked && (
                  <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginTop: 10 }}>
                    {data.discountPct}% member discount applied
                  </div>
                )}
                {data.isGuest && !blocked && (
                  <div style={{ marginTop: 10 }}><GuestNudge compact message="Members pay less per minute" /></div>
                )}

                {openHere && (
                  <div style={expandArea}>
                    {renderPerm()}
                    {renderBooking()}
                  </div>
                )}
              </div>
            );
          })}
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
// Two cards rather than three, grouped by the decision being made.
const groupWrap = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', marginBottom: 20 };
const groupCard = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 };
// One choice fills the card; more sit side by side. Driven by the option count
// rather than fixed at two, so removing audio did not leave a half-empty row.
const mediaRow  = { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' };
const mediaBtn  = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '11px 13px', borderRadius: 9, border: `1px solid ${C.border}`, cursor: 'pointer' };
// The area that opens inside the chosen card. A rule above it so the controls
// read as belonging to the choice rather than floating under it.
const expandArea = { marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` };

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
const slotOff = { flex: '1 1 108px', background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left' };
const slotOn  = { ...slotOff, background: 'rgba(193,125,74,0.12)', border: `1px solid ${C.accent}`, color: C.accent };

const dateInput       = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '10px 12px', borderRadius: 8, outline: 'none' };
const totalRow        = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 16 };
const bookBtn         = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 8, width: '100%' };
const smallBtn        = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };
const smallGhostBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };