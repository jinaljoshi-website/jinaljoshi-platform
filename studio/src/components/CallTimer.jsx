import { useEffect, useState } from 'react';

export function CallTimer({ callStartedAt, durationMinutes, onExpire }) {
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

  const sans = "'DM Sans', system-ui, sans-serif";
  const mono = "'DM Mono', 'Courier New', monospace";

  if (!callStartedAt) {
    return (
      <div style={{ fontFamily: sans, fontSize: 13, color: '#9B8F83', padding: '8px 16px', borderRadius: 8, background: 'rgba(13,12,10,0.85)', textAlign: 'center' }}>
        Waiting for the fan to join…
      </div>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining <= 60;

  return (
    <div style={{
      fontFamily: mono, fontSize: 14, fontWeight: 700,
      padding: '8px 16px', borderRadius: 8,
      border: `1px solid ${isLow ? 'rgba(156,90,90,0.4)' : 'rgba(242,235,224,0.15)'}`,
      background: 'rgba(13,12,10,0.85)',
      color: isLow ? '#D99A9A' : '#F2EBE0',
      textAlign: 'center', letterSpacing: '0.04em',
    }}>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} remaining
    </div>
  );
}