import { useEffect, useState } from 'react';
import { TIERS, TERMS, termPrice, upgradeCost, PAID_TIER_IDS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

export default function Membership() {
  const [selectedTerm,  setSelectedTerm]  = useState('monthly');
  const [status,        setStatus]        = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // stores tier id being processed
  const [error,         setError]         = useState('');
  const [success,       setSuccess]       = useState('');
  const [topUp,         setTopUp]         = useState(null);

  const paidTiers = PAID_TIER_IDS.map((id) => TIERS[id]);
  const term      = TERMS.find((t) => t.id === selectedTerm);

  const loadStatus = () => api.get('/api/membership/status').then(setStatus).catch((err) => setError(err.message));

  useEffect(() => { loadStatus().finally(() => setLoading(false)); }, []);

  const handlePurchase = async (tierId) => {
    setError(''); setSuccess(''); setActionLoading(tierId);
    try {
      const data = await api.post('/api/membership/purchase', { tier: tierId, term: selectedTerm });
      setSuccess(`${TIERS[tierId].name} membership activated! Expires ${new Date(data.expiresAt).toLocaleDateString()}.`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(termPrice(TIERS[tierId], term));
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
      setSuccess(`Upgraded to ${TIERS[tierId].name}! New cycle runs for 1 month from today.`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        const days = status?.daysRemaining || 0;
        setTopUp(upgradeCost(status?.tier, tierId, days));
      } else {
        setError(err.message);
      }
    } finally { setActionLoading(null); }
  };

  const handleExtend = async () => {
    setError(''); setSuccess(''); setActionLoading(tierId);
    try {
      const data = await api.post('/api/membership/extend', { term: selectedTerm });
      setSuccess(`Membership extended! New expiry: ${new Date(data.expiresAt).toLocaleDateString()}.`);
      loadStatus();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(termPrice(TIERS[status?.tier], term));
      } else {
        setError(err.message);
      }
    } finally { setActionLoading(null); }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading membership…</div>;

  const isActive       = status?.isActive;
  const currentTierId  = isActive ? status?.tier : 'guest';
  const currentTierIdx = PAID_TIER_IDS.indexOf(currentTierId);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={eyebrow}>Membership</div>
        <h1 style={title}>Your membership</h1>
        <p style={text}>Benefits activate immediately. DMs and unlock credits reset on the 1st of each month and do not roll over.</p>
      </div>

      {/* Status banner */}
      {isActive ? (
        <div style={activeBanner}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 4 }}>{TIERS[currentTierId]?.name} — Active</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Expires {new Date(status.expiresAt).toLocaleDateString()} · {status.daysRemaining} days remaining</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.accent, marginTop: 4 }}>{TIERS[currentTierId]?.discountPct}% discount active on all purchases</div>
            </div>
            <button onClick={handleExtend} disabled={!!actionLoading} style={extendBtn}>Extend membership</button>
          </div>
        </div>
      ) : (
        <div style={guestBanner}>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
            You are browsing as a <strong style={{ color: C.text }}>Guest</strong>. All prices are 2× the member rate. Choose a membership below to unlock member pricing immediately.
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>{error}</span>
          {topUp !== null && <button onClick={() => setTopUp(topUp)} style={inlineTopUp}>Top up now</button>}
        </div>
      )}
      {success && <div style={successBox}>{success}</div>}

      {/* Term selector */}
      <div style={termSelector}>
        {TERMS.map((t) => (
          <button key={t.id} onClick={() => setSelectedTerm(t.id)} style={{ ...termBtn, background: selectedTerm === t.id ? C.accent : 'transparent', color: selectedTerm === t.id ? '#1A1714' : C.muted, border: selectedTerm === t.id ? 'none' : `1px solid ${C.border}` }}>
            {t.label}
            {t.savingLabel && <span style={savingBadge}>{t.savingLabel}</span>}
          </button>
        ))}
      </div>

      {/* Tier cards */}
      <div style={tiersGrid}>
        {paidTiers.map((tier) => {
          const cost       = termPrice(tier, term);
          const tierIdx    = PAID_TIER_IDS.indexOf(tier.id);
          const isCurrent  = tier.id === currentTierId && isActive;
          const canUpgrade = isActive && tierIdx > currentTierIdx;
          const canBuy     = !isActive;
          const upgCost    = canUpgrade ? upgradeCost(currentTierId, tier.id, status?.daysRemaining || 0) : null;

          return (
            <div key={tier.id} style={{ ...card, border: isCurrent ? `1px solid ${tier.color}` : `1px solid ${C.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: tier.color, marginBottom: 14 }} />
              <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6 }}>
                {tier.name}
                {isCurrent && <span style={{ ...currentBadge, background: tier.color }}> Current</span>}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>{tier.description}</div>
              <div style={{ marginBottom: 4 }}><WonderCoinAmount amount={cost} size={20} textColor={tier.color} fontSize={28} /></div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 18 }}>
                {term.label.toLowerCase()} · prepaid · no auto-renewal
                {term.savingLabel && <span style={{ color: C.accent, marginLeft: 8 }}>({term.savingLabel})</span>}
              </div>
              <ul style={perkList}>{tier.perks.map((p) => <li key={p}>{p}</li>)}</ul>
              <div style={discountBadge}>{tier.discountPct}% off all purchases while active</div>

              {canBuy && <button onClick={() => handlePurchase(tier.id)} disabled={!!actionLoading} style={{ ...joinBtn, background: tier.color }}>{actionLoading === tier.id ? 'Processing…' : `Join ${tier.name}`}</button>}
              {canUpgrade && <button onClick={() => handleUpgrade(tier.id)} disabled={!!actionLoading} style={{ ...joinBtn, background: tier.color, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{actionLoading === tier.id ? 'Processing…' : <><span>Upgrade · </span><WonderCoinAmount amount={upgCost} size={14} textColor="#1A1714" fontSize={14} /></>}</button>}
              {isCurrent && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'center', paddingTop: 8 }}>Your current plan</div>}
              {!canBuy && !canUpgrade && !isCurrent && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'center', paddingTop: 8 }}>Lower than your current plan</div>}
            </div>
          );
        })}
      </div>

      {/* Billing terms */}
      <div style={termInfoBox}>
        <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 12 }}>Billing terms</div>
        {TERMS.map((t) => (
          <div key={t.id} style={termRow}>
            <span style={{ fontFamily: F.sans, fontSize: 14, color: C.text }}>{t.label}</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>
              {t.id === 'monthly' && 'Pay 1 month, get 1 month'}
              {t.id === 'quarterly' && 'Pay 2.5 months, get 3 months'}
              {t.id === 'annual' && 'Pay 9 months, get 12 months'}
            </span>
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
const inlineTopUp  = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const termSelector = { display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' };
const termBtn      = { fontFamily: F.sans, fontSize: 13, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 };
const savingBadge  = { fontSize: 10, background: 'rgba(193,125,74,0.15)', color: C.accent, padding: '2px 6px', borderRadius: 999 };
const tiersGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px,1fr))', gap: 16, marginBottom: 20 };
const card         = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column' };
const currentBadge = { fontFamily: F.sans, fontSize: 10, padding: '2px 8px', borderRadius: 999, color: '#1A1714', marginLeft: 8, verticalAlign: 'middle' };
const perkList     = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.9, paddingLeft: 18, margin: '0 0 16px', flexGrow: 1 };
const discountBadge = { fontFamily: F.sans, fontSize: 12, color: C.accent, background: 'rgba(193,125,74,0.08)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 6, padding: '6px 10px', marginBottom: 12, textAlign: 'center' };
const joinBtn      = { border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const extendBtn    = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 8, cursor: 'pointer' };
const termInfoBox  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 };
const termRow      = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}` };