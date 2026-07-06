import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { usePush } from '../hooks/usePush';

const DISMISS_KEY = 'notif_nudge_dismissed_at';
const REPROMPT_HOURS = 12; // how long to wait before nudging again after a dismiss

export default function NotificationNudge({ forceShow = false }) {
  const { supported, subscribed, subscribing, permission, subscribe } = usePush();
  const [visible, setVisible] = useState(false);
  const [justDenied, setJustDenied] = useState(false);

  useEffect(() => {
    if (!supported || subscribed) { setVisible(false); return; }

    if (forceShow) { setVisible(true); return; }

    const lastDismissed = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    const hoursSince = (Date.now() - lastDismissed) / (1000 * 60 * 60);
    setVisible(hoursSince >= REPROMPT_HOURS);
  }, [supported, subscribed, forceShow]);

  if (!visible || !supported || subscribed) return null;

  const handleEnable = async () => {
    await subscribe();
    // If the browser immediately reports 'denied' right after attempting, show the manual-fix instructions instead
    if (Notification.permission === 'denied') setJustDenied(true);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const isBlocked = permission === 'denied' || justDenied;

  return (
    <div style={wrap}>
      {isBlocked ? (
        <>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text, marginBottom: 6, fontWeight: 600 }}>
            Notifications are currently blocked
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
            You won't be alerted for calls, replies, or unlocks. To fix this: tap the 🔒 or ⓘ icon next to the address bar → Notifications → Allow, then refresh this page.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text, marginBottom: 6, fontWeight: 600 }}>
            Never miss a call or reply
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
            Turn on notifications so you know the moment Jinal replies, calls, or drops new content.
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {!isBlocked && (
          <button onClick={handleEnable} disabled={subscribing} style={{ ...enableBtn, opacity: subscribing ? 0.6 : 1 }}>
            {subscribing ? 'Requesting…' : 'Turn on notifications'}
          </button>
        )}
        <button onClick={handleDismiss} style={dismissBtn}>
          {isBlocked ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

const wrap = {
  background: 'rgba(193,125,74,0.06)',
  border: `1px solid rgba(193,125,74,0.2)`,
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 16,
};
const enableBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };
const dismissBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' };