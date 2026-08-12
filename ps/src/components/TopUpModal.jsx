// ps/src/components/TopUpModal.jsx
// Reusable top-up overlay — opened from anywhere with a required token amount
// No membership nudge shown here

import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { WonderCoin, WonderCoinAmount } from './WonderCoin';
import { api } from '../api';
import { rechargePacks, tokenRateInr, rechargePrice, money } from '../data';

// Currencies quoted without decimal places. Razorpay expects the smallest unit
// of the currency, and for these the smallest unit is the currency itself.
const ZERO_DECIMAL = new Set(['JPY','KRW','VND','CLP','ISK','HUF','TWD','UGX','RWF','XAF','XOF']);

export default function TopUpModal({ requiredTokens = 0, exactTokens = 0, onClose, onSuccess }) {
  // Find the smallest pack that covers the required amount,
  // or default to the first pack above required
  const packs = rechargePacks();
  const suggestedPack = packs.find((p) => p.tokens >= requiredTokens) || packs[packs.length - 1];

  // Whether the fan asked for a specific number or fell short of one, the amount
  // is filled in exactly. Rounding a shortfall of 107 up to a 500-token pack
  // charges four times what was needed, at the moment somebody is already
  // hesitating -- and the packs remain one click away for anyone who would
  // rather buy more.
  const prefill = exactTokens || requiredTokens || 0;
  const [selected,    setSelected]    = useState(suggestedPack?.tokens ?? 0);
  const [custom,      setCustom]      = useState(prefill ? String(prefill) : '');
  const [useCustom,   setUseCustom]   = useState(!!prefill);
  const [processing,  setProcessing]  = useState(false);
  const [error,       setError]       = useState('');
  const overlayRef = useRef(null);

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Load Razorpay script once
  useEffect(() => {
    if (document.getElementById('razorpay-script')) return;
    const script    = document.createElement('script');
    script.id       = 'razorpay-script';
    script.src      = 'https://checkout.razorpay.com/v1/checkout.js';
    document.body.appendChild(script);
  }, []);

  const tokenAmount = useCustom
    ? (parseInt(custom) || 0)
    : selected;

  const rate    = tokenRateInr();
  const pricing = rechargePrice(tokenAmount);

  const handleRecharge = async () => {
    if (tokenAmount < 1) {
      setError('Please enter a valid amount.');
      return;
    }
    setError(''); setProcessing(true);
    try {
      const data = await api.post('/api/coins/recharge/initiate', { tokens: tokenAmount });

      if (typeof window.Razorpay === 'undefined') {
        setError('Razorpay is not loaded. Please refresh and try again.');
        setProcessing(false);
        return;
      }

      const rzp = new window.Razorpay({
        key:         data.razorpayKey,
        // Whatever the server actually quoted. Zero-decimal currencies are
        // sent as whole units, so multiplying blindly by 100 would ask for a
        // hundred times the price in yen.
        amount:      Math.round(data.amount * (ZERO_DECIMAL.has(data.currency) ? 1 : 100)),
        currency:    data.currency || 'INR',
        name:        'Personal Space',
        description: `${tokenAmount} J Tokens`,
        order_id:    data.orderId,
        handler: async (response) => {
          try {
            const verifyData = await api.post('/api/coins/recharge/verify', {
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              tokens:              tokenAmount,
            });
            onSuccess?.(verifyData.newBalance);
            onClose();
          } catch (verifyErr) {
            // Payment succeeded on Razorpay's side but our verification call failed —
            // the webhook will catch this as a backup, but tell the user honestly
            setError('Payment received, but we could not confirm it immediately. Your tokens will appear shortly, or contact support if not within a few minutes.');
            setProcessing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setProcessing(false);
          },
        },
        theme: { color: '#C17D4A' },
      });
      rzp.open();
    } catch (err) {
      setError(err.message || 'Could not initiate recharge.');
      setProcessing(false);
    }
  };

  if (rate === null || !pricing || !packs.length) {
    return (
      <div ref={overlayRef} onClick={handleBackdrop} style={overlay}>
        <div style={modal}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 10 }}>Pricing unavailable</div>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, marginBottom: 18 }}>We could not load the current token rate. Please close this and try again in a moment.</div>
          <button onClick={onClose} style={rechargeBtn}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={overlayRef} onClick={handleBackdrop} style={overlay}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 4 }}>
              Top up J Tokens
            </div>
            {requiredTokens > 0 && (
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>
                You need{' '}
                <strong style={{ color: C.accent }}>{requiredTokens} tokens</strong>
                {' '}to continue
              </div>
            )}
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {/* Pack selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionLabel}>Select amount</div>
          <div style={packsGrid}>
            {packs.map((pack) => {
              const p          = rechargePrice(pack.tokens);
              const isSelected = !useCustom && selected === pack.tokens;
              const covers     = pack.tokens >= requiredTokens;
              return (
                <button
                  key={pack.tokens}
                  onClick={() => { setSelected(pack.tokens); setUseCustom(false); }}
                  style={{
                    ...packBtn,
                    border: isSelected
                      ? `1px solid ${C.accent}`
                      : covers && requiredTokens > 0
                        ? `1px solid rgba(193,125,74,0.3)`
                        : `1px solid ${C.border}`,
                    background: isSelected ? 'rgba(193,125,74,0.1)' : C.surface,
                  }}
                >
                  {/* Token amount */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <WonderCoin size={16} />
                    <span style={{ fontFamily: F.display, fontSize: 22, color: C.text }}>{pack.tokens}</span>
                  </div>

                  {/* Pricing */}
                  {p.pct > 0 ? (
                    <>
                      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, textDecoration: 'line-through', marginBottom: 2 }}>
                        {money(p.base)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: F.sans, fontSize: 14, color: C.text, fontWeight: 600 }}>
                          {money(p.final)}
                        </span>
                        <span style={discountBadge}>{p.pct}% off</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>
                      {money(p.final)}
                    </div>
                  )}

                  {covers && requiredTokens > 0 && !isSelected && (
                    <div style={{ fontFamily: F.sans, fontSize: 10, color: C.accent, marginTop: 4 }}>
                      covers your need
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom amount */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Or enter a custom amount</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <WonderCoin size={14} />
              <input
                type="number"
                min={1}
                value={custom}
                onChange={(e) => { setCustom(e.target.value); setUseCustom(true); }}
                onFocus={() => setUseCustom(true)}
                placeholder="e.g. 250"
                style={{ ...customInput, paddingLeft: 28 }}
              />
            </div>
            {useCustom && tokenAmount > 0 && (
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>
                {rechargePrice(tokenAmount).pct > 0 ? (
                  <>
                    <span style={{ textDecoration: 'line-through', marginRight: 6 }}>
                      {money(rechargePrice(tokenAmount).base)}
                    </span>
                    <span style={{ color: C.text }}>{money(rechargePrice(tokenAmount).final)}</span>
                    <span style={{ ...discountBadge, marginLeft: 6 }}>{rechargePrice(tokenAmount).pct}% off</span>
                  </>
                ) : (
                  money(rechargePrice(tokenAmount).final)
                )}
              </div>
            )}
          </div>
          {pricing.pct > 0 && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginTop: 6 }}>
              {pricing.pct}% discount applied — bulk recharge
            </div>
          )}
        </div>

        {/* Summary */}
        <div style={summary}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>You get</span>
            <WonderCoinAmount amount={tokenAmount || 0} size={18} fontSize={20} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>You pay</span>
            <span style={{ fontFamily: F.sans, fontSize: 20, color: C.text, fontWeight: 600 }}>
              {money(pricing.final)}
            </span>
          </div>
          {pricing.pct > 0 && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: '#8FC88F', marginTop: 6, textAlign: 'right' }}>
              You save {money(pricing.discount)} ({pricing.pct}% off)
            </div>
          )}
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <button
          onClick={handleRecharge}
          disabled={processing || tokenAmount < 1}
          style={{ ...rechargeBtn, opacity: (processing || tokenAmount < 1) ? 0.5 : 1 }}
        >
          {processing ? 'Opening payment…' : `Pay ${money(pricing.final)}`}
        </button>

        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 10 }}>
          1 J Token = {money(rate)} incl. GST · Secure payment via Razorpay
        </div>
      </div>
    </div>
  );
}

