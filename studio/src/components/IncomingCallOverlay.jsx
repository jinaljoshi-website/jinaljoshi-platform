import { useEffect, useState } from 'react';
import { colors } from '../ui';
import { startRingtone, stopRingtone } from '../lib/ringtone';

const sans    = "'DM Sans', system-ui, sans-serif";
const display = "'Cormorant Garamond', Georgia, serif";
const mono    = "'DM Mono', 'Courier New', monospace";

export function IncomingCallOverlay({ call, onAnswer, onDecline, answering }) {
  const [secondsLeft, setSecondsLeft] = useState(null);

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
      <div style={{ fontSize: 56, marginBottom: 20 }}>🔴📞</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: '#D99A9A', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Priority call</div>
      <div style={{ fontFamily: display, fontSize: 32, color: colors.text, marginBottom: 8, textAlign: 'center' }}>
        {call.display_name || call.email} is calling
      </div>
      <div style={{ fontFamily: sans, fontSize: 14, color: colors.muted, marginBottom: 6, textTransform: 'capitalize' }}>{call.call_type} call · {call.coins_charged} tokens</div>
      {secondsLeft !== null && (
        <div style={{ fontFamily: mono, fontSize: 13, color: colors.accent, marginBottom: 40 }}>
          Answer within {secondsLeft}s
        </div>
      )}

      <div style={{ display: 'flex', gap: 20 }}>
        <button onClick={onAnswer} disabled={answering} style={answerBtn}>
          {answering ? 'Connecting…' : '✓ Answer'}
        </button>
        <button onClick={onDecline} style={declineBtn}>✕ Decline</button>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: 'rgba(13,12,10,0.97)', backdropFilter: 'blur(6px)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
};
const pulseRing = {
  position: 'absolute', width: 160, height: 160, borderRadius: '50%',
  border: `2px solid ${colors.accent}`, opacity: 0.4,
  animation: 'studio-pulse 1.6s ease-out infinite',
};
const answerBtn = {
  background: '#4CAF50', border: 'none', color: '#fff',
  fontFamily: sans, fontSize: 15, fontWeight: 700,
  padding: '14px 32px', borderRadius: 999, cursor: 'pointer',
};
const declineBtn = {
  background: '#9C5A5A', border: 'none', color: '#fff',
  fontFamily: sans, fontSize: 15, fontWeight: 700,
  padding: '14px 32px', borderRadius: 999, cursor: 'pointer',
};

if (typeof document !== 'undefined' && !document.getElementById('studio-pulse-keyframes')) {
  const style = document.createElement('style');
  style.id = 'studio-pulse-keyframes';
  style.textContent = `@keyframes studio-pulse { 0% { transform: scale(0.9); opacity: 0.5; } 70% { transform: scale(1.4); opacity: 0; } 100% { opacity: 0; } }`;
  document.head.appendChild(style);
}