// ps/src/hooks/usePush.js
// Registers service worker and manages push subscription

import { useEffect, useState } from 'react';
import { api } from '../api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

let vapidKey = null;

export function usePush() {
  const [supported,   setSupported]   = useState(false);
  const [subscribed,  setSubscribed]  = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [permission,  setPermission]  = useState('default'); // 'default' | 'granted' | 'denied'

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    setSupported(true);
    setPermission(Notification.permission);

    if (!vapidKey) api.get('/api/push/vapid-public').then((d) => { vapidKey = d.publicKey; }).catch(() => {});

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
      });
    }).catch(console.error);
  }, []);

  const subscribe = async () => {
    if (!supported || subscribing) return;
    setSubscribing(true);
    try {
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;
      if (!vapidKey) {
        const d = await api.get('/api/push/vapid-public');
        vapidKey = d.publicKey;
      }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await api.post('/api/push/subscribe', sub.toJSON());
      setSubscribed(true);
      setPermission('granted');
    } catch (err) {
      console.error('Push subscribe error:', err);
      if ('Notification' in window) setPermission(Notification.permission);
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
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  };

  return { supported, subscribed, subscribing, permission, subscribe, unsubscribe };
}