import { useEffect, useState } from 'react';
import { C, F } from '../tokens';

export default function CallTimer({ callStartedAt, durationMinutes, onExpire }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!callStartedAt) {
      setRemaining(null);
      return;
    }

    const startMs    = new Date(callStartedAt).getTime();
    const durationMs = durationMinutes * 60 * 1000;

    const tick = () => {
      const elapsed = Date.now() - startMs;
      const left    = Math.max(0, durationMs - elapsed);
      setRemaining(Math.floor(left / 1000));
      if (left <= 0) {
        onExpire?.();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [callStartedAt, durationMinutes, onExpire]);

  if (!callStartedAt) {
    return (
      <div style={waitingStyle}>
        Waiting for both of you to join…
      </div>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining <= 60;

  return (
    <div style={{ ...timerStyle, color: isLow ? '#D99A9A' : C.text, borderColor: isLow ? 'rgba(156,90,90,0.4)' : 'rgba(242,235,224,0.15)' }}>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} remaining
    </div>
  );
}

const timerStyle = {
  fontFamily: F.mono,
  fontSize: 14,
  fontWeight: 700,
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid',
  background: 'rgba(13,12,10,0.85)',
  textAlign: 'center',
  letterSpacing: '0.04em',
};

const waitingStyle = {
  fontFamily: F.sans,
  fontSize: 13,
  color: '#9B8F83',
  padding: '8px 16px',
  borderRadius: 8,
  background: 'rgba(13,12,10,0.85)',
  textAlign: 'center',
};