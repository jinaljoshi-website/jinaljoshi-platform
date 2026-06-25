// studio/src/components/NotificationBell.jsx
// Jinal's push notification bell in the Studio

import { useEffect, useState } from 'react';
import { api } from '../api';
import { colors } from '../ui';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

export function StudioNotificationBell() {
  const [supported,   setSupported]   = useState(false);
  const [subscribed,  setSubscribed]  = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub));
    }).catch(console.error);
  }, []);

  const subscribe = async () => {
    if (!supported || subscribing) return;
    setSubscribing(true);
    try {
      const { publicKey } = await api.get('/api/push/vapid-public');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.post('/api/push/subscribe-artist', sub.toJSON());
      setSubscribed(true);
    } catch (err) {
      console.error('Studio push subscribe error:', err);
    } finally {
      setSubscribing(false);
    }
  };

  const unsubscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
        setSubscribed(false);
      }
    } catch (err) { console.error(err); }
  };

  if (!supported) return null;

  const sans = "'DM Sans', system-ui, sans-serif";

  return (
    <button
      onClick={subscribed ? unsubscribe : subscribe}
      disabled={subscribing}
      title={subscribed ? 'Notifications on — tap to disable' : 'Enable push notifications'}
      style={{
        background:   'transparent',
        border:       `1px solid ${subscribed ? 'rgba(193,125,74,0.4)' : colors.border}`,
        color:        subscribed ? colors.accent : colors.muted,
        borderRadius: 8,
        padding:      '7px 12px',
        cursor:       subscribing ? 'default' : 'pointer',
        fontFamily:   sans,
        fontSize:     15,
        opacity:      subscribing ? 0.6 : 1,
        display:      'flex',
        alignItems:   'center',
        gap:          6,
      }}
    >
      {subscribed ? '🔔' : '🔕'}
      <span style={{ fontSize: 11 }}>{subscribed ? 'On' : 'Off'}</span>
    </button>
  );
}