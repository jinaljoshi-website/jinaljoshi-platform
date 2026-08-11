// studio/src/sections/Members.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';
import { SectionTabs } from '../components/SectionTabs';

const TOKEN_RATE = 66;
const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const sumGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 };
const sumCard = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px' };

const historyBox = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginTop: 4 };
const historyRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 0', borderBottom: `1px solid ${colors.border}` };

function isCurrentlyBlocked(blockedUntil) {
  return blockedUntil && new Date(blockedUntil) > new Date();
}

// What a member has actually done, in order.
//
// Deliberately separates looking from buying. A set somebody opened and did not
// unlock is a visit, not a purchase, and reporting both as "opened" is how a
// paid set with no buyers ends up looking popular.
const HISTORY_KINDS = {
  unlock:     { label: 'Unlocked',              colour: '#8FC88F' },
  viewed:     { label: 'Looked, did not unlock', colour: null     },
  recharge:   { label: 'Bought tokens',          colour: '#8FC88F' },
  membership: { label: 'Membership',             colour: '#C17D4A' },
  spend:      { label: 'Spent tokens',           colour: null     },
  message:    { label: 'Sent a message',         colour: '#C17D4A' },
  call:       { label: 'Call',                   colour: '#C17D4A' },
};

// The ledger's own vocabulary, in words Jinal would use.
const SPEND_LABELS = {
  dm_charge:           'Messages',
  chat_media_unlock:   'Media in chat',
  content_unlock:      'Sets and selfies',
  call_charge:         'Calls',
  merch_purchase:      'Merchandise',
  custom_request:      'Custom requests',
  membership_purchase: 'Membership',
  membership_upgrade:  'Upgrade',
  membership_extend:   'Extension',
};

