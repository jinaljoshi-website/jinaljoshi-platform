// ps/src/pages/Terms.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>

      {/* Top bar */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoin size={20} />
          <span style={{ fontFamily: F.display, fontSize: 18, color: C.text }}>Personal Space</span>
        </div>
        <button onClick={() => navigate(-1)} style={backBtn}>← Back</button>
      </div>

      <div style={page}>
        <div style={header}>
          <div style={eyebrow}>Legal</div>
          <h1 style={title}>Terms of Use</h1>
          <p style={subtitle}>
            Plain language. No legal jargon. Everything you need to know before joining.
          </p>
          <p style={updated}>Last updated: June 2026</p>
        </div>

        <Section title="What is Personal Space?">
          <p>
            Personal Space (ps.jinaljoshi.in) is a private digital platform run and managed
            personally by Jinal Joshi. It is not a multi-artist platform or a fan aggregator.
            This is Jinal's own space — built for a select group of people who wish to experience
            her world more closely.
          </p>
          <p>
            The platform offers exclusive content, direct messaging, virtual call sessions,
            official merchandise, community interaction, personalised video requests, behind-the-scenes
            access, and early access to upcoming work. Everything inside the platform is accessed
            using J Tokens — the platform's internal currency.
          </p>
          <p>
            This platform is privately operated. It is not affiliated with any talent agency,
            management company, or third-party creator network.
          </p>
        </Section>

        <Section title="Who can join?">
          <p>
            Personal Space is an adult-only platform. You must be 18 years of age or older to
            create an account. By registering, you confirm that you meet this age requirement.
          </p>
          <p>
            Registration is voluntary. Nobody is required to join or make any purchase. All
            membership and token purchases are made entirely of your own free will.
          </p>
        </Section>

        <Section title="J Tokens — the platform currency">
          <p>
            J Tokens are the internal currency of Personal Space. They are used to access
            everything on the platform — content unlocks, direct messages, call bookings,
            merchandise purchases, membership plans, personalised requests, and more.
          </p>
          <p>
            <strong>1 J Token = ₹66 incl. GST.</strong> This rate is set by the platform and
            applies to all token purchases. Bulk discounts apply automatically:
            5% off on purchases of 500 or more tokens, and 10% off on purchases of 1,000 or more.
          </p>
          <p>
            Tokens are purchased using Indian Rupees (INR) via Razorpay. International payment
            options may be available in the future.
          </p>
          <p>
            <strong>Tokens have no cash value.</strong> They cannot be converted back to INR,
            transferred to another account, or redeemed for cash under any circumstances.
            Token balances do not expire.
          </p>
        </Section>

        <Section title="Membership plans">
          <p>
            Personal Space offers four paid membership tiers: Community, Insider, Premium,
            and Supreme. Each tier is prepaid for a chosen duration — monthly, quarterly,
            or annual. There is no automatic renewal. Your membership ends when the chosen
            period expires unless you manually renew.
          </p>
          <p>
            Memberships are purchased using J Tokens. Once purchased, a membership grants you
            the following benefits for the duration of the plan:
          </p>
          <ul>
            <li>Access to the Community Chat Centre</li>
            <li>A monthly allocation of free Direct Messages (with a daily cap)</li>
            <li>A monthly set unlock credit (varies by tier)</li>
            <li>A site-wide discount on all token-priced purchases (5% to 20% depending on tier)</li>
            <li>Access to all content posted to the community feed</li>
          </ul>
          <p>
            Monthly message quotas and unlock credits reset on the 1st of each calendar month.
            Unused allocations do not roll over.
          </p>
          <p>
            Jinal may, at her discretion, gift free memberships to specific users by email.
            These gifted memberships carry the same benefits as paid plans for their duration.
          </p>
        </Section>

        <Section title="Purchases — all sales are final">
          <p>
            All purchases made on Personal Space — including J Token recharges, membership
            plans, content unlocks, merchandise orders, call bookings, and personalised
            requests — are <strong>final and non-refundable.</strong>
          </p>
          <p>
            Tokens cannot be refunded once purchased. Memberships cannot be cancelled for a
            refund once activated. Merchandise orders cannot be cancelled once placed.
          </p>
          <p>
            <strong>Technical issues:</strong> If a purchase fails due to a verifiable technical
            error on the platform's side (for example, a call that could not connect due to a
            platform fault, or a token deduction that occurred without the corresponding service
            being delivered), you may write to{' '}
            <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>.
            {' '}Token credits may be issued at the platform's discretion. Cash refunds are not
            available under any circumstances.
          </p>
          <p>
            By making any purchase, you confirm that the transaction is voluntary and made of
            your own free will for your own benefit.
          </p>
        </Section>

        <Section title="Content and intellectual property">
          <p>
            All content published on Personal Space — including photos, videos, messages,
            and any other media — is the intellectual property of Jinal Joshi. You may not
            download, screenshot, reproduce, share, or distribute any content from the platform
            without explicit written permission.
          </p>
          <p>
            Access to content is granted for personal viewing only. Sharing platform content
            on social media or any other channel is strictly prohibited and may result in
            immediate account termination without refund.
          </p>
        </Section>

        <Section title="Direct messaging and calls">
          <p>
            Direct messages sent through the platform are private conversations between you
            and Jinal. They are not monitored by third parties. However, the platform retains
            message records for safety and dispute resolution purposes.
          </p>
          <p>
            Call sessions (audio and video) are conducted through the platform using Stream
            Video technology. Session recordings are not made by the platform. You may not
            record any call session without explicit consent from Jinal.
          </p>
          <p>
            Messaging and call access is subject to fair use. Abusive, threatening, or
            inappropriate communication will result in immediate account termination.
          </p>
        </Section>

        <Section title="Merchandise and shipping">
          <p>
            Merchandise items are shipped to the address provided at the time of purchase.
            Delivery timelines are estimates and may vary. The platform is not responsible
            for delays caused by courier services.
          </p>
          <p>
            Merchandise purchases are final. Exchanges may be considered for items received
            in a damaged or incorrect condition — write to{' '}
            <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>{' '}
            with photographic evidence within 48 hours of delivery.
          </p>
        </Section>

        <Section title="Account and security">
          <p>
            You are responsible for maintaining the security of your account credentials.
            Personal Space enforces single-device login — signing in on a new device will
            end your previous session.
          </p>
          <p>
            You may not share your account with another person or allow anyone else to use
            your account. Accounts found to be shared may be terminated.
          </p>
          <p>
            Personal Space reserves the right to suspend or terminate any account that
            violates these terms, without prior notice and without refund of any token balance.
          </p>
        </Section>

        <Section title="Privacy">
          <p>
            Personal Space collects the minimum information required to operate the platform:
            your email address, date of birth, and any shipping address you choose to provide.
            Your data is not sold to third parties.
          </p>
          <p>
            Payment processing is handled by Razorpay. Personal Space does not store your
            card or bank details. Please refer to Razorpay's privacy policy for information
            on how payment data is handled.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            These terms may be updated from time to time. Significant changes will be
            communicated via the platform. Continued use of Personal Space after any update
            constitutes acceptance of the revised terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For support, questions, or disputes, write to{' '}
            <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>.
            Personal Space is personally operated by Jinal Joshi and support is handled
            directly — not by a third-party team.
          </p>
        </Section>

        <div style={footerNote}>
          Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi
        </div>
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

