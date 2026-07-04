// studio/public/sw.js
// Service worker for Studio push notifications

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Studio', body: event.data.text() }; }

  const options = {
    body:    data.body || '',
    icon:    data.icon  || '/wonder-coin-192.png',
    badge:   data.badge || '/wonder-coin-192.png',
    data:    { url: data.url || '/' },
    vibrate: data.vibrate || [200, 100, 200],
    requireInteraction: data.requireInteraction ?? true,
    tag:     data.tag || undefined,
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Personal Space Studio', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));