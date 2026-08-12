import { useEffect, useState } from 'react';
import { api } from '../api';
import { tokenRateInr, rechargePrice, discountConfig, setDiscountConfig } from '../data';
import { C, F } from '../tokens';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import TopUpModal from '../components/TopUpModal';

export default function Coins() {
  const [balance,  setBalance]  = useState(null);
  const [gifted,   setGifted]   = useState(0);
  const [giftedDays, setGiftedDays] = useState(null);
  const [bonus,    setBonus]    = useState(0);
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
        setBalance(data.purchasedBalance ?? data.balance ?? 0);
        setGifted(data.giftedBalance ?? 0);
        setGiftedDays(data.giftedExpiresInDays ?? null);
        setBonus(data.bonusBalance ?? 0);
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

  // What they will actually be charged in. Until now the screen showed rupees
  // and Razorpay showed dollars — the price changed at the last step, which is
  // the moment a purchase is most likely to be abandoned.
  const [fx, setFx] = useState(null);
  const [savingCurrency, setSavingCurrency] = useState(false);

  useEffect(() => {
    api.get('/api/coins/currencies').then(setFx).catch(() => {});
  }, []);

  const chooseCurrency = async (code) => {
    setSavingCurrency(true);
    try {
      await api.post('/api/coins/currency', { currency: code });
      setFx(await api.get('/api/coins/currencies'));
    } catch { /* keeping rupees is a safe outcome */ }
    finally { setSavingCurrency(false); }
  };

  // Mirrors the server's own quote so the figure on screen is the figure
  // charged. The server still computes it independently at order time — this is
  // for display, not authority.
  // Shows the fan's currency where they have one, rupees otherwise. Used at
  // every price on the screen so none can be left showing the wrong one.
  const money = (inr) => inCurrency(inr) || `₹${Number(inr).toLocaleString('en-IN')}`;

  const inCurrency = (inr) => {
    if (!fx?.isForeign) return null;
    const opt = (fx.options || []).find((o) => o.currency === fx.current);
    if (!opt?.inrPerUnit) return null;
    const effective = opt.inrPerUnit / (1 + (fx.bufferPct || 0) / 100);
    const f = Math.pow(10, opt.decimals ?? 2);
    return `${opt.symbol}${(Math.ceil((inr / effective) * f) / f).toFixed(opt.decimals ?? 2)}`;
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading balance…</div>;

  const rate = tokenRateInr();
  if (rate === null) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Pricing is temporarily unavailable. Please refresh in a moment.</div>;

  return (
    <div>
      {fx?.shouldAsk && (fx.options || []).length > 0 && (
        <div style={currencyAsk}>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, marginBottom: 4 }}>
            You seem to be in {fx.detectedCountry}
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            Which currency would you like to pay in? You can change this any time.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {fx.options.map((o) => (
              <button key={o.currency} onClick={() => chooseCurrency(o.currency)} disabled={savingCurrency}
                      style={o.isLocal ? currencyBtnPrimary : currencyBtn}>
                {o.currency}
                {o.isLocal && <span style={{ fontSize: 10, opacity: 0.8 }}> · yours</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>J Tokens</div>
        <h1 style={title}>Your balance</h1>
        <p style={text}>
          {fx?.isForeign
            ? <>1 J Token = {inCurrency(rate)}. Tokens never expire. </>
            : <>1 J Token = ₹{rate} incl. GST. Tokens never expire. </>}
          Bulk discounts: {discountConfig.tier1Pct}% off on {discountConfig.tier1Threshold}+, {discountConfig.tier2Pct}% off on {discountConfig.tier2Threshold}+.
        </p>
        {fx?.isForeign && (
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 8 }}>
            Charged in {fx.current}
            {(fx.options || []).length > 1 && (
              <>
                {' · '}
                {fx.options.filter((o) => o.currency !== fx.current).map((o) => (
                  <button key={o.currency} onClick={() => chooseCurrency(o.currency)} disabled={savingCurrency}
                          style={currencySwitch}>
                    switch to {o.currency}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable.
        </div>
      </div>

      {/* Balance card — two pots, because they behave differently */}
      <div style={balanceCard}>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Your tokens</div>
        {balance === null
          ? <div style={{ fontFamily: F.display, fontSize: 44, color: C.text }}>—</div>
          : <WonderCoinAmount amount={balance + bonus + gifted} size={44} fontSize={52} />
        }
        <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 8 }}>
          ≈ {money((balance || 0) * rate)} of purchased tokens
        </div>

        {(gifted > 0 || bonus > 0) && (
          <div style={potsRow}>
            <div style={pot}>
              <div style={potLabel}>Purchased</div>
              <WonderCoinAmount amount={balance || 0} size={18} fontSize={20} />
              <div style={potNote}>Never expires · use anywhere</div>
            </div>
            {bonus > 0 && (
              <div style={{ ...pot, borderColor: 'rgba(193,125,74,0.3)' }}>
                <div style={{ ...potLabel, color: C.accent }}>Bonus</div>
                <WonderCoinAmount amount={bonus} size={18} fontSize={20} textColor={C.accent} showInr={false} />
                <div style={potNote}>Never expires · use anywhere</div>
              </div>
            )}
            {gifted > 0 && (
            <div style={{ ...pot, borderColor: 'rgba(100,160,100,0.3)' }}>
              <div style={{ ...potLabel, color: '#8FC88F' }}>Gifted 🎁</div>
              <WonderCoinAmount amount={gifted} size={18} fontSize={20} textColor="#8FC88F" />
              <div style={potNote}>
                {giftedDays !== null ? `Expires in ${giftedDays} day${giftedDays === 1 ? '' : 's'} · ` : ''}
                messages &amp; content only
              </div>
            </div>
            )}
          </div>
        )}
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
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textDecoration: 'line-through' }}>{money(customPricing.base)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 16, color: C.text, fontWeight: 600 }}>{money(customPricing.final)}</span>
                      <span style={discountBadge}>{customPricing.pct}% off</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontFamily: F.sans, fontSize: 15, color: C.text }}>{money(customPricing.final)}</div>
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

        {/* Quick-pick packs — the last two amounts are derived fresh on every render from
            Jinal's actual configured thresholds, so the buttons themselves change (not just
            their discount badges) the moment she updates them in Studio. */}
        <div style={sectionLabel}>Quick select</div>
        <div style={packsRow}>
          {[
            { tokens: 10 },
            { tokens: 50 },
            { tokens: 100 },
            { tokens: discountConfig.tier1Threshold },
            { tokens: discountConfig.tier2Threshold },
          ].map((pack) => {
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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 13, color: isCredit ? '#8FC88F' : C.muted }}>{isCredit ? '+' : '-'}</span>
                      <WonderCoinAmount amount={entry.amount} size={14} textColor={isCredit ? '#8FC88F' : C.muted} fontSize={14} />
                    </div>
                    {entry.from_gifted > 0 && (
                      <span style={{ fontFamily: F.sans, fontSize: 10, color: '#8FC88F' }}>
                        {entry.from_purchased > 0
                          ? `${entry.from_gifted} gifted + ${entry.from_purchased} purchased`
                          : 'from gifted'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showModal && (
        <TopUpModal
          exactTokens={modalAmount}
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
const potsRow   = { display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' };
const pot       = { flex: 1, minWidth: 140, background: '#100F0C', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' };
const potLabel  = { fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 };
const potNote   = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 };
const balanceCard  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '28px 24px', marginBottom: 20 };
const customCard   = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 };
const currencyAsk        = { background: C.surface, border: `1px solid rgba(193,125,74,0.3)`, borderRadius: 12, padding: 18, marginBottom: 22 };
const currencyBtn        = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '9px 18px', borderRadius: 8, cursor: 'pointer' };
const currencyBtnPrimary = { ...currencyBtn, background: 'rgba(193,125,74,0.12)', border: `1px solid ${C.accent}`, color: C.accent };
const currencySwitch     = { background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 12, cursor: 'pointer', padding: 0, marginRight: 8, textDecoration: 'underline' };

const packsRow     = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const packChip     = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s' };
const smallBadge   = { fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: '#8FC88F', background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.3)', borderRadius: 4, padding: '1px 5px' };
const discountBadge = { fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: '#8FC88F', background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.3)', borderRadius: 4, padding: '2px 6px' };
const buyBtn       = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const ledgerCard   = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginTop: 10 };
const ledgerRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` };