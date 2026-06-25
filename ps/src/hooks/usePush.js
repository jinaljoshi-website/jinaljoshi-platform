// ps/src/hooks/usePush.js
// Registers service worker and manages push subscription

import { useEffect, useState } from 'react';
import { api } from '../api';

// Convert VAPID public key from base64url to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

export function usePush() {
  const [supported,   setSupported]   = useState(false);
  const [subscribed,  setSubscribed]  = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);

    // Register service worker
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
      // Get VAPID public key
      const { publicKey } = await api.get('/api/push/vapid-public');

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to backend
      await api.post('/api/push/subscribe', sub.toJSON());
      setSubscribed(true);
    } catch (err) {
      console.error('Push subscribe error:', err);
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

  return { supported, subscribed, subscribing, subscribe, unsubscribe };
}