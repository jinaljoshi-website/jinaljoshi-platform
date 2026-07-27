// ps/src/pages/Refund.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';
import { cfgNum, cfgStr } from '../data';

export default function Refund() {
  const navigate = useNavigate();
  const address  = cfgStr('legal_registered_address');
  const gstin    = cfgStr('legal_gstin');
  const rate     = cfgNum('token_rate_inr');

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
          <p>Personal Space is operated by Jinal Joshi, a sole proprietorship registered under GSTIN {gstin}, with its registered office at {address}.</p>
          <p>This policy is split into two clearly separate parts, because Personal Space sells two genuinely different kinds of things, digital access (which cannot be "returned" once delivered) and physical merchandise (which can). Please read the part that applies to what you've purchased.</p>
        </Section>

        <Section title="Part A — Digital purchases (tokens, memberships, content, messages, calls)">
          <p>This part covers everything delivered digitally: J Token recharges, membership plans, content set unlocks, direct messages, virtual call bookings, and personalised video requests.</p>
        </Section>

        <Section title="What J Tokens are">
          <p>J Tokens are single-use digital utility instruments that exist solely within the Personal Space platform. They are used to access digital content, direct messaging, calls, merchandise, personalised requests, and membership plans.</p>
          <p><strong style={{ color: C.text }}>J Tokens are not currency.</strong> They cannot be transferred to another account, traded peer-to-peer, withdrawn, or converted back into Indian Rupees or any other currency under any circumstances. They carry no real-world cash value outside of this platform.</p>
          {rate !== null && <p>1 J Token = ₹{rate} incl. GST at the time of purchase. This rate is set by the platform and is subject to change with advance notice.</p>}
        </Section>

        <Section title="All sales are final">
          <p>Due to the immediate and consumable nature of digital tokens and the exclusive digital media access they unlock, <strong style={{ color: C.text }}>all digital purchases on Personal Space are final and non-refundable.</strong> This applies to:</p>
          <ul>
            <li>J Token recharges of any amount</li>
            <li>Membership plan purchases (Community, Insider, Premium, Supreme)</li>
            <li>Content set unlocks</li>
            <li>Direct message charges</li>
            <li>Virtual call bookings</li>
            <li>Personalised video requests</li>
          </ul>
          <p>Once tokens are credited to your account or a service has been activated, no refund will be issued. This policy exists because digital content, once accessed, cannot be "returned." Physical merchandise is handled separately, see Part B below.</p>
          <p>By making any purchase, you confirm that the transaction is voluntary, made of your own free will, and that you understand and accept these terms.</p>
        </Section>

        <Section title="Cancellations">
          <p>Membership plans do not auto-renew. There is nothing to cancel — your membership simply expires at the end of the chosen period (monthly, quarterly, or annual). You choose when and if to renew.</p>
        </Section>

        <Section title="Technical issues — token credits">
          <p>We recognise that technical failures happen. If a purchase fails due to a verifiable error on our platform's side — for example:</p>
          <ul>
            <li>Tokens were deducted but the corresponding service was not delivered</li>
            <li>A call session failed to connect due to a platform fault</li>
            <li>A content unlock was charged but access was not granted</li>
          </ul>
          <p>…you may write to <a href="mailto:billing@jinaljoshi.in" style={link}>billing@jinaljoshi.in</a> with the details of the transaction. We will investigate and, where the fault is ours, issue <strong style={{ color: C.text }}>token credits</strong> to your account within 7 business days.</p>
          <p><strong style={{ color: C.text }}>Cash refunds are not available under any circumstances,</strong> including technical issues. Token credits are the only form of remedy available for digital purchases.</p>
        </Section>

        <Section title="Part B — Physical merchandise">
          <p>Merchandise on Personal Space is purchased using J Tokens you've already bought, not a fresh payment at checkout. Because of this, every remedy below is issued as a <strong style={{ color: C.text }}>token credit back to your balance</strong>, never a cash refund, consistent with how J Tokens work everywhere else on the platform.</p>
        </Section>

        <Section title="Cancelling a merchandise order">
          <p>You may cancel a merchandise order for a full token credit at any time <strong style={{ color: C.text }}>before it has been dispatched</strong>. Once an order has been handed to the courier or postal service, it can no longer be cancelled, you may instead choose to refuse the parcel at the point of delivery.</p>
          <p>To cancel an order before dispatch, write to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> with your order details as soon as possible.</p>
        </Section>

        <Section title="Damaged, defective, or incorrect items">
          <p>If you receive a merchandise item that is damaged, defective, or not what you ordered, write to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> with photographic evidence <strong style={{ color: C.text }}>within 3 days of delivery</strong>. Once reviewed, we will arrange either a replacement (where stock allows) or a full token credit for the item, at your preference.</p>
          <p>Items must be reported unused and, where possible, in their original packaging for a replacement or credit to be issued.</p>
        </Section>

        <Section title="Items not eligible for cancellation or return">
          <p>Merchandise explicitly marked as limited-edition, personalised, or final sale at the time of purchase is not eligible for cancellation, return, or exchange except in cases of genuine damage or defect.</p>
          <p>This includes <strong style={{ color: C.text }}>customised items</strong> — anything made to your specification, such as a mug printed with your chosen photograph and text. Production begins on your instruction and the result cannot be resold, so these cannot be cancelled once production has started.</p>
        </Section>

        <Section title="Part C — One-of-one items (Outfits)">
          <p>Items listed under Outfits are genuine one-of-one pieces worn by Jinal on a shoot. There is exactly one of each. A clearly stated percentage of the proceeds from every such sale is donated by Jinal to a charity chosen by the buyer, and that donation is made once the sale completes.</p>
          <p><strong style={{ color: C.text }}>One-of-one items cannot be cancelled, returned, or exchanged.</strong> Because only a single unit exists and a charitable donation is committed against the sale, the only circumstance in which a remedy is available is an item that arrives damaged.</p>
        </Section>

        <Section title="Damage claims on one-of-one items — unboxing video required">
          <p>To claim for damage on a one-of-one item you must provide an <strong style={{ color: C.text }}>unboxing video</strong>. This is a condition of purchase and is stated again at checkout before payment.</p>
          <p>The recording must be:</p>
          <ul>
            <li>Continuous and unedited, in a single take</li>
            <li>Started <strong style={{ color: C.text }}>before</strong> the parcel is opened, showing the sealed packaging and shipping label</li>
            <li>Continued without interruption through opening the parcel and removing the item</li>
            <li>Clear enough for the reported damage to be visible</li>
          </ul>
          <p>Send it to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> within <strong style={{ color: C.text }}>3 days of delivery</strong>. Without a recording meeting these conditions, a damage claim cannot be assessed, as there is no way to establish whether damage occurred in transit.</p>
          <p>Where a claim is accepted, a token credit for the item is issued to your balance. As only one unit exists, replacement is not possible. The charitable donation associated with the sale is not reversed.</p>
        </Section>

        <Section title="Auction purchases">
          <p>Winning an auction is a commitment to purchase. Tokens are not deducted when you bid, and are only charged when you claim the item you have won.</p>
          <p>If a winning bid is left unclaimed within the stated window, the item is returned to general sale and no charge is made. Repeatedly leaving winning bids unclaimed may result in temporary suspension of access to future auctions, as each unclaimed bid prevented other members from winning.</p>
          <p>Once an auction item is claimed and paid for, the one-of-one terms in Part C apply in full.</p>
        </Section>

        <Section title="Processing time">
          <p>Approved token credits for merchandise cancellations, damage, or defects are applied to your account balance within <strong style={{ color: C.text }}>7 business days</strong> of approval.</p>
        </Section>

        <Section title="Chargebacks">
          <p>Initiating a chargeback with your bank for a purchase made on Personal Space — without first raising the issue with our support team — is a violation of these terms. All purchases require explicit consent (including the checkbox acceptance at account creation and at checkout). We retain full records of consent, transaction timestamps, and service delivery logs, and will contest any chargeback with this evidence.</p>
        </Section>

        <Section title="How to raise a grievance">
          <p>If you have a concern about a transaction, contact us at:</p>
          <p>
            <strong style={{ color: C.text }}>Email:</strong> <a href="mailto:grievance@jinaljoshi.in" style={link}>grievance@jinaljoshi.in</a><br />
            <strong style={{ color: C.text }}>Response time:</strong> Within 5 business days<br />
            <strong style={{ color: C.text }}>Regd. Office:</strong> {address}
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