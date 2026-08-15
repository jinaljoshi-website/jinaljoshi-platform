import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { C, F } from '../tokens';
import { bestMemberPrice, bestDiscountPct, guestMultiplier } from '../data';
import GuestNudge from '../components/GuestNudge';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';
import Outfits from './Outfits';
import Extras  from './Extras';
import MerchDrop from './MerchDrop';
import PhotoStrip from '../components/PhotoStrip';

export default function Shop() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [topUp,     setTopUp]     = useState(null);
  const [checkout,  setCheckout]  = useState(null); // item being purchased
  const [purchased, setPurchased] = useState([]);
  // Notification links still point at /platform/extras, and Platform redirects those
  // here with ?tab=requests — so the tab has to be readable from the URL.
  const { itemId } = useParams();
  const onOutfitPath = window.location.pathname.includes('/outfits/');

  const [tab, setTab] = useState(() => {
    if (itemId) return onOutfitPath ? 'outfits' : 'merch';
    const t = new URLSearchParams(window.location.search).get('tab');
    return ['merch', 'outfits', 'requests'].includes(t) ? t : 'outfits';
  });

  const load = () => api.get('/api/shop/items')
    .then(setData)
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const itemPrice = (item) => {
    if (!data) return null;
    const { isGuest, discountPct } = data;
    if (isGuest) {
      const mult = guestMultiplier();
      return mult === null ? null : Math.ceil(item.price_coins * mult);
    }
    if (!discountPct) return Math.ceil(item.price_coins);
    return Math.ceil(item.price_coins * (1 - discountPct / 100));
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading shop…</div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Shop</div>
        <h1 style={title}>Official shop</h1>
        <p style={text}>
          One-of-one pieces from set, limited merchandise drops, and things made just for you.
          All purchases in J Tokens.
          {data?.isGuest && bestDiscountPct() > 0 && ` Members get up to ${bestDiscountPct()}% off merchandise.`}
        </p>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 8, opacity: 0.8 }}>
          All purchases are voluntary, final &amp; non-refundable.
        </div>
      </div>

      {/* Two very different things live here: repeatable merchandise, and one-of-one
          pieces sold through the wardrobe. Keeping them apart stops the shop grid
          implying an outfit can be restocked. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'outfits',  label: 'Outfits' },
          { key: 'merch',    label: 'Merchandise' },
          { key: 'requests', label: 'Custom Requests' },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              fontFamily: F.sans, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer',
              background: tab === t.key ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     tab === t.key ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
              color:      tab === t.key ? C.accent : C.muted,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'outfits'  && <Outfits focusId={onOutfitPath ? itemId : null} />}
      {tab === 'requests' && <Extras />}

      {tab === 'merch' && <MerchDrop>
      {/* A top-up only helps when the problem is actually a shortage of tokens.
          Offering it beside "you were signed in on another device" is noise at
          best and misleading at worst. */}
      {error && (
        <div style={errorBox}>
          <span>{error}</span>
          {/insufficient|more tokens|tokens short|balance/i.test(error) && (
            <button onClick={() => setTopUp(0)} style={inlineTopUp}>Top up</button>
          )}
        </div>
      )}
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
              <PhotoStrip images={item.images?.length ? item.images : (item.img_key ? [item.img_key] : [])} alt={item.title} />
              <div style={{ ...stockBadge, color: item.remaining <= 5 ? '#D99A9A' : C.muted, borderColor: item.remaining <= 5 ? 'rgba(156,90,90,0.3)' : C.border }}>
                {outOfStock ? 'Out of stock' : `${item.remaining} remaining`}
              </div>
              <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 4 }}>{item.title}</div>
              {item.description && <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{item.description}</div>}
              <div style={{ marginBottom: 6 }}><WonderCoinAmount amount={price} size={18} /></div>
              {data?.discountPct > 0 && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 4 }}>{data.discountPct}% member discount</div>}
              {data?.isGuest && <GuestNudge compact message={`Members pay ${nudge} tokens with Supreme`} />}
              {!canAfford && !outOfStock && data?.giftedBalance > 0 && (
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#8FC88F', marginBottom: 4, lineHeight: 1.5 }}>
                  Your {data.giftedBalance} gifted tokens are for messages and content — merchandise needs purchased tokens.
                </div>
              )}
              {!canAfford && !outOfStock && (
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#D99A9A', marginBottom: 6 }}>
                  {price - (data?.coinBalance || 0)} tokens short
                </div>
              )}
              {isBought ? (
                <div style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F', padding: '8px 0' }}>✓ Order placed</div>
              ) : (
                // Being short of tokens is not a dead end — it opens the top-up with the
                // exact shortfall. Only genuinely unavailable items stay disabled.
                <button
                  onClick={() => canAfford
                    ? setCheckout(item)
                    : setTopUp(price - (data?.coinBalance || 0))}
                  disabled={outOfStock || price === null}
                  style={{ ...buyBtn, opacity: (outOfStock || price === null) ? 0.5 : 1, cursor: (outOfStock || price === null) ? 'default' : 'pointer', marginTop: 10 }}
                >
                  {outOfStock ? 'Out of stock' : canAfford ? 'Buy now' : 'Top up to buy'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      </MerchDrop>}

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
    country: savedAddress?.country || 'India',
  });

  // Anything other than India means the price shown does not cover getting it
  // there. Said before they pay, not after — a surprise invoice for shipping is
  // the fastest way to turn a good purchase into a complaint.
  const intl = (form.country || '').trim().toLowerCase() !== 'india';
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
          {intl && (
            <div style={intlNote}>
              <strong style={{ color: C.text }}>Shipping outside India</strong>
              <div style={{ marginTop: 4, lineHeight: 1.6 }}>
                The price here covers the item and domestic shipping. International postage and any
                customs duty are not included — we will work out the actual cost and write to you
                with the difference. Nothing is charged automatically, and you can cancel for a full
                refund if it does not suit you. The order ships once that difference is paid.
              </div>
            </div>
          )}

          <Field label="Full name"><input style={inp} value={form.name}    onChange={(e) => set('name', e.target.value)}    placeholder="Your full name" /></Field>
          <Field label="Phone number"><input style={inp} value={form.phone}   onChange={(e) => set('phone', e.target.value)}   placeholder={intl ? 'With country code' : '+91 XXXXX XXXXX'} /></Field>
          <Field label="Address" full><input style={inp} value={form.line1}   onChange={(e) => set('line1', e.target.value)}   placeholder="House / flat / street" /></Field>
          <Field label="City"><input style={inp} value={form.city}    onChange={(e) => set('city', e.target.value)}    placeholder="City" /></Field>
          <Field label={intl ? 'State / region' : 'State'}><input style={inp} value={form.state}   onChange={(e) => set('state', e.target.value)}   placeholder={intl ? 'State or region' : 'State'} /></Field>
          <Field label={intl ? 'Postal code' : 'Pincode'}><input style={inp} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} placeholder={intl ? 'Postal / ZIP code' : '6-digit pincode'} /></Field>
          <Field label="Country" full>
            <input style={inp} value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="India" />
          </Field>
        </div>

        <label style={saveLabel}>
          <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ marginRight: 8 }} />
          Save this address for future orders
        </label>

        <div style={totalRow}>
          <span style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>Total</span>
          <WonderCoinAmount amount={price} size={20} fontSize={22} />
        </div>

        <div style={disclosureBox}>
          <strong style={{ color: C.text }}>Before you order.</strong> Damage claims on physical items
          require a continuous unboxing video, recorded in one take starting before the parcel is opened.
          Limited-edition, personalised and one-of-one items cannot be returned or exchanged for any
          other reason. Full terms in the{' '}
          <a href="/refund" target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>Refund Policy</a>.
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
const intlNote = { gridColumn: '1 / -1', fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 4 };
const inp      = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, padding: '10px 12px', borderRadius: 8, fontFamily: F.sans, fontSize: 13, outline: 'none' };
const saveLabel = { display: 'flex', alignItems: 'center', fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer', marginBottom: 16 };
const totalRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 12 };
const disclosureBox = { fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 8, padding: '10px 12px', marginBottom: 12 };
const placeBtn = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '13px 0', borderRadius: 8, width: '100%', cursor: 'pointer' };