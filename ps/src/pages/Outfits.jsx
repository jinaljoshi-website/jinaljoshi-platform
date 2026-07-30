// ps/src/pages/Outfits.jsx
// The Shoot Wardrobe: one live auction at a time, everything else buyable outright.
import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';
import { WonderCoinAmount } from '../components/WonderCoin';
import TopUpModal from '../components/TopUpModal';
import PhotoStrip from '../components/PhotoStrip';

function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds);
  const ref = useRef(seconds);
  useEffect(() => { ref.current = seconds; setLeft(seconds); }, [seconds]);
  useEffect(() => {
    if (seconds === null || seconds === undefined) return;
    const t = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [seconds]);
  if (left === null || left === undefined) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export default function Outfits() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [topUp,    setTopUp]    = useState(null);
  const [checkout, setCheckout] = useState(null);   // { item, mode: 'buy' | 'claim' }
  const [bidAmount, setBidAmount] = useState(null);
  const [consent,   setConsent]   = useState(false);
  const [bidding,   setBidding]   = useState(false);

  const load = () => api.get('/api/shop/auction')
    .then((d) => { setData(d); setBidAmount(null); setConsent(false); })
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);   // bids move; a stale price is worse than a refetch
    return () => clearInterval(poll);
  }, []);

  const live   = data?.items?.find((i) => i.status === 'active') || null;
  const myWin  = data?.items?.find((i) => i.isMyWin && i.status === 'awaiting_payment') || null;
  const queued = (data?.items || []).filter((i) => i.status === 'queued');
  const countdown = useCountdown(live?.secondsRemaining);

  const placeBid = async () => {
    if (!live || !bidAmount) return;
    setError(''); setSuccess(''); setBidding(true);
    try {
      const d = await api.post('/api/shop/auction/bid', {
        itemId: live.id, amount: bidAmount, overBalanceConsent: consent,
      });
      setSuccess(`Bid placed at ${d.currentBid} tokens.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally { setBidding(false); }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading the wardrobe…</div>;

  if (!data?.items?.length) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={eyebrow}>Shoot Wardrobe</div>
        <h2 style={h2}>Outfits</h2>
        <p style={text}>
          Nothing listed right now. Pieces Jinal has worn on a shoot appear here, one at a
          time, with a share of every sale going to a charity you choose.{' '}
          <a href="/outfits" target="_blank" rel="noopener noreferrer" style={link}>How it works →</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={eyebrow}>Shoot Wardrobe</div>
        <h2 style={h2}>Outfits</h2>
        <p style={text}>
          Genuine one-of-one pieces worn on set. A clearly stated share of every sale goes
          to a charity you pick at checkout.
        </p>
        <a href="/outfits" target="_blank" rel="noopener noreferrer" style={howBtn}>
          How the wardrobe works →
        </a>
      </div>

      {error   && <div style={errorBox}>{error}</div>}
      {success && <div style={successBox}>{success}</div>}

      {/* ── Your unclaimed win ── */}
      {myWin && (
        <div style={{ ...featureCard, border: '1px solid rgba(143,200,143,0.4)' }}>
          <div style={{ ...liveTag, background: 'rgba(143,200,143,0.15)', color: '#8FC88F', borderColor: 'rgba(143,200,143,0.4)' }}>You won</div>
          <div style={featureTitle}>{myWin.title}</div>
          <p style={{ ...text, marginBottom: 12 }}>
            Claim it to secure it. You have {data.claimHours} hours from winning, and we will remind you.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <WonderCoinAmount amount={myWin.claimPrice} size={22} fontSize={24} />
            <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>
              incl. {data.handlingFee} handling &amp; packaging
            </span>
            <button onClick={() => setCheckout({ item: myWin, mode: 'claim' })} style={primaryBtn}>Claim it</button>
          </div>
        </div>
      )}

      {/* ── The live auction ── */}
      {live && (
        <div style={featureCard}>
          <div style={liveTag}>Live now{countdown ? ` · ${countdown} left` : ''}</div>
          <PhotoStrip images={live.images?.length ? live.images : (live.img_key ? [live.img_key] : [])} alt={live.title} height={320} />
          <div style={featureTitle}>{live.title}</div>
          {live.description && <p style={{ ...text, marginBottom: 10 }}>{live.description}</p>}
          {live.csrPct != null && (
            <div style={csrPill}>{live.csrPct}% of the proceeds go to a charity you choose</div>
          )}

          <div style={bidRow}>
            <div>
              <div style={smallLabel}>{live.currentBid ? 'Current bid' : 'Bidding opens at'}</div>
              <WonderCoinAmount amount={live.currentBid || live.startingBid} size={26} fontSize={28} />
              {live.isHighBidder && <div style={{ fontFamily: F.sans, fontSize: 12, color: '#8FC88F', marginTop: 4 }}>You are the highest bidder</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={smallLabel}>Buy it outright</div>
              <WonderCoinAmount amount={live.buyNowPrice} size={20} fontSize={22} />
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 4 }}>
                ends the auction · rises with each bid
              </div>
            </div>
          </div>

          {data.isGuest ? (
            <div style={lockedBox}>
              Bidding and buying the live piece are for members. Everything else below is open to
              everyone — or join a membership to take part in the auction.
            </div>
          ) : (
            <>
              <div style={smallLabel}>Place a bid</div>
              {/* With no bid yet there is only one sensible amount — the opening price.
                  Once someone has bid, the increments are what matters. */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {live.currentBid ? (
                  (data.bidIncrements || [5, 10, 20, 50]).map((inc) => {
                    const value = live.currentBid + inc;
                    return (
                      <button key={inc} onClick={() => setBidAmount(value)}
                              style={{ ...chip, ...(bidAmount === value ? chipOn : {}) }}>
                        +{inc} <span style={{ opacity: 0.6 }}>→ {value}</span>
                      </button>
                    );
                  })
                ) : (
                  <button onClick={() => setBidAmount(live.startingBid)}
                          style={{ ...chip, ...(bidAmount === live.startingBid ? chipOn : {}) }}>
                    Open at {live.startingBid}
                  </button>
                )}
              </div>

              {bidAmount !== null && (
                <>
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text, marginBottom: 8 }}>
                    Bidding <strong style={{ color: C.accent }}>{bidAmount}</strong> tokens.
                    {bidAmount + data.handlingFee > data.purchasedBalance && (
                      <span style={{ color: '#D9A45C' }}>
                        {' '}You hold {data.purchasedBalance} — claiming would need{' '}
                        {bidAmount + data.handlingFee - data.purchasedBalance} more.
                      </span>
                    )}
                  </div>
                  {bidAmount + data.handlingFee > data.purchasedBalance && (
                    <label style={consentBox}>
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      <span>
                        I understand this bid is above my balance, and that if I win I must top up
                        to claim. Leaving a winning bid unclaimed suspends bidding on my account.
                      </span>
                    </label>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                <button onClick={placeBid}
                        disabled={bidding || !bidAmount || (bidAmount + data.handlingFee > data.purchasedBalance && !consent)}
                        style={{ ...primaryBtn, opacity: (bidding || !bidAmount || (bidAmount + data.handlingFee > data.purchasedBalance && !consent)) ? 0.5 : 1 }}>
                  {bidding ? 'Placing…' : 'Place bid'}
                </button>
                <button onClick={() => setCheckout({ item: live, mode: 'buy' })} style={ghostBtn}>
                  Buy now for {live.buyNowPrice}
                </button>
              </div>

              <div style={footNote}>
                Tokens are not taken when you bid — only if you win and claim. You need at least{' '}
                {data.minBalanceToBid} tokens to bid, and can bid up to {data.maxBidForYou}.
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Buy outright ── */}
      {queued.length > 0 && (
        <>
          <div style={{ ...smallLabel, marginTop: 28, marginBottom: 10 }}>Available now</div>
          <div style={grid}>
            {queued.map((item) => {
              const affordable = data.purchasedBalance >= item.buyNowPrice + data.handlingFee;
              return (
                <div key={item.id} style={card}>
                  <PhotoStrip images={item.images?.length ? item.images : (item.img_key ? [item.img_key] : [])} alt={item.title} height={180} showThumbs={false} />
                  <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 4 }}>{item.title}</div>
                  {item.description && <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>{item.description}</div>}
                  {item.csrPct != null && <div style={{ ...csrPill, fontSize: 11 }}>{item.csrPct}% to charity</div>}
                  <div style={{ margin: '10px 0 4px' }}><WonderCoinAmount amount={item.buyNowPrice} size={18} /></div>
                  <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 8 }}>
                    listed price · plus {data.handlingFee} handling
                  </div>
                  {!affordable && (
                    <div style={{ fontFamily: F.sans, fontSize: 11, color: '#D99A9A', marginBottom: 6 }}>
                      Need {item.buyNowPrice + data.handlingFee - data.purchasedBalance} more tokens ·{' '}
                      <button onClick={() => setTopUp(item.buyNowPrice + data.handlingFee - data.purchasedBalance)}
                              style={inlineLink}>Top up</button>
                    </div>
                  )}
                  <button onClick={() => setCheckout({ item, mode: 'buy' })} disabled={!affordable}
                          style={{ ...primaryBtn, opacity: affordable ? 1 : 0.5, marginTop: 'auto' }}>
                    Buy now
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {checkout && (
        <OutfitCheckout
          entry={checkout}
          data={data}
          onClose={() => setCheckout(null)}
          onSuccess={(msg) => { setSuccess(msg); setCheckout(null); load(); }}
          onTopUp={(amt) => { setCheckout(null); setTopUp(amt); }}
        />
      )}
      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); load(); }} />
      )}
    </div>
  );
}

function OutfitCheckout({ entry, data, onClose, onSuccess, onTopUp }) {
  const { item, mode } = entry;
  const saved = data.savedAddress || {};
  const [form, setForm] = useState({
    name: saved.name || '', phone: saved.phone || '', line1: saved.line1 || '',
    city: saved.city || '', state: saved.state || '', pincode: saved.pincode || '',
  });
  const [charity,  setCharity]  = useState(data.defaultCharity || (data.charities?.[0]?.key ?? ''));
  const [showName, setShowName] = useState(false);
  const [saveAddr, setSaveAddr] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const complete = form.name && form.phone && form.line1 && form.city && form.state && form.pincode;
  const total = mode === 'claim' ? item.claimPrice : item.buyNowPrice + data.handlingFee;

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const url = mode === 'claim' ? '/api/shop/auction/claim' : '/api/shop/auction/buy-now';
      const d = await api.post(url, {
        itemId: item.id, shipping: form, saveAddress: saveAddr,
        charityKey: charity, displayWinnerName: showName,
      });
      onSuccess(d.message);
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') onTopUp(total);
      else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 24, color: C.text }}>
              {mode === 'claim' ? 'Claim your win' : 'Buy this outfit'}
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginTop: 4 }}>{item.title}</div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={smallLabel}>Choose the charity</div>
        <select value={charity} onChange={(e) => setCharity(e.target.value)} style={{ ...inp, marginBottom: 6 }}>
          {(data.charities || []).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
          {item.csrPct != null ? `${item.csrPct}% of the proceeds` : 'A share of the proceeds'} will be
          donated by Jinal to this charity. You are buying the item — you are not donating directly.
        </div>

        <label style={saveLabel}>
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} style={{ marginRight: 8 }} />
          Show my name when the donation is announced
        </label>

        <div style={smallLabel}>Delivery address</div>
        <div style={formGrid}>
          <F2 label="Full name"><input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} /></F2>
          <F2 label="Phone"><input style={inp} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></F2>
          <F2 label="Address" full><input style={inp} value={form.line1} onChange={(e) => set('line1', e.target.value)} /></F2>
          <F2 label="City"><input style={inp} value={form.city} onChange={(e) => set('city', e.target.value)} /></F2>
          <F2 label="State"><input style={inp} value={form.state} onChange={(e) => set('state', e.target.value)} /></F2>
          <F2 label="Pincode"><input style={inp} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></F2>
        </div>

        <label style={saveLabel}>
          <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ marginRight: 8 }} />
          Save this address for future orders
        </label>

        <div style={totalRow}>
          <span style={{ fontFamily: F.sans, fontSize: 14, color: C.muted }}>Total incl. handling</span>
          <WonderCoinAmount amount={total} size={20} fontSize={22} />
        </div>

        <div style={disclosureBox}>
          <strong style={{ color: C.text }}>One of one.</strong> There is only one of this piece and a
          donation is made against the sale, so it cannot be returned or exchanged. The single exception
          is damage in transit, which requires a continuous unboxing video started before the parcel is
          opened. Full terms in the{' '}
          <a href="/refund" target="_blank" rel="noopener noreferrer" style={{ color: C.accent }}>Refund Policy</a>.
        </div>

        <button onClick={submit} disabled={busy || !complete}
                style={{ ...primaryBtn, width: '100%', opacity: (busy || !complete) ? 0.5 : 1 }}>
          {busy ? 'Working…' : `${mode === 'claim' ? 'Claim' : 'Buy'} · ${total} tokens`}
        </button>
      </div>
    </div>
  );
}

function F2({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'span 1' }}>
      <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 };
const h2          = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(24px,4vw,38px)', margin: '0 0 8px', color: C.text };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 640, margin: 0 };
const link        = { color: C.accent, textDecoration: 'none' };
const howBtn      = { display: 'inline-block', marginTop: 10, fontFamily: F.sans, fontSize: 13, color: C.accent, textDecoration: 'none', border: `1px solid rgba(193,125,74,0.35)`, borderRadius: 999, padding: '7px 16px' };
const smallLabel  = { fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 };
const featureCard = { background: C.surface, border: `1px solid rgba(193,125,74,0.35)`, borderRadius: 12, padding: 22, marginBottom: 20 };
const featureImg  = { width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 8, marginBottom: 14, display: 'block' };
const featureTitle = { fontFamily: F.display, fontSize: 28, color: C.text, marginBottom: 6 };
const liveTag     = { display: 'inline-block', fontFamily: F.mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.accent, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.35)`, borderRadius: 999, padding: '4px 10px', marginBottom: 12 };
const csrPill     = { display: 'inline-block', fontFamily: F.sans, fontSize: 12, color: '#8FC88F', background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.28)', borderRadius: 6, padding: '5px 10px', marginBottom: 10 };
const bidRow      = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', padding: '14px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, margin: '12px 0 14px' };
const chip        = { fontFamily: F.sans, fontSize: 13, color: C.muted, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer' };
const chipOn      = { color: C.accent, borderColor: C.accent, background: 'rgba(193,125,74,0.1)' };
const consentBox  = { display: 'flex', gap: 10, alignItems: 'flex-start', fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, background: 'rgba(217,164,92,0.07)', border: '1px solid rgba(217,164,92,0.28)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, cursor: 'pointer' };
const lockedBox   = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.7, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' };
const footNote    = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.6 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 240px))', gap: 16, justifyContent: 'start' };
const card        = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column' };
const primaryBtn  = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 13, fontWeight: 700, padding: '11px 20px', borderRadius: 8, cursor: 'pointer' };
const ghostBtn    = { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 13, padding: '11px 20px', borderRadius: 8, cursor: 'pointer' };
const inlineLink  = { background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontFamily: F.sans, fontSize: 13 };
const successBox  = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const overlay     = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const modal       = { width: '100%', maxWidth: 520, background: '#1A1714', border: `1px solid rgba(193,125,74,0.25)`, borderRadius: 14, padding: 26, maxHeight: '90vh', overflowY: 'auto' };
const closeBtn    = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 16, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' };
const formGrid    = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 };
const inp         = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, padding: '10px 12px', borderRadius: 8, fontFamily: F.sans, fontSize: 13, outline: 'none' };
const saveLabel   = { display: 'flex', alignItems: 'flex-start', fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer', marginBottom: 14, lineHeight: 1.5 };
const totalRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, marginBottom: 12 };
const disclosureBox = { fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 8, padding: '10px 12px', marginBottom: 14 };