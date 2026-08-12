import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { tierPerks, tierDescription, MEMBERSHIP_NOTES, cfgNum, money } from '../data';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';


const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

// Mirrors addMonthsClamped() on the backend so the date shown here can never
// disagree with the date actually charged. 31 Jan + 1 month is 28 Feb, not 3 Mar.
function addMonthsClamped(date, months) {
  const d         = new Date(date);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return d;
}

// The backend now decides this, so the date shown is the one the server holds
// rather than a second computation in the browser's timezone. Kept as a fallback
// for anything the server has not labelled — and it stays deliberately one day
// early, so the real cutoff is always later than promised, never earlier.
function expiryLabel(expiresAt, serverLabel) {
  if (serverLabel) return serverLabel;
  const d = new Date(expiresAt);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function accessUntilLabel(months) {
  return expiryLabel(addMonthsClamped(new Date(), months));
}

const TIER_META = {
  community: { name: 'Community', color: '#C17D4A' },
  insider:   { name: 'Insider',   color: '#B8860B' },
  premium:   { name: 'Premium',   color: '#D4AF37' },
  supreme:   { name: 'Supreme',   color: '#C17D4A' },
};


// Billing months are Studio-configurable — see Settings → Pricing & Discounts.
function termMultiplier(termId) {
  if (termId === 'quarterly') return cfgNum('quarterly_billing_months');
  if (termId === 'annual')    return cfgNum('annual_billing_months');
  return 1;
}

// "Save 17%" style labels derived from the same numbers, never written by hand.
function termSaving(termId) {
  const charged = termMultiplier(termId);
  const months  = termMonths(termId);
  if (charged === null || months <= 1) return null;
  return `Save ${Math.round((1 - charged / months) * 100)}%`;
}

function termMonths(termId) {
  if (termId === 'quarterly') return 3;
  if (termId === 'annual')    return 12;
  return 1;
}

export default function Membership() {
  const [selectedTerm,  setSelectedTerm]  = useState('monthly');
  const [status,        setStatus]        = useState(null);
  const tokenRate  = cfgNum('token_rate_inr');
  const tierPrices = {
    community: cfgNum('community_monthly_cost'),
    insider:   cfgNum('insider_monthly_cost'),
    premium:   cfgNum('premium_monthly_cost'),
    supreme:   cfgNum('supreme_monthly_cost'),
  };
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error,         setError]         = useState('');
  const [success,       setSuccess]       = useState('');
  const [topUp,         setTopUp]         = useState(null);

  const loadStatus = () => api.get('/api/membership/status').then(setStatus).catch(() => {});

  useEffect(() => {
    Promise.all([
      api.get('/api/membership/status'),
      fetch(`${import.meta.env.VITE_API_URL || ''}/api/public/config`).then((r) => r.json()),
    ])
      .then(([statusData]) => {
        setStatus(statusData);
      })
      .catch(() => { loadStatus(); })
      .finally(() => setLoading(false));
  }, []);

  const calcCost = (tierId, termId) => {
    const base = tierPrices[tierId];
    const mult = termMultiplier(termId);
    if (base === null || mult === null) return null;
    return Math.ceil(base * mult);
  };

  const calcUpgradeCost = (fromTier, toTier, daysRemaining) => {
    const fromBase = tierPrices[fromTier];
    const toBase   = tierPrices[toTier];
    if (fromBase === null || toBase === null) return null;
    const fromPerDay = fromBase / 30;
    const toPerDay   = toBase   / 30;
    return Math.max(1, Math.ceil((toPerDay - fromPerDay) * daysRemaining));
  };

  const handlePurchase = async (tierId) => {
    setError(''); setSuccess(''); setActionLoading(tierId);
    try {
      const data = await api.post('/api/membership/purchase', { tier: tierId, term: selectedTerm });
      setSuccess(`${TIER_META[tierId].name} membership activated! Expires ${new Date(data.expiresAt).toLocaleDateString()}.`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(calcCost(tierId, selectedTerm));
      } else if (err.message === 'ALREADY_MEMBER') {
        setError('You already have an active membership. Use the upgrade option below.');
      } else {
        setError(err.message);
      }
    } finally { setActionLoading(null); }
  };

  const handleUpgrade = async (tierId) => {
    setError(''); setSuccess(''); setActionLoading(tierId);
    try {
      const data = await api.post('/api/membership/upgrade', { newTier: tierId });
      setSuccess(`Upgraded to ${TIER_META[tierId].name}!`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(calcUpgradeCost(status?.tier, tierId, status?.daysRemaining || 0));
      } else {
        setError(err.message);
      }
    } finally { setActionLoading(null); }
  };

  const handleExtend = async () => {
    setError(''); setSuccess(''); setActionLoading('extend');
    try {
      const data = await api.post('/api/membership/extend', { term: selectedTerm });
      setSuccess(`Membership extended to ${new Date(data.expiresAt).toLocaleDateString()}.`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(calcCost(status?.tier, selectedTerm));
      } else {
        setError(err.message);
      }
    } finally { setActionLoading(null); }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading membership…</div>;

  const isActive       = status?.isActive;
  const currentTierId  = isActive ? status?.tier : null;
  const currentTierIdx = TIER_ORDER.indexOf(currentTierId);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={eyebrow}>Membership</div>
        <h1 style={title}>Your membership</h1>
        <p style={text}>Benefits activate immediately. DM and unlock credits reset on the 1st of each month and do not roll over.</p>
      </div>

      {/* Status banner */}
      {isActive ? (
        <div style={activeBanner}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 4 }}>{TIER_META[currentTierId]?.name} — Active</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Access until {expiryLabel(status.expiresAt, status.expiresAtLabel)} · {status.daysRemaining} days remaining</div>
            </div>
            <button onClick={handleExtend} disabled={actionLoading === 'extend'} style={extendBtn}>
              {actionLoading === 'extend' ? 'Processing…' : 'Extend membership'}
            </button>
          </div>
        </div>
      ) : (
        <div style={guestBanner}>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
            You are browsing as a <strong style={{ color: C.text }}>Guest</strong>. All prices are {cfgNum('guest_price_multiplier')}× the member rate. Choose a membership below to unlock member pricing immediately.
          </div>
        </div>
      )}

      {error   && <div style={{ ...errorBox,   display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><span>{error}</span></div>}
      {success && <div style={successBox}>{success}</div>}

      {/* Term selector */}
      <div style={termSelector}>
        {[
          { id: 'monthly',   label: 'Monthly',   saving: null },
          { id: 'quarterly', label: 'Quarterly', saving: termSaving('quarterly') },
          { id: 'annual',    label: 'Annual',    saving: termSaving('annual') },
        ].map((t) => (
          <button key={t.id} onClick={() => setSelectedTerm(t.id)} style={{ ...termBtn, background: selectedTerm === t.id ? C.accent : 'transparent', color: selectedTerm === t.id ? '#1A1714' : C.muted, border: selectedTerm === t.id ? 'none' : `1px solid ${C.border}` }}>
            {t.label}
            {t.saving && <span style={savingBadge}>{t.saving}</span>}
          </button>
        ))}
      </div>

      {/* Tier cards */}
      <div style={tiersGrid}>
        {TIER_ORDER.map((tierId) => {
          const meta        = TIER_META[tierId];
          const tierIdx     = TIER_ORDER.indexOf(tierId);
          const isCurrent   = tierId === currentTierId;
          const canUpgrade  = isActive && tierIdx > currentTierIdx;
          const canBuy      = !isActive;
          const tokenCost   = calcCost(tierId, selectedTerm);
          const inrCost     = (tokenCost === null || tokenRate === null) ? null : tokenCost * tokenRate;
          const upgCost     = canUpgrade ? calcUpgradeCost(currentTierId, tierId, status?.daysRemaining || 0) : null;
          const months      = termMonths(selectedTerm);

          return (
            <div key={tierId} style={{ ...card, border: isCurrent ? `1px solid ${meta.color}` : `1px solid ${C.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, marginBottom: 14 }} />
              <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                {meta.name}
                {isCurrent && <span style={{ ...currentBadge, background: meta.color }}>Current</span>}
              </div>


              {/* Token price */}
              {tokenCost !== null && (
                <div style={{ marginBottom: 2 }}>
                  <WonderCoinAmount amount={tokenCost} size={20} textColor={meta.color} fontSize={28} />
                </div>
              )}
              {/* INR price */}
              {inrCost !== null && (
                <div style={{ fontFamily: F.sans, fontSize: 20, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                  {money(inrCost)}
                </div>
              )}
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 8 }}>
                {selectedTerm === 'monthly'   && 'per month · prepaid · no auto-renewal'}
                {selectedTerm === 'quarterly' && `for 3 months · prepaid · no auto-renewal`}
                {selectedTerm === 'annual'    && `for 12 months · prepaid · no auto-renewal`}
              </div>

              {canBuy && (
                <div style={accessNote}>Access until {accessUntilLabel(termMonths(selectedTerm))}</div>
              )}
              {canUpgrade && status?.expiresAt && (
                <div style={accessNote}>Your access until {expiryLabel(status.expiresAt, status.expiresAtLabel)} is unchanged — you only pay the difference for the days remaining</div>
              )}
              {isCurrent && status?.expiresAt && (
                <div style={accessNote}>Access until {expiryLabel(status.expiresAt, status.expiresAtLabel)}</div>
              )}

              {tierDescription(tierId) && (
                <div style={{ margin: '10px 0 16px' }}>
                  <div style={{ ...tierLine, color: meta.color }}>{tierDescription(tierId).line}</div>
                  <div style={tierSub}>{tierDescription(tierId).sub}</div>
                </div>
              )}

              <ul style={perkList}>{tierPerks(tierId).map((p) => <li key={p}>{p}</li>)}</ul>

              {cfgNum(`${tierId}_discount_pct`) > 0 && (
                <div style={discountBadge}>
                  {cfgNum(`${tierId}_discount_pct`)}% off all purchases while active
                </div>
              )}

              {canBuy && (
                <button onClick={() => handlePurchase(tierId)} disabled={!!actionLoading} style={{ ...joinBtn, background: meta.color, opacity: actionLoading === tierId ? 0.6 : 1 }}>
                  {actionLoading === tierId ? 'Processing…' : `Join ${meta.name}`}
                </button>
              )}
              {canUpgrade && (
                <button onClick={() => handleUpgrade(tierId)} disabled={!!actionLoading} style={{ ...joinBtn, background: meta.color, opacity: actionLoading === tierId ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {actionLoading === tierId ? 'Processing…' : (
                    <>Upgrade · <WonderCoinAmount amount={upgCost} size={14} textColor="#1A1714" fontSize={14} /></>
                  )}
                </button>
              )}
              {isCurrent && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'center', paddingTop: 8 }}>Your current plan</div>}
              {!canBuy && !canUpgrade && !isCurrent && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'center', paddingTop: 8 }}>Lower than your current plan</div>}
            </div>
          );
        })}
      </div>

      {/* Billing terms */}
      <div style={termInfoBox}>
        <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 12 }}>Billing terms</div>
        {[
          { label: 'Monthly',   desc: 'Pay for 1 month, get 1 month access' },
          { label: 'Quarterly', desc: `Pay for ${cfgNum('quarterly_billing_months')} months, get 3 months access` },
          { label: 'Annual',    desc: `Pay for ${cfgNum('annual_billing_months')} months, get 12 months access` },
        ].map((t) => (
          <div key={t.label} style={termRow}>
            <span style={{ fontFamily: F.sans, fontSize: 14, color: C.text }}>{t.label}</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>{t.desc}</span>
          </div>
        ))}
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 12, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable. Tokens are charged immediately on purchase.
        </div>
      </div>

      {/* Stated once, plainly, rather than repeated inside every tier. A
          boundary read four times sounds mean; read once it sounds reasonable —
          and these are the three things people find out later otherwise. */}
      <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
        {MEMBERSHIP_NOTES.map((n) => (
          <div key={n.title} style={noteBox}>
            <div style={noteHead}>{n.title}</div>
            <p style={noteText}>{n.text}</p>
          </div>
        ))}
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); setError(''); loadStatus(); }} />
      )}
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text         = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const activeBanner = { background: 'rgba(193,125,74,0.07)', border: `1px solid rgba(193,125,74,0.25)`, borderRadius: 10, padding: 20, marginBottom: 20 };
const guestBanner  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 20 };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const successBox   = { background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.35)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const termSelector = { display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' };
const termBtn      = { fontFamily: F.sans, fontSize: 13, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 };
const savingBadge  = { fontSize: 10, background: 'rgba(193,125,74,0.15)', color: C.accent, padding: '2px 6px', borderRadius: 999 };
const tiersGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px,1fr))', gap: 16, marginBottom: 20 };
const card         = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column' };
const currentBadge = { fontFamily: F.sans, fontSize: 10, padding: '2px 8px', borderRadius: 999, color: '#1A1714' };
// The hook, in the tier's own colour and large enough to be read on its own.
// The detail underneath stays quiet — it is for someone already interested.
const tierLine = { fontFamily: F.display, fontSize: 19, fontWeight: 600, lineHeight: 1.3, marginBottom: 6 };
const tierSub  = { fontFamily: F.sans, fontSize: 12.5, color: C.muted, lineHeight: 1.6 };
const noteBox  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' };
const noteHead = { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 };
const noteText = { fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.7, margin: 0 };

const accessNote = { fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 11, color: '#C17D4A', lineHeight: 1.5, marginBottom: 16 };
const perkList     = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.9, paddingLeft: 18, margin: '0 0 16px', flexGrow: 1 };
const discountBadge = { fontFamily: F.sans, fontSize: 12, color: C.accent, background: 'rgba(193,125,74,0.08)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 6, padding: '6px 10px', marginBottom: 12, textAlign: 'center' };
const joinBtn      = { border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const extendBtn    = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 8, cursor: 'pointer' };
const termInfoBox  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 };
const termRow      = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}` };