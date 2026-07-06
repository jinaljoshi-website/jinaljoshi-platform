// ps/src/pages/Privacy.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

export default function Privacy() {
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
          <h1 style={title}>Privacy Policy</h1>
          <p style={subtitle}>How your information is collected, used and protected on this platform.</p>
          <p style={updated}>Last updated: June 2026</p>
        </div>

        <Section title="Who we are">
          <p>Personal Space (ps.jinaljoshi.in) is an independent digital platform personally operated by Jinal Joshi. It is not affiliated with any agency, network, or third-party creator platform. When this policy says "we" or "the platform," it refers to this service operated by Jinal Joshi directly.</p>
          <p>If you have any questions about how your data is handled, write to <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>.</p>
        </Section>

        <Section title="What information we collect">
          <p>We collect only what is necessary to operate the platform:</p>
          <ul>
            <li><strong style={{ color: C.text }}>Account information</strong> — your email address, date of birth, and the password you set (stored as a secure hash, we never see it in plain text).</li>
            <li><strong style={{ color: C.text }}>Shipping address</strong> — only if you place a merchandise order and choose to save your address for future use.</li>
            <li><strong style={{ color: C.text }}>Usage data</strong> — token transactions, membership purchases, and content unlocks. This is necessary to maintain your balance and access history.</li>
            <li><strong style={{ color: C.text }}>Device information</strong> — browser type and approximate location, collected automatically when you log in, for security purposes.</li>
            <li><strong style={{ color: C.text }}>Communications</strong> — messages sent through the platform's direct messaging feature are stored to maintain conversation history.</li>
          </ul>
          <p>We do not collect payment card details. All payment processing is handled directly by To Be Updated.</p>
        </Section>

        <Section title="How we use your information">
          <p>Your information is used exclusively to operate and improve the platform:</p>
          <ul>
            <li>To create and maintain your account</li>
            <li>To process token purchases and maintain your balance</li>
            <li>To manage membership access and benefits</li>
            <li>To deliver merchandise orders to the address you provide</li>
            <li>To send push notifications if you have enabled them</li>
            <li>To respond to support requests</li>
            <li>To prevent fraud and maintain platform security</li>
          </ul>
          <p>We do not use your information for advertising. We do not sell your data to third parties. We do not share your data with any marketing or analytics companies.</p>
        </Section>

        <Section title="Payment processing">
          <p>All payments are processed by To Be Updated. Personal Space does not store, process, or transmit your card or bank account details at any point.</p>
          <p>When you make a payment, your financial details are entered directly into our payment processor's secure interface, not stored on our own servers at any point.</p>
        </Section>

        <Section title="Data storage and security">
          <p>Your account data is stored on secured servers hosted by Railway (infrastructure provider) in a region-appropriate data centre. We use industry-standard encryption for data in transit (HTTPS/TLS) and at rest.</p>
          <p>Media files you unlock or that are shared with you via the platform are stored on Cloudflare R2 (object storage). These files are accessible only via authenticated, time-limited URLs.</p>
          <p>While we take all reasonable steps to protect your data, no internet-based service can guarantee absolute security. If you believe your account has been compromised, contact us immediately at <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>.</p>
        </Section>

        <Section title="Data retention">
          <p>We retain your account data for as long as your account is active. If you wish to delete your account and all associated data, write to <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a> and we will process your request within 30 days.</p>
          <p>Transaction records (token purchases, membership history) may be retained for up to 7 years for legal and financial compliance purposes, even after account deletion.</p>
        </Section>

        <Section title="Cookies and tracking">
          <p>Personal Space uses a minimal set of session-based cookies strictly necessary to keep you logged in. We do not use advertising cookies, third-party tracking pixels, or analytics services that profile your behaviour across the web.</p>
        </Section>

        <Section title="Your rights">
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your account and personal data</li>
            <li>Withdraw consent to push notifications at any time (via platform settings or device settings)</li>
          </ul>
          <p>To exercise any of these rights, write to <a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a>.</p>
        </Section>

        <Section title="Children's privacy">
          <p>Personal Space is strictly for adults aged 18 and above. We do not knowingly collect data from anyone under 18. If you believe a minor has registered on the platform, contact us immediately and we will remove the account.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>This policy may be updated periodically. Material changes will be communicated via the platform. Continued use after any update constitutes acceptance of the revised policy.</p>
        </Section>

        <Section title="Contact & grievance officer">
          <p>For privacy-related queries or to raise a grievance:</p>
          <p><strong style={{ color: C.text }}>Email:</strong> <a href="mailto:grievance@jinaljoshi.in" style={link}>grievance@jinaljoshi.in</a><br />
          <strong style={{ color: C.text }}>Response time:</strong> Within 7 business days<br />
          <strong style={{ color: C.text }}>Regd. Office:</strong> Jinal Joshi, 1B, 1st Floor, Parinee Crescenzo, G Block, BKC, Bandra East, Mumbai - 400 051</p>
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