// ── STYLES ──────────────────────────────────

const overlay = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(6px)',
  zIndex:     200,
  display:    'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding:    16,
};

const modal = {
  width:        '100%',
  maxWidth:     480,
  background:   '#1A1714',
  border:       `1px solid rgba(193,125,74,0.25)`,
  borderRadius: 14,
  padding:      28,
  boxShadow:    '0 24px 64px rgba(0,0,0,0.5)',
  maxHeight:    '90vh',
  overflowY:    'auto',
};

const closeBtn = {
  background:   'transparent',
  border:       `1px solid rgba(242,235,224,0.1)`,
  color:        '#9B8F83',
  fontSize:     16,
  padding:      '6px 10px',
  borderRadius: 8,
  cursor:       'pointer',
  flexShrink:   0,
};

const sectionLabel = {
  fontFamily:    "'DM Mono', monospace",
  fontSize:      10,
  color:         '#9B8F83',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom:  10,
};

const packsGrid = {
  display:             'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap:                 10,
};

const packBtn = {
  padding:      14,
  borderRadius: 10,
  cursor:       'pointer',
  textAlign:    'left',
  transition:   'border 0.15s',
};

const discountBadge = {
  fontFamily:  "'DM Sans', system-ui, sans-serif",
  fontSize:    10,
  fontWeight:  700,
  color:       '#8FC88F',
  background:  'rgba(100,160,100,0.12)',
  border:      '1px solid rgba(100,160,100,0.3)',
  borderRadius: 4,
  padding:     '2px 6px',
};

const customInput = {
  width:        '100%',
  boxSizing:    'border-box',
  background:   '#100F0C',
  border:       `1px solid rgba(242,235,224,0.08)`,
  color:        '#F2EBE0',
  padding:      '10px 12px',
  borderRadius: 8,
  fontFamily:   "'DM Sans', system-ui, sans-serif",
  fontSize:     14,
  outline:      'none',
};

const summary = {
  background:   '#100F0C',
  border:       `1px solid rgba(242,235,224,0.08)`,
  borderRadius: 10,
  padding:      16,
  marginBottom: 16,
};

const errorBox = {
  background:   'rgba(156,90,90,0.12)',
  border:       '1px solid rgba(156,90,90,0.35)',
  color:        '#D99A9A',
  padding:      10,
  borderRadius: 8,
  marginBottom: 12,
  fontFamily:   "'DM Sans', system-ui, sans-serif",
  fontSize:     13,
};

const rechargeBtn = {
  background:   '#C17D4A',
  border:       'none',
  color:        '#1A1714',
  fontFamily:   "'DM Sans', system-ui, sans-serif",
  fontSize:     15,
  fontWeight:   700,
  padding:      '13px 0',
  borderRadius: 8,
  width:        '100%',
  cursor:       'pointer',
};