const topBar = {
  position: 'sticky', top: 0, zIndex: 50,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 28px',
  background: 'rgba(13,12,10,0.94)',
  borderBottom: `1px solid rgba(242,235,224,0.08)`,
  backdropFilter: 'blur(12px)',
};

const backBtn = {
  background: 'transparent', border: `1px solid rgba(242,235,224,0.08)`,
  color: '#9B8F83', fontFamily: F.sans, fontSize: 13,
  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
};

const page = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '48px 24px 80px',
};

const header = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)` };

const eyebrow = {
  fontFamily: F.mono, fontSize: 11, color: C.accent,
  letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12,
};

const title = {
  fontFamily: F.display, fontWeight: 300,
  fontSize: 'clamp(36px, 5vw, 56px)', color: C.text, margin: '0 0 16px',
};

const subtitle = {
  fontFamily: F.sans, fontSize: 16, color: '#9B8F83',
  lineHeight: 1.7, margin: '0 0 10px',
};

const updated = {
  fontFamily: F.mono, fontSize: 11, color: '#6B6560', margin: 0,
};

const sectionWrap = { marginBottom: 40, paddingBottom: 40, borderBottom: `1px solid rgba(242,235,224,0.06)` };

const sectionTitle = {
  fontFamily: F.display, fontWeight: 300,
  fontSize: 'clamp(22px, 3vw, 30px)', color: C.text, margin: '0 0 16px',
};

const sectionBody = {
  fontFamily: F.sans, fontSize: 15, color: '#9B8F83',
  lineHeight: 1.85,
};

const link = { color: C.accent, textDecoration: 'none' };

const footerNote = {
  fontFamily: F.mono, fontSize: 11, color: '#6B6560',
  letterSpacing: '0.08em', textAlign: 'center', marginTop: 48,
};