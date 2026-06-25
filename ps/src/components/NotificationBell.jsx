// ps/src/components/NotificationBell.jsx
// Shows in the platform top bar — lets users enable push notifications

import { C, F } from '../tokens';
import { usePush } from '../hooks/usePush';

export default function NotificationBell() {
  const { supported, subscribed, subscribing, subscribe, unsubscribe } = usePush();

  if (!supported) return null;

  return (
    <button
      onClick={subscribed ? unsubscribe : subscribe}
      disabled={subscribing}
      title={subscribed ? 'Notifications on — tap to turn off' : 'Turn on notifications'}
      style={{
        background:   'transparent',
        border:       `1px solid ${subscribed ? 'rgba(193,125,74,0.4)' : C.border}`,
        color:        subscribed ? C.accent : C.muted,
        borderRadius: 8,
        padding:      '8px 12px',
        cursor:       subscribing ? 'default' : 'pointer',
        fontFamily:   F.sans,
        fontSize:     16,
        opacity:      subscribing ? 0.6 : 1,
        display:      'flex',
        alignItems:   'center',
        gap:          6,
      }}
    >
      {subscribed ? '🔔' : '🔕'}
    </button>
  );
}