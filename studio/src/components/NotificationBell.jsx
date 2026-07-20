// studio/src/components/NotificationBell.jsx
// Jinal's push notification bell in the Studio

import { useEffect, useRef, useState } from 'react';
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
  const [error,       setError]       = useState('');
  const vapidKeyRef = useRef(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);

    // Fetch the VAPID key ahead of time, on mount — NOT inside the click handler.
    // Safari is strict about tying pushManager.subscribe() directly to the user's
    // click with no delay in between; an awaited network call first can cause it
    // to silently treat the gesture as expired and fail the subscription.
    api.get('/api/push/vapid-public').then((d) => { vapidKeyRef.current = d.publicKey; }).catch(() => {});

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub));
    }).catch(console.error);
  }, []);

  const subscribe = async () => {
    if (!supported || subscribing) return;
    setError('');
    setSubscribing(true);
    try {
      if (!vapidKeyRef.current) {
        const d = await api.get('/api/push/vapid-public');
        vapidKeyRef.current = d.publicKey;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKeyRef.current),
      });
      await api.post('/api/push/subscribe-artist', sub.toJSON());
      setSubscribed(true);
    } catch (err) {
      console.error('Studio push subscribe error:', err);
      setError(err.message || 'Could not enable notifications — check Safari\'s notification permission for this site.');
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
    <div style={{ position: 'relative' }}>
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
      {error && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 240, background: '#1A1714', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', fontFamily: sans, fontSize: 11, padding: 10, borderRadius: 8, zIndex: 50, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}