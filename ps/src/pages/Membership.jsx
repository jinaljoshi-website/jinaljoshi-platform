import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { TERMS, termPrice } from '../data';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

const TOKEN_RATE = 66;

const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

const TIER_META = {
  community: { name: 'Community', color: '#C17D4A', description: 'Entry-level membership with community access and a monthly content unlock.' },
  insider:   { name: 'Insider',   color: '#B8860B', description: 'More messages, more unlocks, and a better discount on every purchase.' },
  premium:   { name: 'Premium',   color: '#9B8F83', description: 'Generous monthly allocations and a significant discount across the platform.' },
  supreme:   { name: 'Supreme',   color: '#C17D4A', description: 'The highest access tier — maximum unlocks, best discount, full DM access.' },
};

const TIER_PERKS = {
  community: ['Community Chat Centre', '5 free Direct Messages · 2 Per Day max', 'Unlock any One Set', '5% Discount site-wide', 'All content posted to community'],
  insider:   ['Community Chat Centre', '30 free Direct Messages · 3 Per Day max', 'Unlock any Four Sets', '10% Discount site-wide', 'All content posted to community'],
  premium:   ['Community Chat Centre', '100 free Direct Messages · 5 Per Day max', 'Unlock any Seven Sets', '15% Discount site-wide', 'All content posted to community'],
  supreme:   ['Community Chat Centre', '250 free Direct Messages · 10 Per Day max', 'Unlock any Ten Sets', '20% Discount site-wide', 'All content posted to community'],
};

const DEFAULT_PRICES = { community: 10, insider: 30, premium: 75, supreme: 150 };

function termMultiplier(termId) {
  if (termId === 'quarterly') return 2.5;
  if (termId === 'annual')    return 9;
  return 1;
}

function termMonths(termId) {
  if (termId === 'quarterly') return 3;
  if (termId === 'annual')    return 12;
  return 1;
}

export default function Membership() {
  const [selectedTerm,  setSelectedTerm]  = useState('monthly');
  const [status,        setStatus]        = useState(null);
  const [tierPrices,    setTierPrices]    = useState(DEFAULT_PRICES);
  const [tokenRate,     setTokenRate]     = useState(TOKEN_RATE);
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
      .then(([statusData, configData]) => {
        setStatus(statusData);
        const c = configData.config || {};
        setTokenRate(parseInt(c.token_rate_inr || TOKEN_RATE));
        setTierPrices({
          community: parseInt(c.community_monthly_cost || DEFAULT_PRICES.community),
          insider:   parseInt(c.insider_monthly_cost   || DEFAULT_PRICES.insider),
          premium:   parseInt(c.premium_monthly_cost   || DEFAULT_PRICES.premium),
          supreme:   parseInt(c.supreme_monthly_cost   || DEFAULT_PRICES.supreme),
        });
      })
      .catch(() => { loadStatus(); })
      .finally(() => setLoading(false));
  }, []);

  const calcCost = (tierId, termId) => {
    const base = tierPrices[tierId] || DEFAULT_PRICES[tierId];
    return Math.round(base * termMultiplier(termId));
  };

  const calcUpgradeCost = (fromTier, toTier, daysRemaining) => {
    const fromBase = tierPrices[fromTier] || DEFAULT_PRICES[fromTier];
    const toBase   = tierPrices[toTier]   || DEFAULT_PRICES[toTier];
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
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Expires {new Date(status.expiresAt).toLocaleDateString()} · {status.daysRemaining} days remaining</div>
            </div>
            <button onClick={handleExtend} disabled={actionLoading === 'extend'} style={extendBtn}>
              {actionLoading === 'extend' ? 'Processing…' : 'Extend membership'}
            </button>
          </div>
        </div>
      ) : (
        <div style={guestBanner}>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
            You are browsing as a <strong style={{ color: C.text }}>Guest</strong>. All prices are 2× the member rate. Choose a membership below to unlock member pricing immediately.
          </div>
        </div>
      )}

      {error   && <div style={{ ...errorBox,   display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><span>{error}</span></div>}
      {success && <div style={successBox}>{success}</div>}

      {/* Term selector */}
      <div style={termSelector}>
        {[
          { id: 'monthly',   label: 'Monthly',   saving: null },
          { id: 'quarterly', label: 'Quarterly', saving: 'Save ~17%' },
          { id: 'annual',    label: 'Annual',    saving: 'Save 25%' },
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
          const inrCost     = tokenCost * tokenRate;
          const upgCost     = canUpgrade ? calcUpgradeCost(currentTierId, tierId, status?.daysRemaining || 0) : null;
          const months      = termMonths(selectedTerm);

          return (
            <div key={tierId} style={{ ...card, border: isCurrent ? `1px solid ${meta.color}` : `1px solid ${C.border}` }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, marginBottom: 14 }} />
              <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                {meta.name}
                {isCurrent && <span style={{ ...currentBadge, background: meta.color }}>Current</span>}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>{meta.description}</div>

              {/* Token price */}
              <div style={{ marginBottom: 2 }}>
                <WonderCoinAmount amount={tokenCost} size={20} textColor={meta.color} fontSize={28} />
              </div>
              {/* INR price */}
              <div style={{ fontFamily: F.sans, fontSize: 20, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                ₹{inrCost.toLocaleString('en-IN')}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 18 }}>
                {selectedTerm === 'monthly'   && 'per month · prepaid · no auto-renewal'}
                {selectedTerm === 'quarterly' && `for 3 months · prepaid · no auto-renewal`}
                {selectedTerm === 'annual'    && `for 12 months · prepaid · no auto-renewal`}
              </div>

              <ul style={perkList}>{TIER_PERKS[tierId].map((p) => <li key={p}>{p}</li>)}</ul>

              <div style={discountBadge}>
                {tierId === 'community' ? '5' : tierId === 'insider' ? '10' : tierId === 'premium' ? '15' : '20'}% off all purchases while active
              </div>

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
          { label: 'Quarterly', desc: 'Pay for 2.5 months, get 3 months access' },
          { label: 'Annual',    desc: 'Pay for 9 months, get 12 months access' },
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
const perkList     = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.9, paddingLeft: 18, margin: '0 0 16px', flexGrow: 1 };
const discountBadge = { fontFamily: F.sans, fontSize: 12, color: C.accent, background: 'rgba(193,125,74,0.08)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 6, padding: '6px 10px', marginBottom: 12, textAlign: 'center' };
const joinBtn      = { border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 0', borderRadius: 8, cursor: 'pointer', width: '100%' };
const extendBtn    = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 8, cursor: 'pointer' };
const termInfoBox  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 };
const termRow      = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}` };