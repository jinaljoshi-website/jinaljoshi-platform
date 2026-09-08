import { tokenRateInr } from '../data';
import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';
import { api } from '../api';
import TopUpModal from '../components/TopUpModal';
import GuestNudge from '../components/GuestNudge';

async function uploadToR2(file) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context: 'chat_media',
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

const CUSTOM_OPTION = { id: null, title: 'Custom Request', price_coins: null };

export default function Extras() {
  const [data,       setData]       = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);

  const [topic,        setTopic]        = useState('');
  const [details,      setDetails]      = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [refImageFile, setRefImageFile] = useState(null);
  const [refImagePreview, setRefImagePreview] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [offeredPrice, setOfferedPrice] = useState('');
  const [offeredInr, setOfferedInr] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState('email');
  const [deliveryEmail, setDeliveryEmail] = useState('');
  const [deliveryWhatsapp, setDeliveryWhatsapp] = useState('');
  const [consent1, setConsent1] = useState(false);
  const [consent2, setConsent2] = useState(false);
  const [consent3, setConsent3] = useState(false);
  const [consent4, setConsent4] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [topUp,      setTopUp]      = useState(null);
  const [respondingId, setRespondingId] = useState(null);
  const imageRef = useRef(null);

  const load = () => Promise.all([
    api.get('/api/extras/options'),
    api.get('/api/extras/my-requests'),
  ]).then(([optData, reqData]) => {
    setData(optData);
    setMyRequests(reqData.requests || []);
  }).catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  const allConsented = consent1 && consent2 && consent3 && consent4;
  const offeredNum = parseInt(offeredPrice) || 0;
  const canAfford = offeredNum > 0 ? (data?.coinBalance || 0) >= offeredNum : true;
  // Chat has nothing to fill in, so nothing to wait for before the button works.
  const deliveryContactFilled = deliveryChannel === 'chat' ? true
    : deliveryChannel === 'email' ? !!deliveryEmail.trim()
    : !!deliveryWhatsapp.trim();

  const resetForm = () => {
    setSelected(null); setTopic(''); setDetails(''); setReferenceUrl('');
    setRefImageFile(null); setRefImagePreview(''); setDeliveryDate(''); setOfferedPrice('');
    setDeliveryChannel('email'); setDeliveryEmail(''); setDeliveryWhatsapp('');
    setConsent1(false); setConsent2(false); setConsent3(false); setConsent4(false);
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRefImageFile(file);
    setRefImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!selected || !topic.trim() || !details.trim() || !offeredNum || !allConsented || !canAfford) return;
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      let referenceImageUrl = null;
      if (refImageFile) {
        setUploading(true);
        referenceImageUrl = await uploadToR2(refImageFile);
        setUploading(false);
      }

      const res = await api.post('/api/extras/request', {
        extraItemId: selected.id || undefined,
        topic: topic.trim(),
        details: details.trim(),
        referenceUrl: referenceUrl.trim() || null,
        referenceImageUrl,
        expectedDeliveryDate: deliveryDate || null,
        offeredPrice: offeredNum,
        consentAgreed: true,
        deliveryChannel,
        deliveryEmail: deliveryChannel === 'email' ? deliveryEmail.trim() : null,
        deliveryWhatsapp: deliveryChannel === 'whatsapp' ? deliveryWhatsapp.trim() : null,
      });
      setSuccess(res.message);
      resetForm();
      load();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        setTopUp(offeredNum);
      } else {
        setError(err.message);
      }
    } finally { setSubmitting(false); setUploading(false); }
  };

  const respondToCounter = async (requestId, action) => {
    setRespondingId(requestId);
    setError('');
    try {
      const res = await api.post(`/api/extras/requests/${requestId}/respond-to-counter`, { action });
      setSuccess(res.message);
      load();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') {
        setTopUp(null); // amount varies per-request; a generic top-up still helps
      } else {
        setError(err.message);
      }
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Custom requests</div>
        <h2 style={sectionHeading}>Ask Jinal for something</h2>
        <p style={text}>Birthday greetings, anniversary messages, a custom video — browse what Jinal offers below, then send your own request with the details and the price you would like to offer.</p>
      </div>

      {data?.isGuest && <GuestNudge message="You're browsing as a guest — members get discounted rates on custom requests." />}

      {error && (
        <div style={{ ...errorBox, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setTopUp(offeredNum || 10)} style={inlineTopUp}>Top up now</button>
        </div>
      )}
      {success && <div style={successBox}>{success}</div>}

      <div style={grid}>
        {data?.options?.map((option) => {
          const isSelected = selected?.id === option.id;
          return (
            <div key={option.id} onClick={() => { setSelected(isSelected ? null : option); if (!isSelected) setOfferedPrice(String(option.price_coins)); }} style={{ ...card, border: isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`, cursor: 'pointer' }}>
              <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 6 }}>{option.title}</div>
              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 6 }}>Typical price</div>
              <div style={{ marginBottom: 6 }}><WonderCoinAmount amount={option.price_coins} size={18} /></div>
              {isSelected && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 8 }}>✓ Selected — fill in details below</div>}
            </div>
          );
        })}

        <div
          onClick={() => { const isSelected = selected?.id === null; setSelected(isSelected ? null : CUSTOM_OPTION); if (!isSelected) setOfferedPrice(''); }}
          style={{ ...card, border: selected?.id === null ? `1px solid ${C.accent}` : `1px dashed ${C.border}`, cursor: 'pointer', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>✨</div>
          <div style={{ fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 4 }}>Something else?</div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>Create your own custom request</div>
          {selected?.id === null && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, marginTop: 8 }}>✓ Selected — fill in details below</div>}
        </div>
      </div>

      {selected && (
        <div style={detailsPanel}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 16 }}>{selected.title}</div>
          {selected.price_coins === null && (
            <p style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 16, marginTop: -8 }}>
              No preset price — offer whatever feels right for what you're asking.
            </p>
          )}

          <div style={fieldLabel}>Topic</div>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="" style={urlInput} />

          <div style={fieldLabel}>Description</div>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="" style={detailsInput} rows={4} />

          <div style={fieldLabel}>Reference image (optional)</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
            <button onClick={() => imageRef.current?.click()} style={browseBtn}>Browse photo</button>
            {refImagePreview && <img src={refImagePreview} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }} />}
          </div>

          <div style={fieldLabel}>Reference link (optional)</div>
          <input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="" style={{ ...urlInput, marginBottom: 16 }} />

          <div style={fieldLabel}>Expected delivery date (optional)</div>
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={{ ...urlInput, marginBottom: 16 }} />

          {/* Offered in rupees, charged in tokens.
              //
              // Nobody thinks in tokens when deciding what a thing is worth to
              // them; they think in money. So the amount is typed in rupees and
              // the tokens follow, rounded up — a token is the smallest thing
              // that can be spent, so 12.4 of them cannot be offered and asking
              // for 13 is the only honest rounding. */}
          <div style={fieldLabel}>What you would like to offer</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: F.sans, fontSize: 15, color: C.muted }}>₹</span>
              <input type="number" min={1} inputMode="numeric"
                     value={offeredInr}
                     onChange={(e) => {
                       const inr = e.target.value;
                       setOfferedInr(inr);
                       // From the shared pricing config, which is where every
                       // other rupee figure on the platform comes from.
                       const rate = tokenRateInr() || 0;
                       setOfferedPrice(inr && rate ? String(Math.ceil(Number(inr) / rate)) : '');
                     }}
                     style={{ ...urlInput, width: 160, marginBottom: 0 }} />
            </div>
            {offeredPrice > 0 && (
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.accent }}>
                = {offeredPrice} token{offeredPrice === '1' ? '' : 's'}
              </span>
            )}
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6 }}>
            Rounded up to the next whole token. Jinal will review your offer — she may
            approve it, decline it, or counter with a different price.
          </div>

          <div style={fieldLabel}>Where should this be delivered?</div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
              <input type="radio" checked={deliveryChannel === 'email'} onChange={() => setDeliveryChannel('email')} />
              Email
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
              <input type="radio" checked={deliveryChannel === 'whatsapp'} onChange={() => setDeliveryChannel('whatsapp')} />
              WhatsApp
            </label>
            {/* Where they already talk to her, and no address to hand over.
                //
                // The other two ask for an email or a phone number for
                // something that could arrive in the conversation they are
                // already having — and for anything private, sending it to a
                // personal inbox is the part worth hesitating over. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.sans, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
              <input type="radio" checked={deliveryChannel === 'chat'} onChange={() => setDeliveryChannel('chat')} />
              Here, in our chat
            </label>
          </div>
          {deliveryChannel === 'email' ? (
            <input type="email" value={deliveryEmail} onChange={(e) => setDeliveryEmail(e.target.value)} placeholder="you@example.com" style={{ ...urlInput, marginBottom: 16 }} />
          ) : deliveryChannel === 'whatsapp' ? (
            <input type="tel" value={deliveryWhatsapp} onChange={(e) => setDeliveryWhatsapp(e.target.value)} placeholder="e.g. +91 98765 43210" style={{ ...urlInput, marginBottom: 16 }} />
          ) : (
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
              It will arrive in your chat with Jinal. Nothing to fill in.
            </div>
          )}

          <div style={consentBox}>
            <label style={consentLabel}>
              <input type="checkbox" checked={consent1} onChange={(e) => setConsent1(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
              I am not asking for anything that may be categorised as inappropriate.
            </label>
            <label style={{ ...consentLabel, marginTop: 12 }}>
              <input type="checkbox" checked={consent2} onChange={(e) => setConsent2(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
              I understand my request is subject to approval and acceptance.
            </label>
            <label style={{ ...consentLabel, marginTop: 12 }}>
              <input type="checkbox" checked={consent3} onChange={(e) => setConsent3(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
              I understand that if my request is declined, I will get token credits reversed, but they cannot be exchanged for cash again.
            </label>
            <label style={{ ...consentLabel, marginTop: 12 }}>
              <input type="checkbox" checked={consent4} onChange={(e) => setConsent4(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
              I authorize Jinal Joshi and her authorized team to contact me using these channels for queries about the request &amp; delivery.
            </label>
          </div>

          {offeredNum > 0 && !canAfford && (
            <div style={{ ...errorBox, marginBottom: 12 }}>
              {offeredNum - (data?.coinBalance || 0)} tokens short — topping up takes a moment.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            {/* Being short of tokens opens the top-up with the exact difference rather
                than leaving a dead button. Everything else still genuinely blocks. */}
            <button
              onClick={() => canAfford ? handleSubmit() : setTopUp(offeredNum - (data?.coinBalance || 0))}
              disabled={submitting || uploading || !topic.trim() || !details.trim() || !offeredNum || !allConsented || !deliveryContactFilled}
              style={{ ...submitBtn, opacity: (submitting || uploading || !topic.trim() || !details.trim() || !offeredNum || !allConsented || !deliveryContactFilled) ? 0.5 : 1 }}
            >
              {uploading ? 'Uploading image…' : submitting ? 'Sending…' : !canAfford ? 'Top up to send' : 'Send request'}
            </button>
            <button onClick={resetForm} style={cancelBtn}>Cancel</button>
          </div>
        </div>
      )}

      {myRequests.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 14 }}>Your requests</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {myRequests.map((r) => (
              <div key={r.id} style={historyCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: F.sans, fontSize: 14, color: C.text, fontWeight: 600 }}>{r.topic || r.type}</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {r.type} · {r.coins_charged} tokens · {new Date(r.created_at).toLocaleDateString()}
                      {r.expected_delivery_date && ` · needed by ${new Date(r.expected_delivery_date).toLocaleDateString()}`}
                      {r.delivery_channel && ` · via ${r.delivery_channel === 'email' ? r.delivery_email : r.delivery_whatsapp}`}
                    </div>
                  </div>
                  <span style={{ fontFamily: F.sans, fontSize: 12, color: statusColor(r.status), textTransform: 'capitalize' }}>{r.status}</span>
                </div>

                {r.status === 'countered' && (
                  <div style={counterBox}>
                    <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text, marginBottom: 6 }}>
                      Jinal countered with <WonderCoinAmount amount={r.counter_price_coins} size={13} fontSize={13} /> — {r.counter_price_coins - r.coins_charged} tokens more than your offer.
                    </div>
                    {r.counter_note && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 10 }}>"{r.counter_note}"</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => respondToCounter(r.id, 'accept')} disabled={respondingId === r.id} style={{ ...inlineTopUp, opacity: respondingId === r.id ? 0.5 : 1 }}>
                        {respondingId === r.id ? '…' : 'Accept'}
                      </button>
                      <button onClick={() => respondToCounter(r.id, 'decline')} disabled={respondingId === r.id} style={declineBtn}>Decline</button>
                    </div>
                  </div>
                )}

                {r.status === 'rejected' && r.rejection_reason && (
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: '#D99A9A', background: 'rgba(156,90,90,0.08)', border: '1px solid rgba(156,90,90,0.25)', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>
                    Declined by Jinal: {r.rejection_reason}. Your {r.coins_charged} tokens have been credited back to your balance.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); setError(''); load(); }} />
      )}
    </div>
  );
}

function statusColor(status) {
  if (status === 'completed')  return '#8FC88F';
  if (status === 'confirmed')  return '#8FC88F';
  if (status === 'rejected')   return '#D99A9A';
  if (status === 'cancelled')  return '#D99A9A';
  if (status === 'countered')  return '#D9A45C';
  return '#9B8F83';
}

const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const sectionHeading = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(24px,4vw,38px)', margin: '0 0 8px', color: C.text };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,52px)', margin: '0 0 10px' };
const text        = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid        = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 16 };
const card        = { background: C.surface, borderRadius: 10, padding: 22, display: 'flex', flexDirection: 'column', transition: 'border 0.15s' };
const historyCard = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 };
const detailsPanel = { background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 10, padding: 24, marginTop: 8 };
const fieldLabel  = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 8, marginTop: 16 };
const detailsInput = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '12px 14px', borderRadius: 8, outline: 'none', resize: 'vertical', lineHeight: 1.6 };
const urlInput    = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '12px 14px', borderRadius: 8, outline: 'none' };
const browseBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const submitBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 8, flexGrow: 1 };
const cancelBtn   = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 14, padding: '12px 20px', borderRadius: 8, cursor: 'pointer' };
const declineBtn  = { background: 'transparent', border: '1px solid rgba(156,90,90,0.4)', color: '#D99A9A', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 6, cursor: 'pointer' };
const errorBox    = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const successBox  = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const inlineTopUp = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const counterBox  = { background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.25)', borderRadius: 8, padding: 14, marginTop: 12 };
const consentBox   = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginTop: 16, marginBottom: 16 };
const consentLabel = { display: 'flex', alignItems: 'flex-start', fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, cursor: 'pointer' };