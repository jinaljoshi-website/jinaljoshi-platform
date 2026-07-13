// studio/src/sections/Members.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';

const TOKEN_RATE = 66;
const sans = "'DM Sans', system-ui, sans-serif";

function isCurrentlyBlocked(blockedUntil) {
  return blockedUntil && new Date(blockedUntil) > new Date();
}

export function Members() {
  const [fans,     setFans]     = useState([]);
  const [loading,  setLoading]  = useState(true);

  // Gift membership
  const [email,    setEmail]    = useState('');
  const [tier,     setTier]     = useState('community');
  const [term,     setTerm]     = useState('monthly');
  const [note,     setNote]     = useState('');
  const [gifting,  setGifting]  = useState(false);
  const [conflict, setConflict] = useState(null);

  // Token grant
  const [grantEmail,  setGrantEmail]  = useState('');
  const [grantAmt,    setGrantAmt]    = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [granting,    setGranting]    = useState(false);

  // Moderation
  const [mutingId,    setMutingId]    = useState(null);
  const [blockingId,  setBlockingId]  = useState(null); // fan id currently showing the block-reason input
  const [blockReason, setBlockReason] = useState('');

  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const loadFans = () => api.get('/api/studio/fans').then((d) => setFans(d.fans || []));

  useEffect(() => {
    loadFans().finally(() => setLoading(false));
  }, []);

  const handleGift = async (action = 'gift') => {
    setError(''); setSuccess(''); setConflict(null); setGifting(true);
    try {
      const endpoint = action === 'extend' ? '/api/membership/gift/extend'
                     : action === 'change'  ? '/api/membership/gift/change'
                     : '/api/membership/gift';
      const body = action === 'extend' ? { email, term } : { email, tier, term, note };
      const data = await api.post(endpoint, body);
      setSuccess(data.message || 'Done.');
      setEmail(''); setNote('');
      loadFans();
    } catch (err) {
      if (err.message === 'ALREADY_MEMBER') setConflict({ email });
      else setError(err.message);
    } finally {
      setGifting(false);
    }
  };

  const handleGrantTokens = async () => {
    setError(''); setSuccess(''); setGranting(true);
    try {
      const data = await api.post('/api/studio/grant-tokens', {
        email:  grantEmail.toLowerCase().trim(),
        amount: parseInt(grantAmt),
        reason: grantReason || 'Token grant from Jinal',
      });
      setSuccess(data.message);
      setGrantEmail(''); setGrantAmt(''); setGrantReason('');
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setGranting(false);
    }
  };

  const toggleMute = async (fanId, currentlyMuted) => {
    setError(''); setSuccess('');
    setMutingId(fanId);
    try {
      await api.post(`/api/studio/fan-settings/${fanId}/mute`, { muted: !currentlyMuted });
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setMutingId(null);
    }
  };

  const startBlock = (fanId) => { setBlockingId(fanId); setBlockReason(''); };
  const cancelBlock = () => { setBlockingId(null); setBlockReason(''); };

  const confirmBlock = async (fanId) => {
    setError('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fanId}/block`, { reason: blockReason.trim() || undefined });
      setSuccess(data.message);
      setBlockingId(null); setBlockReason('');
      loadFans();
    } catch (err) {
      setError(err.message);
    }
  };

  const unblock = async (fanId) => {
    setError(''); setSuccess('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fanId}/unblock`, {});
      setSuccess(data.message);
      loadFans();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <T.muted>Loading members…</T.muted>;

  return (
    <div>
      <Eyebrow>Members</Eyebrow>
      <T.title>Fan management</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* Gift membership */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Gift a membership</T.sectionTitle>
        {conflict ? (
          <div>
            <div style={S.error}>{conflict.email} already has an active membership.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => handleGift('extend')} style={S.btn}>Add {term} to their membership</button>
              <button onClick={() => handleGift('change')} style={S.ghostBtn}>Change tier to {tier}</button>
              <button onClick={() => setConflict(null)} style={S.ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={S.formGrid}>
            <Field label="Fan email">
              <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="fan@example.com" />
            </Field>
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
            <Field label="Note (optional)">
              <input style={S.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note" />
            </Field>
            <div style={{ alignSelf: 'flex-end' }}>
              <button onClick={() => handleGift('gift')} disabled={gifting || !email.trim()} style={{ ...S.btn, opacity: (gifting || !email.trim()) ? 0.5 : 1 }}>
                {gifting ? 'Gifting…' : 'Gift membership'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Token grant */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>Send tokens to a fan</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.6 }}>
          Use this for refunds, compensation for failed calls or requests, or goodwill gestures. The fan sees a balance change and receives a notification.
        </p>
        <div style={S.formGrid}>
          <Field label="Fan email">
            <input style={S.input} value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="fan@example.com" />
          </Field>
          <TokenField label="Amount to send" value={grantAmt} onChange={setGrantAmt} tokenRateInr={TOKEN_RATE} />
          <Field label="Reason">
            <input style={S.input} value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="e.g. Refund for call that didn't connect" />
          </Field>
          <div style={{ alignSelf: 'flex-end' }}>
            <button onClick={handleGrantTokens} disabled={granting || !grantEmail.trim() || !grantAmt} style={{ ...S.btn, opacity: (granting || !grantEmail.trim() || !grantAmt) ? 0.5 : 1 }}>
              {granting ? 'Sending…' : 'Send tokens'}
            </button>
          </div>
        </div>
      </Card>

      {/* Fan list */}
      <T.sectionTitle>All fans ({fans.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 8 }}>
        {fans.map((fan) => {
          const isActive  = fan.membership_expires_at && new Date(fan.membership_expires_at) > new Date();
          const isBlocked = isCurrentlyBlocked(fan.blocked_until);
          return (
            <div key={fan.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={S.rowTitle}>{fan.display_name || fan.email}</div>
                  <div style={S.rowSub}>
                    Joined {new Date(fan.created_at).toLocaleDateString()} · {fan.coin_balance} tokens
                    {isActive && ` · expires ${new Date(fan.membership_expires_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {fan.is_muted && (
                    <span style={{ fontFamily: sans, fontSize: 10, color: '#D9A45C', background: 'rgba(217,164,92,0.1)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 999, padding: '3px 8px' }}>Muted</span>
                  )}
                  {isBlocked && (
                    <span style={{ fontFamily: sans, fontSize: 10, color: '#D99A9A', background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', borderRadius: 999, padding: '3px 8px' }}>
                      Blocked until {new Date(fan.blocked_until).toLocaleString()}
                    </span>
                  )}
                  <Badge tier={isActive ? fan.tier : 'guest'} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                <button
                  onClick={() => toggleMute(fan.id, fan.is_muted)}
                  disabled={mutingId === fan.id}
                  style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', opacity: mutingId === fan.id ? 0.5 : 1 }}
                >
                  {mutingId === fan.id ? '…' : fan.is_muted ? 'Unmute' : 'Mute chat & calls'}
                </button>

                {isBlocked ? (
                  <button onClick={() => unblock(fan.id)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#8FC88F' }}>
                    Lift restriction
                  </button>
                ) : blockingId === fan.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      placeholder="Reason (internal, optional)"
                      style={{ ...S.input, width: 200, padding: '5px 10px', fontSize: 11 }}
                    />
                    <button onClick={() => confirmBlock(fan.id)} style={{ ...S.btn, fontSize: 11, padding: '5px 10px', background: '#9C5A5A', border: 'none' }}>
                      Confirm restriction
                    </button>
                    <button onClick={cancelBlock} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => startBlock(fan.id)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>
                    Restrict account {fan.block_count > 0 && `(offense #${fan.block_count + 1})`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}