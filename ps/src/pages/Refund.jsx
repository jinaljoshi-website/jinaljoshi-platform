// ps/src/pages/Refund.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

export default function Refund() {
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
          <h1 style={title}>Refund & Cancellation Policy</h1>
          <p style={subtitle}>Please read this carefully before making any purchase on Personal Space.</p>
          <p style={updated}>Last updated: June 2026</p>
        </div>

        <Section title="Our commitment to transparency">
          <p>Personal Space is built on trust. We want every person who joins this space to feel informed and confident about how transactions work here. This policy explains clearly what you are purchasing, why all sales are final, and what recourse is available if something goes wrong on our end.</p>
        </Section>

        <Section title="What J Tokens are">
          <p>J Tokens are single-use digital utility instruments that exist solely within the Personal Space platform. They are used to access digital content, direct messaging, virtual call sessions, merchandise, personalised requests, and membership plans.</p>
          <p><strong style={{ color: C.text }}>J Tokens are not currency.</strong> They cannot be transferred to another account, traded peer-to-peer, withdrawn, or converted back into Indian Rupees or any other currency under any circumstances. They carry no real-world cash value outside of this platform.</p>
          <p>1 J Token = ₹66 incl. GST at the time of purchase. This rate is set by the platform and is subject to change with advance notice.</p>
        </Section>

        <Section title="All sales are final">
          <p>Due to the immediate and consumable nature of digital tokens and the exclusive digital media access they unlock, <strong style={{ color: C.text }}>all purchases on Personal Space are final and non-refundable.</strong> This applies to:</p>
          <ul>
            <li>J Token recharges of any amount</li>
            <li>Membership plan purchases (Community, Insider, Premium, Supreme)</li>
            <li>Content set unlocks</li>
            <li>Direct message charges</li>
            <li>Virtual call bookings</li>
            <li>Merchandise orders</li>
            <li>Personalised video requests</li>
          </ul>
          <p>Once tokens are credited to your account or a service has been activated, no refund will be issued. This policy exists because digital content, once accessed, cannot be "returned."</p>
          <p>By making any purchase, you confirm that the transaction is voluntary, made of your own free will, and that you understand and accept these terms.</p>
        </Section>

        <Section title="Cancellations">
          <p>Membership plans do not auto-renew. There is nothing to cancel — your membership simply expires at the end of the chosen period (monthly, quarterly, or annual). You choose when and if to renew.</p>
          <p>Merchandise orders cannot be cancelled once placed. If you placed an order in error, contact us immediately at <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a> — we will do our best to help if the order has not yet been processed, but cannot guarantee cancellation.</p>
        </Section>

        <Section title="Technical issues — token credits">
          <p>We recognise that technical failures happen. If a purchase fails due to a verifiable error on our platform's side — for example:</p>
          <ul>
            <li>Tokens were deducted but the corresponding service was not delivered</li>
            <li>A call session failed to connect due to a platform fault</li>
            <li>A content unlock was charged but access was not granted</li>
          </ul>
          <p>…you may write to <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a> with the details of the transaction. We will investigate and, where the fault is ours, issue <strong style={{ color: C.text }}>token credits</strong> to your account within 7 business days.</p>
          <p><strong style={{ color: C.text }}>Cash refunds are not available under any circumstances,</strong> including technical issues. Token credits are the only form of remedy available.</p>
        </Section>

        <Section title="Merchandise — damaged or incorrect items">
          <p>If you receive a merchandise item that is damaged or incorrect, write to <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a> with photographic evidence within 48 hours of delivery. We will review the case and arrange a replacement or issue token credits at our discretion.</p>
        </Section>

        <Section title="Chargebacks">
          <p>Initiating a chargeback with your bank for a purchase made on Personal Space — without first raising the issue with our support team — is a violation of these terms. All purchases require explicit consent (including the checkbox acceptance at account creation and at checkout). We retain full records of consent, transaction timestamps, and service delivery logs, and will contest any chargeback with this evidence.</p>
        </Section>

        <Section title="How to raise a grievance">
          <p>If you have a concern about a transaction, contact us at:</p>
          <p>
            <strong style={{ color: C.text }}>Email:</strong> <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a><br />
            <strong style={{ color: C.text }}>Response time:</strong> Within 5 business days<br />
            <strong style={{ color: C.text }}>Address:</strong> Mumbai, India
          </p>
          <p>Please include your registered email address, the date of the transaction, the amount, and a description of the issue. We take every grievance seriously and will respond promptly.</p>
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
const header      = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)` };
const eyebrow     = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12 };
const title       = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(36px,5vw,56px)', color: C.text, margin: '0 0 16px' };
const subtitle    = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.7, margin: '0 0 10px' };
const updated     = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', margin: 0 };
const sectionWrap = { marginBottom: 40, paddingBottom: 40, borderBottom: `1px solid rgba(242,235,224,0.06)` };
const sectionTitle = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(22px,3vw,30px)', color: C.text, margin: '0 0 16px' };
const sectionBody = { fontFamily: F.sans, fontSize: 15, color: '#9B8F83', lineHeight: 1.85 };
const link        = { color: C.accent, textDecoration: 'none' };
const footerNote  = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', letterSpacing: '0.08em', textAlign: 'center', marginTop: 48 };