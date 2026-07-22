// ps/src/pages/Shipping.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

export default function Shipping() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoin size={20} />
          <span style={{ fontFamily: F.display, fontSize: 18, color: C.text, cursor: 'pointer' }} onClick={() => navigate('/')}>Personal Space</span>
        </div>
        <button onClick={() => navigate(-1)} style={backBtn}>← Back</button>
      </div>

      <div style={page}>
        <div style={header}>
          <div style={eyebrow}>Legal</div>
          <h1 style={title}>Shipping Policy</h1>
          <p style={subtitle}>How merchandise orders are dispatched and delivered.</p>
          <p style={updated}>Last updated: June 2026</p>
        </div>

        <Section title="Dispatch & delivery">
          <p>Orders for official merchandise placed through Personal Space are shipped via registered domestic courier services or India Post. Orders are dispatched within <strong style={{ color: C.text }}>5 business days</strong> of order confirmation, unless a different timeline is communicated at the time of purchase.</p>
          <p>Once handed over to the courier or postal service, delivery timelines are subject to their own norms and are outside our direct control. Personal Space is not liable for delays caused by the courier or postal authority once an order has been dispatched.</p>
        </Section>

        <Section title="Delivery address & confirmation">
          <p>Merchandise is delivered to the address you provide at checkout. Please double-check your address, phone number, and pincode before confirming an order, incorrect or incomplete details may delay or prevent delivery, and Personal Space is not responsible for non-delivery caused by inaccurate information provided by the buyer.</p>
          <p>A confirmation of your order is sent to the email address associated with your account.</p>
        </Section>

        <Section title="Shipping area">
          <p>Personal Space currently ships merchandise only within India.</p>
        </Section>

        <Section title="Shipping costs">
          <p>Where a shipping charge applies to an order, it is clearly shown before you confirm your purchase. Shipping charges, once paid, are non-refundable, consistent with our general policy that all purchases on Personal Space are final. See our <a href="/refund" style={link}>Refund &amp; Cancellation Policy</a> for full details.</p>
        </Section>

        <Section title="Damaged or incorrect items">
          <p>If a merchandise item arrives damaged or incorrect, this is handled under our Refund &amp; Cancellation Policy rather than repeated here. Please see that policy for how to raise this with us.</p>
        </Section>

        <Section title="Order tracking & issues">
          <p>If you haven't received a dispatch confirmation within the expected timeframe, or have a question about a specific order, please write to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> with your order details.</p>
        </Section>

        <Section title="Contact & grievance officer">
          <p>For shipping-related queries or to raise a grievance:</p>
          <p>
            <strong style={{ color: C.text }}>Email:</strong> <a href="mailto:grievance@jinaljoshi.in" style={link}>grievance@jinaljoshi.in</a><br />
            <strong style={{ color: C.text }}>Response time:</strong> Within 7 business days<br />
            <strong style={{ color: C.text }}>Regd. Office:</strong> Jinal Joshi, 1B, 1st Floor, Parinee Crescenzo, G Block, BKC, Bandra East, Mumbai - 400 051
          </p>
        </Section>

        <div style={footerNote}>Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionWrap}>
      <h2 style={sectionTitle}>{title}</h2>
      <div style={sectionBody}>{children}</div>
    </div>
  );
}

const topBar      = { position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: 'rgba(13,12,10,0.94)', borderBottom: `1px solid rgba(242,235,224,0.08)`, backdropFilter: 'blur(12px)' };
const backBtn     = { background: 'transparent', border: `1px solid rgba(242,235,224,0.08)`, color: '#9B8F83', fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const page        = { maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' };
const header      = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)`, textAlign: 'left' };
const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'left' };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(36px,5vw,56px)', color: C.text, margin: '0 0 16px', textAlign: 'left' };
const subtitle    = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.7, margin: '0 0 10px', textAlign: 'left' };
const updated     = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', margin: 0, textAlign: 'left' };
const sectionWrap = { marginBottom: 40, paddingBottom: 40, borderBottom: `1px solid rgba(242,235,224,0.06)`, textAlign: 'left' };
const sectionTitle = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(22px,3vw,30px)', color: C.text, margin: '0 0 16px', textAlign: 'left' };
const sectionBody = { fontFamily: F.sans, fontSize: 15, color: '#9B8F83', lineHeight: 1.85, textAlign: 'left' };
const link        = { color: C.accent, textDecoration: 'none' };
const footerNote  = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', letterSpacing: '0.08em', textAlign: 'center', marginTop: 48 };