// studio/src/sections/Notifications.jsx
import { useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';

export function Notifications() {
  const [form,    setForm]    = useState({ title: '', body: '', url: '', userId: '' });
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  const handleSend = async (toAll) => {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and message are required.');
      return;
    }
    setError(''); setResult(null); setSending(true);
    try {
      const payload = {
        title: form.title.trim(),
        body:  form.body.trim(),
        url:   form.url.trim() || '/',
      };
      if (!toAll && form.userId.trim()) {
        payload.userId = form.userId.trim();
      }
      const data = await api.post('/api/push/send', payload);
      setResult(data);
      if (data.sent > 0) {
        setForm({ title: '', body: '', url: '', userId: '' });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <Eyebrow>Notifications</Eyebrow>
      <T.title>Push notifications</T.title>

      <Card style={{ marginBottom: 24 }}>
        <T.sectionTitle>Send a notification</T.sectionTitle>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, marginBottom: 20, lineHeight: 1.7 }}>
          Notifications appear on fans' phones and computers if they have enabled them on the PS platform.
          Leave "Send to specific user" blank to send to everyone.
        </p>

        {error  && <div style={S.error}>{error}</div>}
        {result && (
          <div style={S.success}>
            ✓ Sent to {result.sent} subscriber{result.sent !== 1 ? 's' : ''}.
            {result.failed > 0 && ` ${result.failed} failed.`}
            {result.expiredRemoved > 0 && ` ${result.expiredRemoved} expired subscriptions cleaned up.`}
          </div>
        )}

        <div style={S.formGrid}>
          <Field label="Notification title">
            <input
              style={S.input}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. New content just dropped! 🎬"
            />
          </Field>
          <Field label="Send to specific user ID (optional — leave blank for all)">
            <input
              style={S.input}
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              placeholder="User UUID or leave blank for all subscribers"
            />
          </Field>
          <Field label="Message">
            <input
              style={S.input}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="e.g. A new behind-the-scenes set is live. Check it out!"
            />
          </Field>
          <Field label="Link URL (optional — where to open on tap)">
            <input
              style={S.input}
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="/platform/gallery"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => handleSend(true)}
            disabled={sending || !form.title.trim() || !form.body.trim()}
            style={{ ...S.btn, opacity: (sending || !form.title.trim() || !form.body.trim()) ? 0.5 : 1 }}
          >
            {sending ? 'Sending…' : 'Send to all subscribers'}
          </button>
          {form.userId.trim() && (
            <button
              onClick={() => handleSend(false)}
              disabled={sending}
              style={{ ...S.ghostBtn, opacity: sending ? 0.5 : 1 }}
            >
              Send to this user only
            </button>
          )}
        </div>
      </Card>

      <Card>
        <T.sectionTitle>How notifications work</T.sectionTitle>
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, lineHeight: 1.8 }}>
          <p>Fans see a 🔔 bell button in their platform top bar. Tapping it asks for permission and enables notifications on their device.</p>
          <p>Once enabled, they receive a notification when you send one here. Tapping the notification opens the platform at the link you specify.</p>
          <p>Notifications work on both desktop and mobile — on iOS, fans need to add the app to their home screen first (PWA install) for push notifications to work.</p>
          <p style={{ marginBottom: 0 }}>Subscribers who have uninstalled or revoked permission are automatically cleaned up when a send is attempted.</p>
        </div>
      </Card>
    </div>
  );
}