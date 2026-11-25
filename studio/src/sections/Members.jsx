import Invitations from '../components/Invitations';
// studio/src/sections/Members.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';
import { SectionTabs } from '../components/SectionTabs';

const TOKEN_RATE = 66;
const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const unverifiedChip = { fontFamily: sans, fontSize: 10, color: '#D9A45C', background: 'rgba(217,164,92,0.1)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 999, padding: '3px 8px' };
const unverifiedNote = { fontFamily: sans, fontSize: 12, color: colors.muted, lineHeight: 1.6, background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 };

const sumGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 };
const sumCard = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px' };

const giftBox   = { background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.25)`, borderRadius: 8, padding: 14, marginTop: 4, marginBottom: 10 };
const giftLabel = { fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 5 };

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
  preview:    { label: 'Paid for a preview',     colour: '#D9A45C' },
  viewed:     { label: 'Looked, did not unlock', colour: null     },
  recharge:   { label: 'Bought tokens',          colour: '#8FC88F' },
  bonus:      { label: 'Bonus tokens given',     colour: '#D9A45C' },
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

// "3 days ago" rather than a date: what matters is whether somebody has gone
// quiet, and a timestamp makes that arithmetic the reader's job.
function relativeTime(ts) {
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 2)      return 'just now';
  if (mins < 60)     return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)      return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)     return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function Delivered({ fanId }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api.get(`/api/studio/fans/${fanId}/delivered`).then(setD).catch(() => setD({}));
  }, [fanId]);

  if (!d) return <T.muted>Loading…</T.muted>;

  const nothing = !(d.bought?.length || d.previews?.length || d.opened?.length);
  if (nothing) return <T.muted>Nothing has been delivered to this member yet.</T.muted>;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {d.previews?.length > 0 && (
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: colors.accent, marginBottom: 8 }}>
            Previews — the exact photographs
          </div>
          {d.previews.map((p) => (
            <div key={p.setId} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                {p.title}
                <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginLeft: 8 }}>
                  {p.photos.length} of {p.ofItems} · {p.coins} tokens ·{' '}
                  {new Date(p.at).toLocaleDateString('en-IN')}
                  {p.boughtSince && ' · bought the set since'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {p.photos.map((ph) => (
                  ph.mediaType === 'video'
                    ? <video key={ph.id} src={ph.url} style={thumb64} muted />
                    : <img key={ph.id} src={ph.url} alt="" style={thumb64} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {d.bought?.length > 0 && (
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: colors.muted, marginBottom: 8 }}>
            Bought outright
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {d.bought.map((b) => (
              <div key={b.setId + b.at} style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
                {b.title}
                <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginLeft: 8 }}>
                  {b.items} photographs · {b.coins || 0} tokens ·{' '}
                  {new Date(b.at).toLocaleDateString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.opened?.length > 0 && (
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: colors.muted, marginBottom: 8 }}>
            Actually opened
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Photographs they have looked at, which is not the same as what they
            were given access to.
          </div>
          <div style={{ display: 'grid', gap: 3 }}>
            {d.opened.map((o) => (
              <div key={o.setId} style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
                {o.title}
                <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginLeft: 8 }}>
                  {o.seen} seen
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const thumb64 = { width: 64, height: 64, objectFit: 'cover', borderRadius: 6,
                  border: `1px solid ${colors.border}` };

function ConsentLine({ label, value, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>{label}</span>
      <span style={{ fontFamily: sans, fontSize: 12, color: tone || colors.text, textAlign: 'right' }}>{value}</span>
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
  // The immediate block is deliberately a separate pair of states from the
  // ladder above: confirmForever is the two-tap guard, integrityId is which
  // row is mid-request.
  const [integrityId,    setIntegrityId]    = useState(null);
  const [confirmForever, setConfirmForever] = useState(null);

  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [modLog, setModLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  // Everybody, or only those paying. Sixty-three of seventy-two have never held
  // a membership, and a single list of all of them buries the nine who do.
  const [tab,     setTab]     = useState('people');
  const [sortBy,  setSortBy]  = useState('joined');

  // Three different questions, and one tab was answering the wrong one.
  //
  // "Paying" meant "holds a membership today", so a guest who spent forty
  // thousand rupees on tokens did not appear on it — which is the opposite of
  // what the word says. Money and membership are separate facts here: anything
  // can be bought without a membership, so plenty of the best customers have
  // never held one.
  //
  //   Spent      — anybody who has ever paid, whatever their tier
  //   Memberships — anybody who has ever taken one, live or lapsed
  //
  // Lapsed members stay on the second list on purpose. Somebody whose
  // membership ended last week is the most interesting person on it, and a list
  // that hides them is a list that cannot answer why they left.
  const hasSpent   = (f) => Number(f.paid_inr || 0) > 0;
  const everMember = (f) => !!f.membership_expires_at;
  const liveMember = (f) => f.membership_expires_at && new Date(f.membership_expires_at) > new Date();

  const spentFans  = fans.filter(hasSpent);
  const memberFans = fans.filter(everMember);
  const liveCount  = memberFans.filter(liveMember).length;

  // Who the collection trial can be offered to: anybody who has paid for a
  // membership, now or at any point. A gifted membership does not count —
  // nobody's money moved — which is why this reads a flag the server works
  // out from the ledger rather than guessing from the tier.
  const trialFans  = fans.filter((f) => f.has_paid_membership);
  const inNow      = (f) => f.collections_until && new Date(f.collections_until) > new Date();
  // Supreme reaches the private collection through the tier itself, so held
  // time is beside the point for them and revoking it changes nothing.
  const bySupreme  = (f) => f.tier === 'supreme'
                         && f.membership_expires_at && new Date(f.membership_expires_at) > new Date();
  // Barred outranks both ways in, so it is read first — the same order the
  // server reads them in.
  const barred       = (f) => !!f.collections_barred_at;
  const hasCollection = (f) => !barred(f) && (inNow(f) || bySupreme(f));
  // Counts who can actually open it, not who holds granted time. A Supreme
  // member with no granted time could open the collection all along and was
  // missing from this number; somebody barred is in it no longer.
  const trialInNow = trialFans.filter(hasCollection).length;

  const SORTS = {
    joined:  { label: 'Newest',        fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
    spend:   { label: 'Spent most',    fn: (a, b) => (b.paid_inr || 0) - (a.paid_inr || 0) },
    expiry:  { label: 'Expiring next', fn: (a, b) => {
                 const av = a.membership_expires_at ? new Date(a.membership_expires_at) : Infinity;
                 const bv = b.membership_expires_at ? new Date(b.membership_expires_at) : Infinity;
                 return av - bv;
               } },
    active:  { label: 'Last seen',     fn: (a, b) =>
                 new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0) },
    name:    { label: 'Name',          fn: (a, b) =>
                 String(a.display_name || a.email).localeCompare(String(b.display_name || b.email)) },
  };

  // Each list sorted by the thing it is about, unless it has been changed by
  // hand. Opening Spent to see the newest signups first answers a question
  // nobody asked of that tab.
  useEffect(() => {
    if (tab === 'spent') setSortBy('spend');
    else if (tab === 'members') setSortBy('expiry');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const forTab = tab === 'spent'   ? spentFans
               : tab === 'trial'   ? trialFans
               : tab === 'members' ? memberFans
               :                     fans;
  const visibleFans = [...forTab].sort(SORTS[sortBy].fn);

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

  const [giftFor,   setGiftFor]   = useState(null);   // fan id
  const [giftKind,  setGiftKind]  = useState('tokens');
  const [giftAmt,   setGiftAmt]   = useState('');
  const [giftTier,  setGiftTier]  = useState('community');
  const [giftTerm,  setGiftTerm]  = useState('monthly');
  const [giftNote,  setGiftNote]  = useState('');
  const [giftBusy,  setGiftBusy]  = useState(false);

  const openGift = (fan, kind) => {
    if (giftFor === fan.id && giftKind === kind) { setGiftFor(null); return; }
    setGiftFor(fan.id); setGiftKind(kind);
    setGiftAmt(''); setGiftNote(''); setError(''); setSuccess('');
  };

  // Which kind of token, because the difference is large and invisible.
  //
  // Gifted tokens expire and reach only messages and gallery sets — right for a
  // welcome, a nudge, a small apology. Bonus tokens never expire and spend like
  // bought ones — right for somebody worth keeping, who should be able to open
  // the collection they actually wanted. Neither is revenue.
  const [tokenKind, setTokenKind] = useState('gifted');

  const sendGift = async (fan) => {
    setGiftBusy(true); setError(''); setSuccess('');
    try {
      if (giftKind === 'tokens' && tokenKind === 'bonus') {
        // Kept, and spendable anywhere.
        await api.post(`/api/studio/fans/${fan.id}/bonus-tokens`, {
          amount:  parseInt(giftAmt, 10),
          message: giftNote.trim() || undefined,
        });
        setSuccess(`${giftAmt} bonus tokens given to ${fan.display_name || fan.email}. They never expire.`);
      } else if (giftKind === 'tokens') {
        const d = await api.post('/api/studio/grant-tokens', {
          email:  fan.email,
          amount: parseInt(giftAmt, 10),
          reason: giftNote.trim() || 'Token gift from Jinal',
        });
        setSuccess(d.message);
      } else {
        const d = await api.post('/api/membership/gift', {
          email: fan.email, tier: giftTier, term: giftTerm, note: giftNote.trim() || undefined,
        });
        setSuccess(d.message || `${giftTier} membership gifted to ${fan.display_name || fan.email}.`);
      }
      setGiftFor(null); setGiftAmt(''); setGiftNote('');
      loadFans();
    } catch (err) {
      setError(err.message === 'ALREADY_MEMBER'
        ? 'They already have a membership. Use the Gift a membership tab to extend or change it.'
        : err.message);
    } finally { setGiftBusy(false); }
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

  // A fortnight in the private collection, given rather than earned.
  //
  // The server checks the paying condition again — this button being on the
  // row is a convenience, not the rule. Extending somebody who is already in
  // adds to their time rather than restarting it, and says so.
  const [trialBusy, setTrialBusy] = useState(null);

  const giveCollectionTrial = async (fan) => {
    setError(''); setSuccess('');
    setTrialBusy(fan.id);
    try {
      const d = await api.post(`/api/studio/collections/${fan.id}/trial`, {});
      const who = fan.display_name || fan.email;
      const until = d.until ? new Date(d.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null;
      setSuccess(d.extended
        ? `${who} already had access — added ${d.days} days${until ? `, now until ${until}` : ''}.`
        : `${who} has the private collection for ${d.days} days${until ? `, until ${until}` : ''}.`);
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrialBusy(null);
    }
  };

  // Taking it back. Asked for twice, because it is the only button on this
  // tab that removes something somebody already has.
  const [revokeFor, setRevokeFor] = useState(null);

  const revokeCollection = async (fan) => {
    setError(''); setSuccess('');
    setTrialBusy(fan.id);
    try {
      const d = await api.post(`/api/studio/collections/${fan.id}/revoke`, {});
      const who = fan.display_name || fan.email;
      setSuccess(d.stillInByTier
        ? `${who} no longer holds any granted time, but Supreme reaches the collection on its own — that ends when the membership does.`
        : `${who} no longer has the private collection.`);
      setRevokeFor(null);
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrialBusy(null);
    }
  };

  // The complete revoke: the one that works on Supreme.
  //
  // revokeCollection above ends granted time, which leaves a Supreme member
  // still inside because the tier carries the collection on its own — its own
  // success message has to admit that. This sets the bar the server reads
  // before any of the three ways in, so it works on anybody, and it leaves
  // the rest of the membership untouched.
  const barCollection = async (fan) => {
    setError(''); setSuccess('');
    setTrialBusy(fan.id);
    try {
      const d = await api.post(`/api/studio/collections/${fan.id}/bar`, {});
      const who = fan.display_name || fan.email;
      setSuccess(d.hadNothing
        ? `${who} did not have the collection; they are now barred from it either way.`
        : d.wasInByTier
          ? `${who} is out of the collection. Their Supreme membership is untouched — they keep everything else.`
          : `${who} is out of the collection.`);
      setRevokeFor(null);
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrialBusy(null);
    }
  };

  const unbarCollection = async (fan) => {
    setError(''); setSuccess('');
    setTrialBusy(fan.id);
    try {
      const d = await api.post(`/api/studio/collections/${fan.id}/unbar`, {});
      const who = fan.display_name || fan.email;
      setSuccess(d.backInByTier
        ? `${who} has the collection again through their Supreme membership.`
        : `${who} is no longer barred, but holds no time — give them a trial for them to see anything.`);
      loadFans();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrialBusy(null);
    }
  };

  const startBlock = (fanId) => { setBlockingId(fanId); setBlockReason(''); setConfirmForever(null); };
  const cancelBlock = () => { setBlockingId(null); setBlockReason(''); setConfirmForever(null); };

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

  // Shuts the account now and for good: the flag has no expiry and every
  // session is dropped, so whoever is holding that login is signed out
  // mid-action rather than at their next visit. Reversible only from here or
  // the Security screen.
  const blockForever = async (fanId) => {
    if (confirmForever !== fanId) { setConfirmForever(fanId); return; }
    setIntegrityId(fanId); setError(''); setSuccess('');
    try {
      await api.post(`/api/studio/security/block/${fanId}`,
        { reason: blockReason.trim() || 'Blocked by hand from Members' });
      setSuccess('Account blocked. It stays blocked until you let them back in.');
      setBlockingId(null); setBlockReason(''); setConfirmForever(null);
      loadFans();
      loadModLog();
    } catch (e) { setError(e.message); }
    finally { setIntegrityId(null); }
  };

  const liftIntegrity = async (fanId) => {
    setIntegrityId(fanId); setError(''); setSuccess('');
    try {
      await api.post(`/api/studio/security/lift/${fanId}`, {});
      setSuccess('They can sign in again.');
      loadFans();
      loadModLog();
    } catch (e) { setError(e.message); }
    finally { setIntegrityId(null); }
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

      {/* Memberships approved before the person exists, above the people who
          already do. It is the same subject and belongs on the same screen. */}
      <Invitations />

      {fans.filter((f) => f.email_verified === false).length > 0 && (
        <div style={unverifiedNote}>
          <strong style={{ color: colors.text }}>
            {fans.filter((f) => f.email_verified === false).length} {fans.filter((f) => f.email_verified === false).length === 1 ? 'person has' : 'people have'} not confirmed their email
          </strong>
          <span> — they cannot sign in, and nothing tells them why.</span>
        </div>
      )}

      <SectionTabs
        // Gifting and sending are on every row already; a tab each for them
        // was a second way to reach what is one tap away.
        tabs={[
          { key: 'people',  label: `Everyone (${fans.length})` },
          { key: 'spent',   label: `Spent (${spentFans.length})` },
          // Live out of total, because a membership list where a third have
          // lapsed is a different thing from one where none have.
          { key: 'members', label: `Memberships (${liveCount}/${memberFans.length})` },
          // In the collection out of eligible, because the useful question is
          // how many of the people who could be shown it already have it.
          { key: 'trial',   label: `Collection trial (${trialInNow}/${trialFans.length})` },
        ]}
        active={tab} onChange={setTab}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 14px' }}>
        {Object.entries(SORTS).map(([k, v]) => (
          <button key={k} onClick={() => setSortBy(k)}
                  style={{ fontFamily: sans, fontSize: 11, padding: '5px 11px', borderRadius: 999,
                           cursor: 'pointer', background: 'transparent',
                           border: `1px solid ${sortBy === k ? colors.accent : colors.border}`,
                           color: sortBy === k ? colors.accent : colors.muted }}>
            {v.label}
          </button>
        ))}
      </div>

      {/* The list. Its wrapper was lost when the gift and token tabs were
          removed — both are on every row already, so a tab each was a second
          way to reach what is one tap away. */}
      <div style={{ display: 'grid', gap: 12 }}>
        {visibleFans.map((fan) => {
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
                    Joined {new Date(fan.created_at).toLocaleDateString('en-IN')} · {fan.coin_balance} tokens
                    {/* What they have paid, and when they were last here.
                        Neither was shown, so a list of seventy-two people said
                        nothing about which of them matter or which have gone
                        quiet. */}
                    {fan.paid_inr > 0 && (
                      <span style={{ color: colors.accent }}> · ₹{Math.round(fan.paid_inr).toLocaleString('en-IN')} paid</span>
                    )}
                    {fan.last_seen_at && (
                      <span> · seen {relativeTime(fan.last_seen_at)}</span>
                    )}
                    {fan.gifted_balance > 0 && (
                      <span style={{ color: '#8FC88F' }}>
                        {' + '}{fan.gifted_balance} gifted
                        {fan.gifted_expires_at && ` (until ${new Date(fan.gifted_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`}
                      </span>
                    )}
                    {/* Bonus tokens, beside the gifted ones.
                        //
                        // A grant was credited and nothing here said so, which
                        // made it impossible to tell a successful gift from a
                        // failed one. No expiry to show, because they have none. */}
                    {fan.bonus_balance > 0 && (
                      <span style={{ color: '#D9A45C' }}>
                        {' + '}{fan.bonus_balance} bonus
                      </span>
                    )}
                    {/* Live, or when it ended.
                        //
                        // A date only appeared while a membership was running,
                        // so a lapsed one looked identical to somebody who never
                        // took one — and the person who left last week is the
                        // most interesting name on the list. */}
                    {isActive
                      ? ` · expires ${new Date(fan.membership_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : fan.membership_expires_at && (
                          <span style={{ color: '#D9A45C' }}>
                            {' · lapsed '}
                            {new Date(fan.membership_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                    {/* Money, on every row, because spending and membership are
                        separate facts and the list is now sorted by one of
                        them. */}
                    {Number(fan.paid_inr || 0) > 0 && (
                      <span style={{ color: colors.muted }}>
                        {' · '}₹{Number(fan.paid_inr).toLocaleString('en-IN')} spent
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Registered but never confirmed. They cannot sign in and
                      have no way of knowing why, so this is worth seeing before
                      wondering why somebody went quiet. */}
                  {fan.email_verified === false && (
                    <span style={unverifiedChip}>Not verified</span>
                  )}
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
                    {[{ k: 'summary', l: 'Summary' }, { k: 'history', l: 'Everything they did' }, { k: 'delivered', l: 'What they have' }].map((t) => (
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

                  {/* What they agreed to, and when.
                      //
                      // Recorded at registration and shown nowhere, which made
                      // it useless for the one thing it exists for — answering a
                      // question about it later, from a bank or from the person
                      // themselves. */}
                  {histTab === 'history' && (
                    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.muted, marginBottom: 8 }}>
                        Registration &amp; consent
                      </div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <ConsentLine label="Registered"
                                     value={new Date(fan.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })} />
                        {fan.signup_country && <ConsentLine label="From" value={fan.signup_country} />}
                        <ConsentLine label="Email verified" value={fan.email_verified ? 'Yes' : 'Not yet'}
                                     tone={fan.email_verified ? colors.success : '#D99A9A'} />
                        <ConsentLine label="Accepted the terms"
                                     value={fan.consent_terms ? 'Yes' : 'No'}
                                     tone={fan.consent_terms ? colors.success : '#D99A9A'} />
                        <ConsentLine label="Accepted no-refund"
                                     value={fan.consent_no_refund ? 'Yes' : 'No'}
                                     tone={fan.consent_no_refund ? colors.success : '#D99A9A'} />
                        {fan.consented_at && (
                          <ConsentLine label="Consent recorded"
                                       value={new Date(fan.consented_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Exactly what has reached this person.
                      //
                      // All of it was recorded and none of it was visible: what
                      // they bought, what they paid to preview, and which
                      // individual photographs those were. The preview list is
                      // the one that matters — somebody who paid to see two saw
                      // those two, and this is the only record of which. */}
                  {histTab === 'delivered' && (
                    <Delivered fanId={fan.id} />
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
                                {/* Which photographs, for a preview.
                                    //
                                    // A row saying somebody paid for a preview
                                    // does not answer the question anybody
                                    // actually has, which is which two they
                                    // saw. This opens that tab rather than
                                    // repeating the thumbnails on every row. */}
                                {h.kind === 'preview' && (
                                  <span onClick={() => setHistTab('delivered')}
                                        style={{ color: colors.accent, cursor: 'pointer', marginLeft: 6 }}>
                                    · see which
                                  </span>
                                )}
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

              {giftFor === fan.id && (
                <div style={giftBox}>
                  {giftKind === 'tokens' ? (
                    <>
                      {/* Which kind. The difference is large and nothing on
                          the member's side shows it until they try to spend. */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {[['gifted', 'Gift'], ['bonus', 'Bonus — keeps them']].map(([k, label]) => (
                          <button key={k} onClick={() => setTokenKind(k)}
                                  style={{ fontFamily: sans, fontSize: 11, padding: '5px 12px', borderRadius: 999,
                                           cursor: 'pointer',
                                           background: tokenKind === k ? 'rgba(193,125,74,0.12)' : 'transparent',
                                           border: `1px solid ${tokenKind === k ? colors.accent : colors.border}`,
                                           color: tokenKind === k ? colors.accent : colors.muted }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.6 }}>
                        {tokenKind === 'bonus'
                          ? 'Never expires and spends like bought tokens — collections, calls, requests, anything. For somebody worth keeping. Never counts as earnings or revenue.'
                          : 'Spendable on messages and gallery sets only, and it expires. For a welcome or a small apology. Never counts as earnings.'}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ width: 110 }}>
                          <div style={giftLabel}>Tokens</div>
                          <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} type="number" min={1}
                                 value={giftAmt} onChange={(e) => setGiftAmt(e.target.value)} />
                        </div>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={giftLabel}>{tokenKind === 'bonus' ? 'A note — optional, they will see it' : 'Why — they will see this'}</div>
                          <input style={{ ...S.input, width: '100%', boxSizing: 'border-box' }}
                                 value={giftNote} placeholder="e.g. sorry about the call"
                                 onChange={(e) => setGiftNote(e.target.value)} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.6 }}>
                        Starts now and runs for the term chosen. They are told, and nothing is charged.
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 140 }}>
                          <div style={giftLabel}>Tier</div>
                          <select style={S.input} value={giftTier} onChange={(e) => setGiftTier(e.target.value)}>
                            {['community', 'insider', 'premium', 'supreme'].map((t) => (
                              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ minWidth: 140 }}>
                          <div style={giftLabel}>For</div>
                          <select style={S.input} value={giftTerm} onChange={(e) => setGiftTerm(e.target.value)}>
                            <option value="monthly">1 month</option>
                            <option value="quarterly">3 months</option>
                            <option value="annual">12 months</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button onClick={() => sendGift(fan)}
                            disabled={giftBusy || (giftKind === 'tokens' && !giftAmt)}
                            style={{ ...S.btn, fontSize: 12, padding: '7px 14px',
                                     opacity: (giftBusy || (giftKind === 'tokens' && !giftAmt)) ? 0.5 : 1 }}>
                      {giftBusy ? 'Sending…'
                        : giftKind === 'tokens'
                          ? `Send ${giftAmt || ''} to ${fan.display_name || fan.email.split('@')[0]}`
                          : `Gift ${giftTier}`}
                    </button>
                    <button onClick={() => setGiftFor(null)} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Where this person stands with the collection, shown only on
                  the tab that is about it — everywhere else it would be a
                  line of noise on every row. */}
              {tab === 'trial' && (
                <div style={{ fontFamily: mono, fontSize: 11,
                              color: inNow(fan) || bySupreme(fan) ? '#C9A227' : colors.muted }}>
                  {inNow(fan)
                    ? `In the private collection until ${new Date(fan.collections_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : fan.collections_until
                      ? `Had access until ${new Date(fan.collections_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : 'Has never had the private collection'}
                  {/* Supreme reaches the collection through the tier, not
                      through held time. Worth saying on the row, or revoking
                      looks like it did nothing. */}
                  {bySupreme(fan) && (
                    <div style={{ color: colors.muted, marginTop: 2 }}>
                      Supreme reaches it anyway, until the membership ends
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                <button onClick={() => openHistory(fan)}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                  {historyFor === fan.id ? 'Hide history' : 'History'}
                </button>

                <button onClick={() => openGift(fan, 'tokens')}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px',
                                 ...(giftFor === fan.id && giftKind === 'tokens' ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
                  Gift tokens
                </button>
                <button onClick={() => openGift(fan, 'membership')}
                        style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px',
                                 ...(giftFor === fan.id && giftKind === 'membership' ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
                  Gift membership
                </button>

                {/* Only on its own tab, and only for somebody who has paid.
                    The server checks the same thing — this just keeps the
                    button off rows where pressing it would be refused. */}
                {tab === 'trial' && fan.has_paid_membership && (
                  <button onClick={() => giveCollectionTrial(fan)}
                          disabled={trialBusy === fan.id}
                          style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px',
                                   color: inNow(fan) ? colors.muted : '#C9A227',
                                   borderColor: inNow(fan) ? colors.border : '#C9A227' }}>
                    {trialBusy === fan.id ? 'Opening…'
                      : inNow(fan) ? 'Add 15 more days'
                      : 'Give 15-day collection trial'}
                  </button>
                )}

                {/* Barred shows only the way back, because every other
                    control here would be a lie while the bar is on: granting
                    time to a barred account buys them nothing. */}
                {tab === 'trial' && barred(fan) && (
                  <button onClick={() => unbarCollection(fan)} disabled={trialBusy === fan.id}
                          style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px',
                                   color: '#8FC88F', borderColor: 'rgba(143,200,143,0.4)' }}>
                    {trialBusy === fan.id ? 'Restoring…' : 'Barred — restore'}
                  </button>
                )}

                {/* Offered to anybody who can actually open the collection,
                    which now includes a Supreme member holding no granted
                    time. They were absent from this control entirely, and
                    that absence was the thing with no way around it. */}
                {tab === 'trial' && !barred(fan) && hasCollection(fan) && (
                  revokeFor === fan.id ? (
                    <>
                      {/* The gentle one, offered only where there is granted
                          time for it to end. On a Supreme member it would do
                          nothing at all, so it is not shown to suggest it
                          might. */}
                      {inNow(fan) && (
                        <button onClick={() => revokeCollection(fan)} disabled={trialBusy === fan.id}
                                style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px',
                                         color: '#D98A8A', borderColor: '#D98A8A' }}>
                          {trialBusy === fan.id ? 'Removing…' : 'End granted time'}
                        </button>
                      )}

                      {/* The one that always works. */}
                      <button onClick={() => barCollection(fan)} disabled={trialBusy === fan.id}
                              style={{ ...S.btn, fontSize: 11, padding: '5px 10px',
                                       background: '#8B3A3A', border: 'none', color: '#F2EBE0' }}>
                        {trialBusy === fan.id ? 'Removing…'
                          : bySupreme(fan) && !inNow(fan) ? 'Remove, despite Supreme'
                          : 'Remove completely'}
                      </button>

                      <button onClick={() => setRevokeFor(null)} disabled={trialBusy === fan.id}
                              style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px' }}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setRevokeFor(fan.id)}
                            style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: colors.muted }}>
                      Revoke access
                    </button>
                  )
                )}

                <button
                  onClick={() => toggleMute(fan.id, fan.is_muted)}
                  disabled={mutingId === fan.id}
                  style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', opacity: mutingId === fan.id ? 0.5 : 1 }}
                >
                  {mutingId === fan.id ? '…' : fan.is_muted ? 'Unmute' : 'Mute chat & calls'}
                </button>

                {/* An account shut for integrity is shown on its own, because
                    it is not the same state as a restriction running down a
                    clock and should not be read as one. Nothing lifts it but
                    this button. */}
                {fan.integrity_blocked_at ? (
                  <button
                    onClick={() => liftIntegrity(fan.id)}
                    disabled={integrityId === fan.id}
                    style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#8FC88F' }}>
                    {integrityId === fan.id ? '…' : 'Let back in'}
                  </button>
                ) : isBlocked ? (
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

                    {/* The way out of the ladder. Two taps, because it does not
                        expire and it ends their session mid-use — but only two,
                        because the moment you need it is the moment you do not
                        want to be reading a form. */}
                    <button
                      onClick={() => blockForever(fan.id)}
                      disabled={integrityId === fan.id}
                      style={{ ...S.btn, fontSize: 11, padding: '5px 10px',
                               background: confirmForever === fan.id ? '#8B3A3A' : 'transparent',
                               color: confirmForever === fan.id ? '#F2EBE0' : '#D99A9A',
                               border: '1px solid rgba(156,90,90,0.5)' }}>
                      {integrityId === fan.id ? '…'
                        : confirmForever === fan.id ? 'Tap again — no expiry' : 'Block immediately'}
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
    </div>
  );
}