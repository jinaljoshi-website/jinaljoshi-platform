// ps/src/pages/Notices.jsx
//
// Everything the platform has told you, kept.
//
// A push notification arrived on a phone or it did not, and either way it was
// gone. Somebody who missed one, or never granted permission, or read it on a
// bus and wanted it again, had nowhere to look.
//
// And once emails can be turned off, turning them off should cost you the
// delivery rather than the message. Every letter is written here whether or not
// it was sent, so choosing not to be emailed is safe.
//
// Nothing on this page rings anything. It is a record, not a channel.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { C, F } from '../tokens';

export default function Notices() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/notices')
      .then((d) => {
        setList(d.notices || []);
        // Opening the page is the act of reading them. Making somebody tap each
        // one to clear a badge is a chore invented by the badge.
        if (d.unread > 0) api.post('/api/notices/read', {}).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.12em',
                      textTransform: 'uppercase', color: C.accent, marginBottom: 8 }}>
          Notices
        </div>
        <h1 style={{ fontFamily: F.display, fontSize: 'clamp(26px,4vw,34px)', color: C.text, margin: '0 0 10px' }}>
          Everything I have told you
        </h1>
        <p style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 520, margin: 0 }}>
          Every note, reminder and letter, kept here whether or not it reached
          your inbox. If you have turned emails off, they still arrive on this
          page.
        </p>
      </div>

      {error && (
        <div style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A', marginBottom: 16 }}>{error}</div>
      )}

      {!list && <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>Loading…</div>}

      {list && list.length === 0 && (
        <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
          Nothing yet. When there is something worth telling you, it will be here.
        </div>
      )}

      {list && list.length > 0 && (
        <div style={{ display: 'grid', gap: 2 }}>
          {list.map((n) => (
            <div key={n.id}
                 onClick={() => n.url && navigate(n.url)}
                 style={{ padding: '14px 0', borderBottom: `1px solid ${C.border}`,
                          cursor: n.url ? 'pointer' : 'default',
                          opacity: n.read_at ? 0.72 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontFamily: F.sans, fontSize: 15, color: C.text, fontWeight: n.read_at ? 400 : 500 }}>
                  {n.title}
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>
                  {when(n.created_at)}
                </div>
              </div>

              {n.body && (
                <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginTop: 5 }}>
                  {n.body}
                </div>
              )}

              {/* Said quietly, and only when it means something. A letter that
                  was written but never sent is the case somebody might wonder
                  about, so that is the one worth naming. */}
              {n.delivered?.includes('email') && (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginTop: 6 }}>
                  also emailed to you
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Recent things in words, older things by date. "3 days ago" stops being useful
// somewhere around a fortnight, when what you actually want is the date.
function when(at) {
  const d = new Date(at);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 20160) return `${Math.floor(mins / 1440)}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}