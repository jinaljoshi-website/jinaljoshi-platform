import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { bestMemberPrice } from '../data';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';

export default function Shop() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [topUp,     setTopUp]     = useState(null);
  const [checkout,  setCheckout]  = useState(null); // item being purchased
  const [purchased, setPurchased] = useState([]);

  const load = () => api.get('/api/shop/items')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const itemPrice = (item) => {
    if (!data) return item.price_coins;
    const { isGuest, discountPct } = data;
    if (isGuest) return Math.ceil(item.price_coins * 2);
    if (!discountPct) return Math.ceil(item.price_coins);
    return Math.ceil(item.price_coins * (1 - discountPct / 100));
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading shop…</div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Merchandise</div>
        <h1 style={title}>Official shop</h1>
        <p style={text}>
          Limited drops, outfits and accessories. All purchases in J Tokens.
          {data?.isGuest && ' Members get up to 20% off.'}
        </p>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable.
        </div>
      </div>

      {error   && <div style={errorBox}>{error} <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up</button></div>}
      {success && <div style={successBox}>{success}</div>}

      {/* Balance bar */}
      <div style={balanceBar}>
        <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Your balance</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoinAmount amount={data?.coinBalance || 0} size={16} fontSize={16} />
          <button onClick={() => setTopUp(0)} style={topUpBtn}>Top up</button>
        </div>
      </div>

      <div style={grid}>
        {(!data?.items || data.items.length === 0) && (
          <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14 }}>No items available right now. Check back soon.</div>
        )}
        {data?.items?.map((item) => {
          const price     = itemPrice(item);
          const nudge     = bestMemberPrice(item.price_coins);
          const isBought  = purchased.includes(item.id);
          const outOfStock = item.remaining <= 0;
          const canAfford  = (data?.coinBalance || 0) >= price;

          return (
            <div key={item.id} style={card}>
              {item.img_key && <img src={item.img_key} alt={item.title} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 6, marginBottom: 12 }} />}
              <div style={{ ...stockBadge, color: item.remaining <= 5 ? '#D99A9A' : C.muted, borderColor: item.remaining <= 5 ? 'rgba(156,90,90,0.3)' : C.border }}>
                {outOfStock ? 'Out of stock' : `${item.remaining} remaining`}
              </div>
              <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 4 }}>{item.title}</div>
              {item.description && <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>{item.description}</div>}
              <div style={{ marginBottom: 6 }}><WonderCoinAmount amount={price} size={18} /></div>
              {data?.discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 4 }}>{data.discountPct}% member discount</div>}
              {data?.isGuest && <div style={nudgeStyle}>Members pay <strong style={{ color: C.accent }}>{nudge}</strong> tokens with Supreme</div>}
              {!canAfford && !outOfStock && (
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#D99A9A', marginBottom: 6 }}>
                  Need {price - (data?.coinBalance || 0)} more tokens ·{' '}
                  <button onClick={() => setTopUp(price)} style={{ background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Top up</button>
                </div>
              )}
              {isBought ? (
                <div style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F', padding: '8px 0' }}>✓ Order placed</div>
              ) : (
                <button
                  onClick={() => setCheckout(item)}
                  disabled={outOfStock || !canAfford}
                  style={{ ...buyBtn, opacity: (outOfStock || !canAfford) ? 0.5 : 1, cursor: (outOfStock || !canAfford) ? 'default' : 'pointer', marginTop: 10 }}
                >
                  {outOfStock ? 'Out of stock' : 'Buy now'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Checkout / shipping modal */}
      {checkout && (
        <ShippingModal
          item={checkout}
          price={itemPrice(checkout)}
          savedAddress={data?.savedAddress}
          onClose={() => setCheckout(null)}
          onSuccess={(msg) => {
            setPurchased((prev) => [...prev, checkout.id]);
            setSuccess(msg);
            setCheckout(null);
            load();
          }}
          onTopUp={(amt) => { setCheckout(null); setTopUp(amt); }}
        />
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

function ShippingModal({ item, price, savedAddress, onClose, onSuccess, onTopUp }) {
  const [form, setForm] = useState({
    name:    savedAddress?.name    || '',
    phone:   savedAddress?.phone   || '',
    line1:   savedAddress?.line1   || '',
    city:    savedAddress?.city    || '',
    state:   savedAddress?.state   || '',
    pincode: savedAddress?.pincode || '',
  });
  const [saveAddr,  setSaveAddr]  = useState(false);
  const [placing,   setPlacing]   = useState(false);
  const [error,     setError]     = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const isComplete = form.name && form.phone && form.line1 && form.city && form.state && form.pincode;

  const handlePlace = async () => {
    setError(''); setPlacing(true);
    try {
      const data = await api.post('/api/shop/buy', {
        merchId:     item.id,
        shipping:    form,
        saveAddress: saveAddr,
      });
      onSuccess(data.message);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        onTopUp(price);
      } else {
        setError(err.message);
      }
    } finally { setPlacing(false); }
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 4 }}>Shipping details</div>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>{item.title} · <WonderCoinAmount amount={price} size={13} textColor={C.muted} fontSize={13} /></div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={formGrid}>
          <Field label="Full name"><input style={inp} value={form.name}    onChange={(e) => set('name', e.target.value)}    placeholder="Your full name" /></Field>
          <Field label="Phone number"><input style={inp} value={form.phone}   onChange={(e) => set('phone', e.target.value)}   placeholder="+91 XXXXX XXXXX" /></Field>
          <Field label="Address" full><input style={inp} value={form.line1}   onChange={(e) => set('line1', e.target.value)}   placeholder="House / flat / street" /></Field>
          <Field label="City"><input style={inp} value={form.city}    onChange={(e) => set('city', e.target.value)}    placeholder="City" /></Field>
          <Field label="State"><input style={inp} value={form.state}   onChange={(e) => set('state', e.target.value)}   placeholder="State" /></Field>
          <Field label="Pincode"><input style={inp} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} placeholder="6-digit pincode" /></Field>
        </div>

        <label style={saveLabel}>
          <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ marginRight: 8 }} />
          Save this address for future orders
        </label>

        <div style={totalRow}>
          <span style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>Total</span>
          <WonderCoinAmount amount={price} size={20} fontSize={22} />
        </div>

        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 14, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable.
        </div>

        <button
          onClick={handlePlace}
          disabled={placing || !isComplete}
          style={{ ...placeBtn, opacity: (placing || !isComplete) ? 0.5 : 1 }}
        >
          {placing ? 'Placing order…' : `Place order · ${price} tokens`}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'span 1' }}>
      <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const eyebrow    = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title      = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text       = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const balanceBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', marginBottom: 20 };
const topUpBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' };
const grid       = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16 };
const card       = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column' };
const stockBadge = { fontFamily: F.sans, fontSize: 11, border: '1px solid', borderRadius: 4, padding: '3px 8px', alignSelf: 'flex-start', marginBottom: 10 };
const nudgeStyle = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.15)`, borderRadius: 6, padding: '6px 10px', marginBottom: 4 };
const buyBtn     = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '10px 0', borderRadius: 8, width: '100%' };
const errorBox   = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontFamily: F.sans, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 };
const successBox = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' };

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const modal   = { width: '100%', maxWidth: 500, background: '#1A1714', border: `1px solid rgba(193,125,74,0.25)`, borderRadius: 14, padding: 28, maxHeight: '90vh', overflowY: 'auto' };
const closeBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 16, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' };
const formGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 };
const inp      = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, padding: '10px 12px', borderRadius: 8, fontFamily: F.sans, fontSize: 13, outline: 'none' };
const saveLabel = { display: 'flex', alignItems: 'center', fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer', marginBottom: 16 };
const totalRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 12 };
const placeBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 8, width: '100%', cursor: 'pointer' };