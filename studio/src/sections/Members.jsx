// studio/src/sections/Members.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

function isCurrentlyBlocked(blockedUntil) {
  return blockedUntil && new Date(blockedUntil) > new Date();
}

export function Members() {
  const [fans,      setFans]      = useState([]);
  const [tokenRate, setTokenRate] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  // Per-fan panels — only one open at a time, keyed by fan id
  const [panel,     setPanel]     = useState(null);   // { fanId, kind: 'tokens' | 'membership' }
  const [amount,    setAmount]    = useState('');
  const [reason,    setReason]    = useState('');
  const [tier,      setTier]      = useState('community');
  const [term,      setTerm]      = useState('monthly');
  const [note,      setNote]      = useState('');
  const [busy,      setBusy]      = useState(false);
  const [conflict,  setConflict]  = useState(null);

  // Moderation
  const [mutingId,    setMutingId]    = useState(null);
  const [blockingId,  setBlockingId]  = useState(null);
  const [blockReason, setBlockReason] = useState('');

  const [modLog,  setModLog]  = useState([]);
  const [showLog, setShowLog] = useState(false);

  const loadFans   = () => api.get('/api/studio/fans').then((d) => setFans(d.fans || []));
  const loadModLog = () => api.get('/api/studio/moderation-log').then((d) => setModLog(d.log || [])).catch(() => {});

  useEffect(() => {
    Promise.all([
      loadFans(),
      api.get('/api/studio/config').then((d) => {
        const r = parseFloat(d.config?.token_rate_inr);
        if (!Number.isNaN(r)) setTokenRate(r);
      }),
    ]).finally(() => setLoading(false));
    loadModLog();
  }, []);

  const openPanel = (fanId, kind) => {
    setPanel({ fanId, kind });
    setAmount(''); setReason(''); setNote(''); setConflict(null);
    setError(''); setSuccess('');
  };
  const closePanel = () => { setPanel(null); setConflict(null); };

  const giftTokens = async (fan) => {
    setError(''); setSuccess(''); setBusy(true);
    try {
      const data = await api.post('/api/studio/grant-tokens', {
        email:  fan.email,
        amount: parseInt(amount),
        reason: reason.trim() || 'Token gift from Jinal',
      });
      setSuccess(data.message);
      closePanel();
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const giftMembership = async (fan, action = 'gift') => {
    setError(''); setSuccess(''); setConflict(null); setBusy(true);
    try {
      const endpoint = action === 'extend' ? '/api/membership/gift/extend'
                     : action === 'change' ? '/api/membership/gift/change'
                     : '/api/membership/gift';
      const body = action === 'extend' ? { email: fan.email, term } : { email: fan.email, tier, term, note };
      const data = await api.post(endpoint, body);
      setSuccess(data.message || 'Done.');
      closePanel();
      loadFans();
    } catch (err) {
      if (err.message === 'ALREADY_MEMBER') setConflict(fan.id);
      else setError(err.message);
    } finally { setBusy(false); }
  };

  const toggleMute = async (fanId, currentlyMuted) => {
    setError(''); setSuccess(''); setMutingId(fanId);
    try {
      await api.post(`/api/studio/fan-settings/${fanId}/mute`, { muted: !currentlyMuted });
      loadFans(); loadModLog();
    } catch (err) { setError(err.message); } finally { setMutingId(null); }
  };

  const confirmBlock = async (fanId) => {
    setError('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fanId}/block`, { reason: blockReason.trim() || undefined });
      setSuccess(data.message);
      setBlockingId(null); setBlockReason('');
      loadFans(); loadModLog();
    } catch (err) { setError(err.message); }
  };

  const unblock = async (fanId) => {
    setError(''); setSuccess('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fanId}/unblock`, {});
      setSuccess(data.message);
      loadFans(); loadModLog();
    } catch (err) { setError(err.message); }
  };

  if (loading) return <T.muted>Loading members…</T.muted>;

  return (
    <div>
      <Eyebrow>Members</Eyebrow>
      <T.title>Fan management</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, lineHeight: 1.7, marginBottom: 20, maxWidth: 760 }}>
        Gifted tokens can be spent on messages and content only, and expire after 30 days.
        They cannot be used for merchandise, outfits, calls or membership — gift a membership
        directly if that is what you mean to give.
      </p>

      <T.sectionTitle>All fans ({fans.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 8, marginBottom: 32 }}>
        {fans.map((fan) => {
          const isActive  = fan.membership_expires_at && new Date(fan.membership_expires_at) > new Date();
          const isBlocked = isCurrentlyBlocked(fan.blocked_until);
          const openHere  = panel?.fanId === fan.id;

          return (
            <div key={fan.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={S.rowTitle}>{fan.display_name || fan.email.split('@')[0]}</div>
                  <div style={{ ...S.rowSub, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{fan.email}</div>
                  <div style={{ ...S.rowSub, marginTop: 4 }}>
                    Joined {new Date(fan.created_at).toLocaleDateString()} · {fan.coin_balance} purchased
                    {fan.gifted_balance > 0 && (
                      <span style={{ color: '#8FC88F' }}>
                        {' '}· {fan.gifted_balance} gifted
                        {fan.gifted_expires_at && ` (to ${new Date(fan.gifted_expires_at).toLocaleDateString()})`}
                      </span>
                    )}
                    {isActive && ` · expires ${new Date(fan.membership_expires_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {fan.is_muted && <span style={mutedPill}>Muted</span>}
                  {isBlocked && <span style={blockedPill}>Blocked until {new Date(fan.blocked_until).toLocaleString()}</span>}
                  <Badge tier={isActive ? fan.tier : 'guest'} />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                <button onClick={() => openHere && panel.kind === 'tokens' ? closePanel() : openPanel(fan.id, 'tokens')}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#8FC88F' }}>
                  Gift tokens
                </button>
                <button onClick={() => openHere && panel.kind === 'membership' ? closePanel() : openPanel(fan.id, 'membership')}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: colors.accent }}>
                  {isActive ? 'Extend or change membership' : 'Gift membership'}
                </button>

                <button onClick={() => toggleMute(fan.id, fan.is_muted)} disabled={mutingId === fan.id}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', opacity: mutingId === fan.id ? 0.5 : 1 }}>
                  {mutingId === fan.id ? '…' : fan.is_muted ? 'Unmute' : 'Mute chat & calls'}
                </button>

                {isBlocked ? (
                  <button onClick={() => unblock(fan.id)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#8FC88F' }}>
                    Lift restriction
                  </button>
                ) : blockingId === fan.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
                           placeholder="Reason (internal, optional)"
                           style={{ ...S.input, width: 200, padding: '5px 10px', fontSize: 11 }} />
                    <button onClick={() => confirmBlock(fan.id)} style={{ ...S.btn, fontSize: 11, padding: '5px 10px', background: '#9C5A5A', border: 'none' }}>
                      Confirm restriction
                    </button>
                    <button onClick={() => { setBlockingId(null); setBlockReason(''); }} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setBlockingId(fan.id); setBlockReason(''); }}
                          style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>
                    Restrict account {fan.block_count > 0 && `(offense #${fan.block_count + 1})`}
                  </button>
                )}
              </div>

              {/* Gift tokens panel */}
              {openHere && panel.kind === 'tokens' && (
                <div style={panelBox}>
                  <div style={panelTitle}>Gift tokens to {fan.display_name || fan.email}</div>
                  <div style={S.formGrid}>
                    {tokenRate === null ? (
                      <Field label="Amount"><input style={S.input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 10" /></Field>
                    ) : (
                      <TokenField label="Amount" value={amount} onChange={setAmount} tokenRateInr={tokenRate} />
                    )}
                    <Field label="Reason (shown in their history)">
                      <input style={S.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Welcome gift" />
                    </Field>
                    <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
                      <button onClick={() => giftTokens(fan)} disabled={busy || !amount}
                              style={{ ...S.btn, opacity: (busy || !amount) ? 0.5 : 1 }}>
                        {busy ? 'Sending…' : 'Send gift'}
                      </button>
                      <button onClick={closePanel} style={S.ghostBtn}>Cancel</button>
                    </div>
                  </div>
                  <div style={panelNote}>Expires 30 days from now · messages and content only</div>
                </div>
              )}

              {/* Gift membership panel */}
              {openHere && panel.kind === 'membership' && (
                <div style={panelBox}>
                  <div style={panelTitle}>
                    {isActive ? `Change or extend ${fan.display_name || fan.email}'s membership` : `Gift a membership to ${fan.display_name || fan.email}`}
                  </div>
                  {conflict === fan.id ? (
                    <div>
                      <div style={S.error}>This fan already has an active membership.</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                        <button onClick={() => giftMembership(fan, 'extend')} style={S.btn}>Add {term} to their membership</button>
                        <button onClick={() => giftMembership(fan, 'change')} style={S.ghostBtn}>Change tier to {tier}</button>
                        <button onClick={closePanel} style={S.ghostBtn}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={S.formGrid}>
                        <Field label="Tier">
                          <select style={S.input} value={tier} onChange={(e) => setTier(e.target.value)}>
                            <option value="community">Community</option>
                            <option value="insider">Insider</option>
                            <option value="premium">Premium</option>
                            <option value="supreme">Supreme</option>
                          </select>
                        </Field>
                        <Field label="Duration">
                          <select style={S.input} value={term} onChange={(e) => setTerm(e.target.value)}>
                            <option value="monthly">1 month</option>
                            <option value="quarterly">3 months</option>
                            <option value="annual">12 months</option>
                          </select>
                        </Field>
                        <Field label="Note (internal, optional)">
                          <input style={S.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this was gifted" />
                        </Field>
                        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
                          <button onClick={() => giftMembership(fan, isActive ? 'extend' : 'gift')} disabled={busy}
                                  style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
                            {busy ? 'Working…' : isActive ? `Add ${term}` : 'Gift membership'}
                          </button>
                          {isActive && (
                            <button onClick={() => giftMembership(fan, 'change')} disabled={busy} style={S.ghostBtn}>
                              Change tier to {tier}
                            </button>
                          )}
                          <button onClick={closePanel} style={S.ghostBtn}>Cancel</button>
                        </div>
                      </div>
                      <div style={panelNote}>Gifted memberships cost the fan nothing and do not auto-renew.</div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Moderation history */}
      <div>
        <button onClick={() => setShowLog((v) => !v)} style={{ ...S.ghostBtn, fontSize: 13, padding: '8px 14px', marginBottom: showLog ? 12 : 0 }}>
          {showLog ? 'Hide' : 'Show'} moderation history ({modLog.length})
        </button>
        {showLog && (
          <div style={{ display: 'grid', gap: 6 }}>
            {modLog.length === 0 && <T.muted>No moderation actions logged yet.</T.muted>}
            {modLog.map((entry) => (
              <div key={entry.id} style={{ ...S.card, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                    <strong style={{ textTransform: 'capitalize' }}>{entry.action_type.replace(/_/g, ' ')}</strong>
                    {entry.display_name || entry.email ? ` — ${entry.display_name || entry.email}` : ''}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: colors.muted }}>
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
                {entry.reason && (
                  <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 4, fontStyle: 'italic' }}>
                    "{entry.reason}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const mutedPill   = { fontFamily: sans, fontSize: 10, color: '#D9A45C', background: 'rgba(217,164,92,0.1)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 999, padding: '3px 8px' };
const blockedPill = { fontFamily: sans, fontSize: 10, color: '#D99A9A', background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', borderRadius: 999, padding: '3px 8px' };
const panelBox    = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, marginTop: 4 };
const panelTitle  = { fontFamily: sans, fontSize: 13, color: colors.text, marginBottom: 12, fontWeight: 600 };
const panelNote   = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 10, fontStyle: 'italic' };