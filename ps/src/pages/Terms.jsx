// ps/src/pages/Terms.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

export default function Terms() {
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
          <h1 style={title}>Terms of Use</h1>
          <p style={subtitle}>Plain language. No legal jargon. Everything you need to know before joining.</p>
          <p style={updated}>Last updated: June 2026</p>
        </div>

        <Section title="Legal notice">
          <p>This document is an electronic record under the Information Technology Act, 2000 and the rules made thereunder, and is published in accordance with Rule 3(1) of the Information Technology (Intermediaries Guidelines) Rules, 2011, which require publishing the rules, privacy policy, and terms of use for a platform such as this one. This is a computer-generated record and does not require any physical or digital signature.</p>
        </Section>

        <Section title="What is Personal Space?">
          <p>Personal Space (ps.jinaljoshi.in) is an independent digital platform run and managed personally by Jinal Joshi, operating as a sole proprietorship registered under GSTIN 27AVBPJ4823E1ZV, with its registered office at B-102, Parinee Crescenzo, G Block, BKC, Bandra East, Mumbai - 400051 (referred to in these Terms as "Platform Owner," "we," "us," or "our"). It is not a multi-artist platform or a fan aggregator. This is Jinal's own space, built for people who want to experience her journey more closely.</p>
          <p>The platform offers exclusive content, direct messaging, virtual call sessions, official merchandise, community interaction, personalised video requests, behind-the-scenes access, and early access to upcoming work. Everything inside the platform is accessed using J Tokens, the platform's internal currency.</p>
          <p>This platform is independently operated. It is not affiliated with any talent agency, management company, or third-party creator network.</p>
          <p>By accessing, browsing, or otherwise using the Platform, you agree to be bound by these Terms of Use in their entirety. If you do not agree, please do not access or use the Platform.</p>
        </Section>

        <Section title="Who can join?">
          <p>Personal Space is an adult-only platform. You must be 18 years of age or older to create an account. By registering, you confirm that you meet this age requirement.</p>
          <p>Registration is voluntary. Nobody is required to join or make any purchase. All membership and token purchases are made entirely of your own free will.</p>
          <p>To access and use the Platform, you agree to provide true, accurate, and complete information during and after registration, and you are responsible for all activity conducted through your registered account.</p>
        </Section>

        <Section title="J Tokens — the platform currency">
          <p>J Tokens are the internal currency of Personal Space. They are used to access everything on the platform: content unlocks, direct messages, call bookings, merchandise purchases, membership plans, personalised requests, and more.</p>
          <p>The price of J Tokens in Indian Rupees (INR) is set by the platform and is displayed in real time on the platform's pricing page and at checkout. The rate includes all applicable taxes. No hidden charges apply.</p>
          <p>Bulk discounts apply automatically when purchasing larger quantities of tokens. The exact thresholds and discount percentages are displayed at the time of purchase.</p>
          <p><strong style={{ color: C.text }}>Tokens are strictly single-use digital utility instruments.</strong> They exist solely within the Personal Space platform and hold no real-world cash value. Tokens cannot be converted back to INR, transferred to another account, traded peer-to-peer, or redeemed for cash under any circumstances. Token balances do not expire.</p>
          <p>Tokens are purchased using Indian Rupees (INR) through our secure, third-party payment gateway partner.</p>
        </Section>

        <Section title="Membership plans">
          <p>Personal Space offers four paid membership tiers. Each tier is prepaid for a chosen duration: monthly, quarterly, or annual. There is no automatic renewal. Your membership ends when the chosen period expires unless you manually renew.</p>
          <p>The four membership tiers, in ascending order of access and benefits, are:</p>
          <ul>
            <li><strong style={{ color: C.text }}>Community</strong> — Entry-level membership with community access, a monthly direct message quota, one content set unlock per month, and a site-wide purchase discount. Current pricing is displayed on the membership page.</li>
            <li><strong style={{ color: C.text }}>Insider</strong> — Enhanced access with a higher monthly message quota, more monthly content unlocks, and a greater site-wide discount. Current pricing is displayed on the membership page.</li>
            <li><strong style={{ color: C.text }}>Premium</strong> — Generous monthly allocations including a significantly higher message quota, more content unlocks, and a substantial site-wide discount. Current pricing is displayed on the membership page.</li>
            <li><strong style={{ color: C.text }}>Supreme</strong> — The highest access tier. Maximum monthly messages, the most content unlocks, and the highest site-wide discount available. Current pricing is displayed on the membership page.</li>
          </ul>
          <p>All membership prices are denominated in J Tokens. The INR equivalent is calculated in real time based on the current token rate and displayed clearly before purchase. Prices may be updated by the platform operator from time to time. The price that applies is the one shown at the time of your purchase.</p>
          <p>Memberships are purchased using J Tokens. Once purchased, a membership grants you the following benefits for the duration of the plan:</p>
          <ul>
            <li>Access to the Community Chat Centre</li>
            <li>A monthly allocation of free Direct Messages (with a daily cap, varying by tier)</li>
            <li>A monthly content set unlock credit (number varies by tier)</li>
            <li>A site-wide discount on all token-priced purchases (percentage varies by tier)</li>
            <li>Access to all content posted to the community feed</li>
          </ul>
          <p>Monthly message quotas and unlock credits reset on the 1st of each calendar month. Unused allocations do not roll over.</p>
          <p>Jinal may, at her discretion, gift memberships to specific users. These gifted memberships carry the same benefits as paid plans for their duration.</p>
        </Section>

        <Section title="All sales are final">
          <p>All digital purchases made on Personal Space, including J Token recharges, membership plans, content unlocks, call bookings, and personalised requests, are <strong style={{ color: C.text }}>final and non-refundable.</strong> Physical merchandise orders follow a separate cancellation and damage-reporting process, set out in full in our <a href="/refund" style={link}>Refund &amp; Cancellation Policy</a>.</p>
          <p>Tokens cannot be refunded once purchased. Memberships cannot be cancelled for a refund once activated.</p>
          <p><strong style={{ color: C.text }}>Technical issues:</strong> If a purchase fails due to a verifiable technical error on the platform's side, you may write to <a href="mailto:billing@jinaljoshi.in" style={link}>billing@jinaljoshi.in</a>. Token credits may be issued at the platform's discretion. Cash refunds are not available under any circumstances.</p>
          <p>By making any purchase, you confirm that the transaction is voluntary and made of your own free will for your own benefit. You agree to pay all charges associated with your use of the Platform's services.</p>
        </Section>

        <Section title="Content and intellectual property">
          <p>All content published on Personal Space, including photos, videos, messages, and any other media, is the intellectual property of Jinal Joshi. This also extends to the Platform's own design, layout, and graphics, which are proprietary to the Platform Owner. You may not download, screenshot, reproduce, share, or distribute any content from the platform without explicit written permission, and you have no claim to any intellectual property rights, title, or interest in it.</p>
          <p>Access to content is granted for personal viewing only. Sharing platform content on social media or any other channel is strictly prohibited and may result in immediate account termination without refund. Unauthorised use of the Platform or its content may also result in action under applicable law.</p>
        </Section>

        <Section title="Direct messaging and calls">
          <p>Direct messages sent through the platform are private conversations between you and Jinal. They are not monitored by third parties. However, the platform retains message records for safety and dispute resolution purposes.</p>
          <p>Call sessions (audio and video) are conducted through the platform. You may not record any call session without explicit consent from Jinal.</p>
          <p>Messaging and call access is subject to fair use. Abusive, threatening, or inappropriate communication will result in immediate account termination.</p>
        </Section>

        <Section title="Merchandise and shipping">
          <p>Merchandise items are shipped to the address provided at the time of purchase. Delivery timelines, shipping areas, and courier handling are set out in full in our <a href="/shipping" style={link}>Shipping Policy</a>.</p>
          <p>Merchandise cancellations, damaged or incorrect items, and applicable token-credit remedies are set out in full in our <a href="/refund" style={link}>Refund &amp; Cancellation Policy</a>, rather than repeated here, so that the current rules always live in one place.</p>
        </Section>

        <Section title="Account and security">
          <p>You are responsible for maintaining the security of your account credentials. Personal Space enforces single-device login for fan accounts: signing in on a new device will end your previous session.</p>
          <p>You may not share your account with another person or allow anyone else to use your account. Accounts found to be shared may be terminated.</p>
          <p>Personal Space reserves the right to suspend or terminate any account that violates these terms, without prior notice and without refund of any token balance.</p>
        </Section>

        <Section title="Privacy">
          <p>Personal Space collects the minimum information required to operate the platform: your email address, date of birth, and any shipping address you choose to provide. Your data is not sold to third parties.</p>
          <p>Payment processing is handled by our secure, third-party payment gateway partner. Personal Space does not store your card or bank details. Please refer to our <a href="/privacy" style={link}>Privacy Policy</a> for full details.</p>
        </Section>

        <Section title="No warranty">
          <p>We do not provide any warranty or guarantee as to the accuracy, timeliness, performance, completeness, or suitability of the information, content, or Services offered on the Platform for any specific purpose. You acknowledge that such information may contain inaccuracies or errors, and your use of the Platform and Services is entirely at your own risk and discretion.</p>
        </Section>

        <Section title="Third-party links">
          <p>The Platform may contain links to third-party websites, including our payment gateway partner. Accessing these links means you will be governed by that third party's own terms of use and privacy policy, provided solely for your convenience and further information. We are not responsible for the content or practices of any third-party website.</p>
        </Section>

        <Section title="Indemnification">
          <p>You agree to indemnify and hold harmless the Platform Owner and any of her associated collaborators, agents, and employees from any claim, demand, or loss, including reasonable legal fees, made by any third party arising out of your breach of these Terms, our Privacy Policy, or any other platform policy, or your violation of any applicable law or any third party's rights.</p>
        </Section>

        <Section title="Force majeure">
          <p>The Platform Owner shall not be liable for any failure or delay in performing an obligation under these Terms where such failure or delay results from a cause beyond her reasonable control.</p>
        </Section>

        <Section title="Governing law">
          <p>These terms are governed by the laws of India. Any disputes arising from the use of this platform shall be subject to the exclusive jurisdiction of the courts of Mumbai, Maharashtra.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>These terms may be updated from time to time, without assigning any reason, and it is your responsibility to periodically review them. Significant changes will be communicated via the platform. Continued use of Personal Space after any update constitutes acceptance of the revised terms.</p>
        </Section>

        <Section title="Contact & grievance officer">
          <p>For support, questions, or disputes:</p>
          <p>
            <strong style={{ color: C.text }}>Email:</strong> <a href="mailto:grievance@jinaljoshi.in" style={link}>grievance@jinaljoshi.in</a><br />
            <strong style={{ color: C.text }}>Response time:</strong> Within 7 business days<br />
            <strong style={{ color: C.text }}>Regd. Office:</strong> Jinal Joshi, 1B, 1st Floor, Parinee Crescenzo, G Block, BKC, Bandra East, Mumbai - 400 051
          </p>
          <p>Personal Space is personally operated by Jinal Joshi and support is handled directly, not by a third-party team.</p>
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