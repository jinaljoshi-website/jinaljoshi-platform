import { useEffect, useState } from 'react';
import { api } from '../api';
import { RECHARGE_PACKS, TOKEN_RATE_INR, rechargePrice, discountConfig, setDiscountConfig } from '../data';
import { C, F } from '../tokens';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import TopUpModal from '../components/TopUpModal';

export default function Coins() {
  const [balance,  setBalance]  = useState(null);
  const [ledger,   setLedger]   = useState([]);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalAmount, setModalAmount] = useState(0);

  // Custom amount state
  const [custom,    setCustom]    = useState('');
  const [quickPick, setQuickPick] = useState(null);

  const load = () => {
    api.get('/api/coins/balance')
      .then((data) => {
        setDiscountConfig(data.discountConfig);
        setBalance(data.balance ?? 0);
        setLedger(data.ledger || []);
      })
      .catch((err) => setError(err.message || 'Could not load coin balance.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openModal = (tokens) => { setModalAmount(tokens); setShowModal(true); };

  const handleCustomBuy = () => {
    const amt = parseInt(custom);
    if (!amt || amt < 1) return;
    openModal(amt);
  };

  const customPricing = custom ? rechargePrice(parseInt(custom) || 0) : null;

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading balance…</div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>J Tokens</div>
        <h1 style={title}>Your balance</h1>
        <p style={text}>
          1 J Token = ₹{TOKEN_RATE_INR} incl. GST. Tokens never expire.
          Bulk discounts: {discountConfig.tier1Pct}% off on {discountConfig.tier1Threshold}+, {discountConfig.tier2Pct}% off on {discountConfig.tier2Threshold}+.
        </p>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable.
        </div>
      </div>

      {/* Balance card */}
      <div style={balanceCard}>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Current balance</div>
        {balance === null
          ? <div style={{ fontFamily: F.display, fontSize: 44, color: C.text }}>—</div>
          : <WonderCoinAmount amount={balance} size={44} fontSize={52} />
        }
        <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 8 }}>
          ≈ ₹{((balance || 0) * TOKEN_RATE_INR).toLocaleString('en-IN')} equivalent
        </div>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {/* ── CUSTOM AMOUNT — primary ── */}
      <div style={customCard}>
        <div style={sectionLabel}>Enter amount</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#100F0C', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
              <WonderCoin size={18} />
              <input
                type="number"
                min={1}
                value={custom}
                onChange={(e) => { setCustom(e.target.value); setQuickPick(null); }}
                placeholder="e.g. 200"
                style={{ flex: 1, background: 'transparent', border: 'none', color: C.text, fontFamily: F.display, fontSize: 28, outline: 'none', width: '100%' }}
              />
            </div>
          </div>
          <div>
            {customPricing && parseInt(custom) > 0 ? (
              <div style={{ marginBottom: 8 }}>
                {customPricing.pct > 0 ? (
                  <>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textDecoration: 'line-through' }}>₹{customPricing.base.toLocaleString('en-IN')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 16, color: C.text, fontWeight: 600 }}>₹{customPricing.final.toLocaleString('en-IN')}</span>
                      <span style={discountBadge}>{customPricing.pct}% off</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontFamily: F.sans, fontSize: 15, color: C.text }}>₹{customPricing.final.toLocaleString('en-IN')}</div>
                )}
              </div>
            ) : (
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 8 }}>Enter tokens above</div>
            )}
            <button
              onClick={handleCustomBuy}
              disabled={!custom || parseInt(custom) < 1}
              style={{ ...buyBtn, opacity: (!custom || parseInt(custom) < 1) ? 0.5 : 1 }}
            >
              Buy now
            </button>
          </div>
        </div>

        {/* Quick-pick packs */}
        <div style={sectionLabel}>Quick select</div>
        <div style={packsRow}>
          {RECHARGE_PACKS.map((pack) => {
            const p = rechargePrice(pack.tokens);
            const isSelected = quickPick === pack.tokens;
            return (
              <button
                key={pack.tokens}
                onClick={() => { setQuickPick(pack.tokens); setCustom(String(pack.tokens)); }}
                style={{
                  ...packChip,
                  background: isSelected ? 'rgba(193,125,74,0.15)' : 'transparent',
                  border:     isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                  color:      isSelected ? C.accent : C.muted,
                }}
              >
                <WonderCoin size={12} />
                <span style={{ fontFamily: F.display, fontSize: 16 }}>{pack.tokens}</span>
                {p.pct > 0 && <span style={smallBadge}>{p.pct}% off</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Transaction history */}
      <div style={{ marginTop: 24 }}>
        <div style={sectionLabel}>Recent transactions</div>
        <div style={ledgerCard}>
          {!ledger.length ? (
            <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>No transactions yet.</div>
          ) : (
            ledger.map((entry) => {
              const isCredit = entry.direction === 'credit' || entry.type === 'recharge' || entry.type === 'grant';
              return (
                <div key={entry.id} style={ledgerRow}>
                  <div>
                    <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text }}>{entry.label}</div>
                    <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {entry.type} · {new Date(entry.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 13, color: isCredit ? '#8FC88F' : C.muted }}>{isCredit ? '+' : '-'}</span>
                    <WonderCoinAmount amount={entry.amount} size={14} textColor={isCredit ? '#8FC88F' : C.muted} fontSize={14} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showModal && (
        <TopUpModal
          requiredTokens={modalAmount}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text         = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const sectionLabel = { fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 };
const balanceCard  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '28px 24px', marginBottom: 20 };
const customCard   = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 };
const packsRow     = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const packChip     = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s' };
const smallBadge   = { fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: '#8FC88F', background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.3)', borderRadius: 4, padding: '1px 5px' };
const discountBadge = { fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: '#8FC88F', background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.3)', borderRadius: 4, padding: '2px 6px' };
const buyBtn       = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const ledgerCard   = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginTop: 10 };
const ledgerRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` };