// studio/src/components/Broadcast.jsx
//
// One message to many members, addressed to each of them.
//
// The whole design rests on one thing: nothing is sent until it has been seen
// rendered for real people. A broadcast is the only action in Studio that
// reaches everybody at once and cannot be taken back — a message can be deleted
// from a thread, but not unread — so the preview is not a convenience here, it
// is the safety.
//
// The samples are real members rather than invented ones. A template that reads
// well for a made-up "Rahul, Premium, 23 days" and badly for an actual lapsed
// member is exactly the mistake this exists to catch, and it only shows up if
// the preview uses people who really exist.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const AUDIENCE_LABELS = {
  members:  'Active members',
  expiring: 'Expiring within 14 days',
  lapsed:   'Lapsed members',
  guests:   'Never subscribed',
  everyone: 'Everyone',
};

export default function Broadcast({ onClose }) {
  const [fields,   setFields]   = useState([]);
  const [audience, setAudience] = useState('members');
  const [tier,     setTier]     = useState('all');
  const [template, setTemplate] = useState('');
  const [preview,  setPreview]  = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');
  const [confirm,  setConfirm]  = useState('');

  useEffect(() => {
    api.get('/api/studio/broadcast/fields')
      .then((d) => setFields(d.fields || []))
      .catch((e) => setError(e.message));
  }, []);

  // Re-previewed whenever anything that affects it changes, so what is on
  // screen is always what would be sent. A stale preview is worse than none.
  useEffect(() => {
    if (!template.trim()) { setPreview(null); return; }
    setBusy(true);
    const id = setTimeout(() => {
      api.post('/api/studio/broadcast/preview', { template, audience, tier })
        .then(setPreview)
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }, 400);
    return () => clearTimeout(id);
  }, [template, audience, tier]);

  const insert = (key) => setTemplate((t) => `${t}{${key}}`);

  const send = async () => {
    setSending(true); setError('');
    try {
      const d = await api.post('/api/studio/broadcast/send', {
        template, audience, tier, alsoPush: true, confirm: 'SEND',
      });
      setResult(d);
      setTemplate('');
      setConfirm('');
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };

  const unknown  = preview?.unknownFields || [];
  const count    = preview?.recipients ?? 0;
  const canSend  = template.trim() && count > 0 && !unknown.length && confirm === 'SEND';

  if (result) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <T.sectionTitle>Sent</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>
          {result.sent} delivered{result.failed ? `, ${result.failed} failed` : ''}.
        </p>
        <button onClick={() => { setResult(null); onClose?.(); }} style={S.ghostBtn}>Close</button>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <T.sectionTitle>Message everyone</T.sectionTitle>
        <button onClick={onClose} style={{ ...S.ghostBtn, fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}>Close</button>
      </div>
      <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 14, lineHeight: 1.6 }}>
        Lands in each member's chat as a message from you, and sends a push. Never charged.
      </p>

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(AUDIENCE_LABELS).map(([k, label]) => (
          <button key={k} onClick={() => setAudience(k)}
                  style={{ ...pill, ...(audience === k ? pillOn : {}) }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {['all', 'community', 'insider', 'premium', 'supreme'].map((t) => (
          <button key={t} onClick={() => setTier(t)}
                  style={{ ...pill, fontSize: 10, ...(tier === t ? pillOn : {}) }}>
            {t === 'all' ? 'Any tier' : t}
          </button>
        ))}
      </div>

      <textarea value={template} onChange={(e) => setTemplate(e.target.value)}
                placeholder="Hi {name}, something new is up in the gallery…"
                style={{ ...S.input, minHeight: 110, resize: 'vertical', width: '100%' }} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 4px' }}>
        {fields.map((f) => (
          <button key={f.key} onClick={() => insert(f.key)} title={`e.g. ${f.example}`}
                  style={{ ...pill, fontFamily: mono, fontSize: 10 }}>
            {'{' + f.key + '}'}
          </button>
        ))}
      </div>

      {unknown.length > 0 && (
        <div style={{ ...S.error, marginTop: 10 }}>
          Not a real field: {unknown.map((u) => `{${u}}`).join(', ')} — it will be sent exactly as written.
        </div>
      )}

      {template.trim() && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.muted, marginBottom: 8 }}>
            {busy ? 'Checking…' : `${count} ${count === 1 ? 'member' : 'members'} · as they will read it`}
          </div>
          {(preview?.samples || []).map((s, i) => (
            <div key={i} style={sample}>
              <div style={{ fontFamily: mono, fontSize: 9, color: colors.muted, marginBottom: 4 }}>{s.to}</div>
              <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, lineHeight: 1.6 }}>{s.text}</div>
            </div>
          ))}
          {count === 0 && !busy && <T.muted>Nobody matches this audience.</T.muted>}
        </div>
      )}

      {count > 0 && !unknown.length && template.trim() && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Typed rather than clicked. This reaches everybody at once and
              cannot be undone, and a button alone is one slip away from that. */}
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
                 placeholder="Type SEND to confirm"
                 style={{ ...S.input, width: 180, fontFamily: mono, fontSize: 12 }} />
          <button onClick={send} disabled={!canSend || sending}
                  style={{ ...S.btn, opacity: (!canSend || sending) ? 0.4 : 1 }}>
            {sending ? `Sending to ${count}…` : `Send to ${count}`}
          </button>
        </div>
      )}
    </Card>
  );
}

const pill   = { fontFamily: sans, fontSize: 11, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted };
const pillOn = { color: colors.accent, borderColor: colors.accent };
const sample = { border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: 'rgba(255,255,255,0.02)' };