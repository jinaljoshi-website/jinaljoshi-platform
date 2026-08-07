// studio/src/components/RingWatch.jsx
// A ringtone Jinal will actually recognise.
//
// A push notification cannot carry a custom sound — the Notifications spec had a
// `sound` property, no browser ever implemented it, and it was removed in 2018.
// So a push will always use whatever the phone's default notification chime is.
//
// What we can do is play audio ourselves while Studio is open, which is the case
// that matters: priority calls only reach her when she is marked available, and
// that is when Studio is most likely to be in front of her. The push remains the
// fallback for when it is closed.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const POLL_MS = 4000;

// Synthesised rather than a file: no asset to host, no download before the first
// ring, and it works offline. Two alternating tones, close to a phone ringing.
function useRingtone() {
  const ctxRef  = useRef(null);
  const stopRef = useRef(null);

  // Browsers refuse to play audio until the user has interacted with the page,
  // so the context is created on the first click and kept. Without this the
  // first call of the day would ring silently.
  useEffect(() => {
    const unlock = () => {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) ctxRef.current = new Ctx();
      }
      ctxRef.current?.resume?.();
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const start = () => {
    const ctx = ctxRef.current;
    if (!ctx || stopRef.current) return;

    let cancelled = false;
    const ring = () => {
      if (cancelled) return;
      // Two short tones, a beat apart, then a pause — the shape of a ring
      // rather than a beep.
      [0, 0.4].forEach((offset) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 620;
        const t = ctx.currentTime + offset;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.setValueAtTime(0.18, t + 0.28);
        gain.gain.linearRampToValueAtTime(0, t + 0.34);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    };

    ring();
    const id = setInterval(ring, 2400);
    stopRef.current = () => { cancelled = true; clearInterval(id); };
  };

  const stop = () => { stopRef.current?.(); stopRef.current = null; };

  useEffect(() => stop, []);
  return { start, stop };
}

export function RingWatch({ onOpenCalls }) {
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const { start, stop } = useRingtone();

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const d = await api.get('/api/studio/calls/ringing');
        if (alive) setCall(d.call || null);
      } catch { /* a failed poll is not worth reporting */ }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (call && !muted) start(); else stop();
  }, [call, muted]);

  // Muting applies to this call only — the next one rings again, because
  // silencing one call should not silence tomorrow's.
  useEffect(() => { setMuted(false); }, [call?.id]);

  if (!call) return null;

  const who = call.display_name || call.email;
  const tier = call.tier ? call.tier.charAt(0).toUpperCase() + call.tier.slice(1) : 'Guest';

  return (
    <div style={bar}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontFamily: sans, fontSize: 15, color: '#fff', fontWeight: 700 }}>
          {who} is calling
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
          {tier} · {call.duration_minutes} min · {call.total_cost} tokens
        </div>
      </div>
      <button onClick={onOpenCalls} style={answerBtn}>Answer</button>
      <button onClick={() => setMuted((m) => !m)} style={muteBtn} title={muted ? 'Unmute' : 'Silence this call'}>
        {muted ? '🔇' : '🔔'}
      </button>
    </div>
  );
}

const bar = {
  position: 'sticky', top: 0, zIndex: 200,
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  background: '#9C5A5A', padding: '12px 18px',
  borderBottom: `1px solid ${colors.border}`,
};
const answerBtn = { background: '#fff', border: 'none', color: '#9C5A5A', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 8, cursor: 'pointer' };
const muteBtn   = { background: 'rgba(255,255,255,0.15)', border: 'none', fontSize: 15, padding: '8px 12px', borderRadius: 8, cursor: 'pointer' };