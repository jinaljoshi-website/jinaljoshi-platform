import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { startRingtone, stopRingtone } from '../lib/ringtone';

export default function IncomingCallOverlay({ call, onAnswer, onDecline, answering }) {
  const [secondsLeft, setSecondsLeft] = useState(null);

  const isWaitingForJinal = !call.artist_joined_at; // priority call, Jinal hasn't answered yet
  const title = isWaitingForJinal ? 'Calling Jinal…' : 'Jinal is calling you';

  useEffect(() => {
    startRingtone();
    return () => stopRingtone();
  }, []);

  useEffect(() => {
    if (!call.ring_expires_at) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(call.ring_expires_at) - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call.ring_expires_at]);

  return (
    <div style={overlay}>
      <div style={pulseRing} />
      <div style={{ fontSize: 56, marginBottom: 20 }}>{isWaitingForJinal ? '📞' : '☎️'}</div>
      <div style={{ fontFamily: F.display, fontSize: 32, color: C.text, marginBottom: 8, textAlign: 'center' }}>{title}</div>
      <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, marginBottom: 6, textTransform: 'capitalize' }}>{call.call_type} call</div>
      {secondsLeft !== null && (
        <div style={{ fontFamily: F.mono, fontSize: 13, color: C.accent, marginBottom: 40 }}>
          {isWaitingForJinal ? `Ringing… ${secondsLeft}s` : `Answer within ${secondsLeft}s`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20 }}>
        {!isWaitingForJinal && (
          <button onClick={onAnswer} disabled={answering} style={answerBtn}>
            {answering ? 'Connecting…' : '✓ Answer'}
          </button>
        )}
        <button onClick={onDecline} style={declineBtn}>
          {isWaitingForJinal ? '✕ Cancel' : '✕ Decline'}
        </button>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: 'rgba(10,9,8,0.97)', backdropFilter: 'blur(6px)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
};
const pulseRing = {
  position: 'absolute', width: 160, height: 160, borderRadius: '50%',
  border: `2px solid ${C.accent}`, opacity: 0.4,
  animation: 'ps-pulse 1.6s ease-out infinite',
};
const answerBtn = {
  background: '#4CAF50', border: 'none', color: '#fff',
  fontFamily: F.sans, fontSize: 15, fontWeight: 700,
  padding: '14px 32px', borderRadius: 999, cursor: 'pointer',
};
const declineBtn = {
  background: '#9C5A5A', border: 'none', color: '#fff',
  fontFamily: F.sans, fontSize: 15, fontWeight: 700,
  padding: '14px 32px', borderRadius: 999, cursor: 'pointer',
};

// Inject the pulse keyframe once
if (typeof document !== 'undefined' && !document.getElementById('ps-pulse-keyframes')) {
  const style = document.createElement('style');
  style.id = 'ps-pulse-keyframes';
  style.textContent = `@keyframes ps-pulse { 0% { transform: scale(0.9); opacity: 0.5; } 70% { transform: scale(1.4); opacity: 0; } 100% { opacity: 0; } }`;
  document.head.appendChild(style);
}