function Sum({ label, value, sub, tone }) {
  return (
    <div style={sumCard}>
      <div style={{ fontFamily: mono, fontSize: 9, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: sans, fontSize: 18, color: tone || colors.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontFamily: sans, fontSize: 10, color: colors.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
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
  const [historyFor,  setHistoryFor]  = useState(null);
  const [history,     setHistory]     = useState(null);
  const [summary,     setSummary]     = useState(null);
  const [spentOn,     setSpentOn]     = useState([]);
  const [histTab,     setHistTab]     = useState('summary');
  const [refundingId, setRefundingId] = useState(null);

  const refundEntry = async (entry, fanId) => {
    const label = entry.detail ? `"${entry.detail}"` : 'this';
    if (!window.confirm(`Refund ${entry.tokens} tokens for ${label}? Each part goes back to where it came from.`)) return;
    setRefundingId(entry.ledgerId);
    setError(''); setSuccess('');
    try {
      const d = await api.post('/api/studio/refund', {
        ledgerId: entry.ledgerId,
        reason: entry.detail || undefined,
      });
      setSuccess(d.message || 'Refunded.');
      const h = await api.get(`/api/studio/fans/${fanId}/history`);
      setHistory(h.rows || []); setSummary(h.summary || null); setSpentOn(h.spentOn || []);
      loadFans();
    } catch (err) { setError(err.message); } finally { setRefundingId(null); }
  };

  const openHistory = async (fan) => {
    if (historyFor === fan.id) { setHistoryFor(null); return; }
    setHistoryFor(fan.id); setHistory(null);
    try {
      const d = await api.get(`/api/studio/fans/${fan.id}/history`);
      setHistory(d.rows || []);
      setSummary(d.summary || null);
      setSpentOn(d.spentOn || []);
    } catch (err) { setError(err.message); }
  };
  const [blockingId,  setBlockingId]  = useState(null);
  const [blockReason, setBlockReason] = useState('');

  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [modLog, setModLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [tab,     setTab]     = useState('people');

  const loadFans = () => api.get('/api/studio/fans').then((d) => setFans(d.fans || []));
  const loadModLog = () => api.get('/api/studio/moderation-log').then((d) => setModLog(d.log || [])).catch(() => {});

  useEffect(() => {
    loadFans().finally(() => setLoading(false));
    loadModLog();
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
      loadModLog();
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
      loadModLog();
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
      loadModLog();
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

      <SectionTabs
        tabs={[
          { key: 'people',     label: `Members (${fans.length})` },
          { key: 'membership', label: 'Gift a membership' },
          { key: 'tokens',     label: 'Send tokens' },
        ]}
        active={tab} onChange={setTab}
      />

      {tab !== 'people' && (
        <div style={{ marginBottom: 20 }}>
      {tab === 'membership' && (<>
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

      </>)}

      {tab === 'tokens' && (<>
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

      </>)}
        </div>
      )}

      {tab === 'people' && (<>
      {/* Fan list */}
      <T.sectionTitle>All fans ({fans.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 8, marginBottom: 32 }}>
        {fans.map((fan) => {
          const isActive  = fan.membership_expires_at && new Date(fan.membership_expires_at) > new Date();
          const isBlocked = isCurrentlyBlocked(fan.blocked_until);
          return (
            <div key={fan.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={S.rowTitle}>{fan.display_name || fan.email}</div>
                  {fan.display_name && (
                    <div style={{ fontFamily: mono, fontSize: 11, color: colors.muted, marginTop: 2 }}>
                      {fan.email}
                    </div>
                  )}
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

              {historyFor === fan.id && (
                <div style={historyBox}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                    {[{ k: 'summary', l: 'Summary' }, { k: 'history', l: 'Everything they did' }].map((t) => (
                      <button key={t.k} onClick={() => setHistTab(t.k)}
                        style={{
                          fontFamily: sans, fontSize: 11, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                          background: histTab === t.k ? 'rgba(193,125,74,0.12)' : 'transparent',
                          border:     histTab === t.k ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                          color:      histTab === t.k ? colors.accent : colors.muted,
                        }}>
                        {t.l}
                      </button>
                    ))}
                  </div>

                  {histTab === 'summary' && summary && (
                    <div style={{ marginBottom: 4 }}>
                      <div style={sumGrid}>
                        <Sum label="Paid"          value={`₹${summary.paidInr.toLocaleString('en-IN')}`}
                             sub={`${summary.tokensBought} tokens bought`} tone={summary.paidInr > 0 ? '#8FC88F' : null} />
                        <Sum label="Gifted to them" value={summary.tokensGifted} sub="tokens" />
                        <Sum label="Balance now"    value={summary.balance} sub="tokens" />
                        <Sum label="Sets opened"    value={summary.setsOpened}
                             sub={`${summary.extrasBought} extra portions bought`} />
                        <Sum label="Looked, no unlock" value={summary.lookedOnly} sub="sets browsed only" />
                        <Sum label="Messages"       value={summary.messages} sub={`${summary.calls} call${summary.calls === 1 ? '' : 's'}`} />
                      </div>

                      {spentOn.length > 0 && (
                        <>
                          <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '14px 0 8px' }}>
                            Where their tokens went
                          </div>
                          {spentOn.map((s2) => (
                            <div key={s2.type} style={historyRow}>
                              <span style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
                                {SPEND_LABELS[s2.type] || s2.type.replace(/_/g, ' ')}
                              </span>
                              <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
                                {s2.tokens} tokens · {s2.times} time{s2.times === 1 ? '' : 's'}
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {histTab === 'history' && (!history ? <T.muted>Loading…</T.muted>
                   : history.length === 0 ? <T.muted>Nothing yet.</T.muted>
                   : (
                    <div style={{ display: 'grid', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
                      {history.map((h, i) => {
                        const k = HISTORY_KINDS[h.kind] || { label: h.kind, colour: null };
                        return (
                          <div key={i} style={historyRow}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <div style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
                                <span style={{ color: k.colour || colors.muted }}>{k.label}</span>
                                {h.detail && <span style={{ color: colors.muted }}> · {h.detail}</span>}
                              </div>
                              <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                                {new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                {h.extra && ` · ${h.extra}`}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              {h.tokens > 0 && (
                                <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
                                  {h.tokens} tokens
                                </span>
                              )}
                              {/* Only where there is a ledger entry to reverse.
                                  Each part goes back where it came from — gifted
                                  as a fresh grant, purchased to the balance —
                                  rather than handing out new tokens and hoping
                                  the amounts line up. */}
                              {h.refundedAt ? (
                                <span style={{ fontFamily: sans, fontSize: 10, color: '#8FC88F' }}>refunded</span>
                              ) : h.ledgerId && h.tokens > 0 ? (
                                <button onClick={() => refundEntry(h, fan.id)}
                                        disabled={refundingId === h.ledgerId}
                                        style={{ ...S.ghostBtn, fontSize: 10, padding: '3px 9px' }}>
                                  {refundingId === h.ledgerId ? '…' : 'Refund'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                <button onClick={() => openHistory(fan)}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                  {historyFor === fan.id ? 'Hide history' : 'History'}
                </button>

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
      </>)}
    </div>
  );
}