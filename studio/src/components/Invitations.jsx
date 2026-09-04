// studio/src/components/Invitations.jsx
//
// An email with a membership already waiting for it.
//
// For somebody who supported the work before there was a platform and paid for
// it some other way — through Wise, or Instagram, or a bank transfer nobody
// wrote a receipt for at the time. The money is real; what is missing is a
// place for it to land, because every membership here comes from a purchase
// made on the site.
//
// The address is approved and nothing else. They still register themselves, so
// they still agree to the terms and the no-refund condition in the ordinary
// way, and that record stays honest. Signup finds the invitation and applies
// it.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const TIERS = ['community', 'insider', 'premium', 'supreme'];

export default function Invitations() {
  const [list,   setList]   = useState(null);
  const [adding, setAdding] = useState(false);
  const [form,   setForm]   = useState({ email: '', tier: 'supreme', months: '', reason: '' });
  const [error,  setError]  = useState('');
  const [busy,   setBusy]   = useState(false);

  const load = () => api.get('/api/studio/invitations')
    .then((d) => setList(d.invitations || []))
    .catch(() => setList([]));

  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/api/studio/invitations', form);
      setForm({ email: '', tier: 'supreme', months: '', reason: '' });
      setAdding(false);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const withdraw = async (email) => {
    try {
      await api.delete(`/api/studio/invitations/${encodeURIComponent(email)}`);
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em',
                        textTransform: 'uppercase', color: colors.muted }}>
            Waiting to be claimed
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 4, maxWidth: 520, lineHeight: 1.6 }}>
            An address approved for a membership before it registers. They sign up
            as anybody does and it applies itself.
          </div>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
            Invite someone
          </button>
        )}
      </div>

      {error && (
        <div style={{ fontFamily: sans, fontSize: 12, color: '#D99A9A', marginTop: 12 }}>{error}</div>
      )}

      {adding && (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <input style={S.input} autoFocus type="email" placeholder="their@email.com"
                 value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select style={{ ...S.input, width: 'auto' }} value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value })}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input style={{ ...S.input, width: 200 }} type="number" min={1}
                   placeholder="Months — empty for life"
                   value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
          </div>

          {/* Required, and it stays on the record. An account carrying years of
              Supreme with no payment behind it will be asked about, possibly by
              a payment provider, possibly long after anybody remembers why. */}
          <input style={S.input} placeholder="Why — supported the work before the platform, paid via Wise…"
                 value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={create} disabled={busy || !form.email.trim() || !form.reason.trim()}
                    style={{ ...S.btn, fontSize: 12, padding: '7px 16px',
                             opacity: (form.email.trim() && form.reason.trim()) ? 1 : 0.5 }}>
              {busy ? 'Saving…' : 'Invite'}
            </button>
            <button onClick={() => { setAdding(false); setError(''); }}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {list && list.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          {list.map((i) => (
            <div key={i.email} style={{ display: 'flex', justifyContent: 'space-between',
                                        alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                        padding: '9px 0', borderTop: `1px solid ${colors.border}` }}>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                  {i.email}
                  {i.claimed_at && (
                    <span style={{ fontFamily: mono, fontSize: 10, color: colors.success, marginLeft: 8 }}>
                      claimed{i.claimed_name ? ` · ${i.claimed_name}` : ''}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                  {i.tier} · {i.months ? `${i.months} months` : 'for as long as the account exists'}
                  {' · '}{i.reason}
                </div>
              </div>
              {!i.claimed_at && (
                <button onClick={() => withdraw(i.email)}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                  Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}