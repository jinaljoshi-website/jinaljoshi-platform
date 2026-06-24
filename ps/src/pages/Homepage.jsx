import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import {
  TIERS,
  TERMS,
  termPrice,
  TOKEN_DISCLAIMER,
  TOKEN_RATE_INR,
  FEATURE_LABELS,
  PLATFORM_NAME,
} from '../data';
import { WonderCoin } from '../components/WonderCoin';

export default function Homepage() {
  const navigate = useNavigate();
  const tiers = Object.values(TIERS).filter((t) => t.id !== 'none');
  const featuredTerm = TERMS[0];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={topBar}>
        <div style={{ fontFamily: F.display, fontSize: 20, color: C.text }}>
          {PLATFORM_NAME}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => navigate('/auth?mode=login')} style={ghostBtn}>
            Sign in
          </button>
          <button onClick={() => navigate('/auth?mode=signup')} style={solidBtn}>
            Join now
          </button>
        </div>
      </div>

      <section style={heroSection}>
        <div style={heroInner}>
          <div style={eyebrow}>Member platform</div>

          <h1 style={heroTitle}>
            A closer, structured way
            <br />
            to experience {PLATFORM_NAME}.
          </h1>

          <p style={heroText}>
            An all-in-one fan engagement hub for followers of Jinal Joshi. Access exclusive media,
            join official member community channels, request personalised engagement experiences,
            and redeem official merchandise within a single Wonder Coin-powered platform.
          </p>

          <p style={noticeText}>
            {PLATFORM_NAME} is a private, adult-only digital engagement platform. Creating an
            account confirms you are 18 or older and that you have read and accepted the platform
            terms. Membership is voluntary and all purchases are final.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => navigate('/auth?mode=signup')} style={solidBtnLarge}>
              Create account
            </button>
            <button onClick={() => navigate('/auth?mode=login')} style={ghostBtnLarge}>
              Already a member
            </button>
          </div>
        </div>
      </section>

      <section style={sectionWrap}>
        <div style={sectionHeader}>
          <div style={eyebrow}>Platform overview</div>
          <h2 style={sectionTitle}>Everything in one place</h2>
          <p style={sectionText}>
            {PLATFORM_NAME} brings together content access, community participation, direct creator
            interaction, and member purchases in one secure portal.
          </p>
        </div>

        <div style={featureGrid}>
          <FeatureCard
            title="Exclusive media access"
            text="Unlock curated photo sets, videos, and albums using Wonder Coins inside your member account."
          />
          <FeatureCard
            title="Direct messaging"
            text="Use your membership allocation to begin and maintain direct messaging access inside the platform."
          />
          <FeatureCard
            title="Virtual sessions"
            text="Request audio or video sessions through structured booking flows tied to your platform balance."
          />
          <FeatureCard
            title="Member community"
            text="Participate in official member community spaces based on your active membership tier."
          />
          <FeatureCard
            title="Personalised requests"
            text="Submit shoutouts, greetings, and other custom experiences through guided request options."
          />
          <FeatureCard
            title="Official merchandise"
            text="Redeem selected merchandise offerings within the same platform environment."
          />
        </div>
      </section>

      <section style={sectionWrap}>
        <div style={sectionHeader}>
          <div style={eyebrow}>How it works</div>
          <h2 style={sectionTitle}>Wonder Coins power access</h2>
          <p style={sectionText}>
            Purchase Wonder Coins using your preferred payment method, then use your balance across
            the platform for unlocks, requests, sessions, messaging-related actions, and merchandise.
          </p>
        </div>

        <div style={infoGrid}>
          <div style={infoCard}>
            <div style={infoTitle}>Recharge once</div>
            <div style={infoText}>
              Your card is charged only when you recharge Wonder Coins. Individual platform actions
              are then handled from your coin balance.
            </div>
          </div>

          <div style={infoCard}>
            <div style={infoTitle}>Clear conversion</div>
            <div style={coinLabelRow}>
              <WonderCoin size={22} />
              <span>Wonder Coin</span>
            </div>
            <div style={infoText}>
              1 Wonder Coin = ₹{TOKEN_RATE_INR} incl. GST.
            </div>
          </div>

          <div style={infoCard}>
            <div style={infoTitle}>Platform spending</div>
            <div style={infoText}>
              {TOKEN_DISCLAIMER}
            </div>
          </div>
        </div>
      </section>

      <section style={sectionWrap}>
        <div style={sectionHeader}>
          <div style={eyebrow}>Membership</div>
          <h2 style={sectionTitle}>Choose your tier</h2>
          <p style={sectionText}>
            Membership is prepaid for a fixed term with no automatic renewal. Access ends when the
            term concludes unless you decide to renew manually.
          </p>
        </div>

        <div style={tierGrid}>
          {tiers.map((tier) => (
            <div key={tier.id} style={tierCard}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: tier.color,
                  marginBottom: 16,
                }}
              />
              <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6 }}>
                {tier.name}
              </div>
              <div
                style={{
                  fontFamily: F.sans,
                  color: C.muted,
                  fontSize: 14,
                  lineHeight: 1.7,
                  marginBottom: 16,
                }}
              >
                {tier.description}
              </div>

              <div style={{ ...priceRow, color: tier.color }}>
                <span style={priceValue}>{termPrice(tier, featuredTerm)}</span>
                <WonderCoin size={22} />
              </div>

              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginBottom: 18 }}>
                {featuredTerm.label} · prepaid · no auto-renewal
              </div>

              <ul style={perkList}>
                {tier.perks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>

              <div
                style={{
                  fontFamily: F.sans,
                  fontSize: 12,
                  color: C.muted,
                  lineHeight: 1.7,
                  marginBottom: 18,
                }}
              >
                Monthly messaging and unlock allocations reset on the 1st of each calendar month.
                Unused allocations do not roll over.
              </div>

              <button onClick={() => navigate('/auth?mode=signup')} style={{ ...solidBtn, width: '100%' }}>
                Join {tier.name}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionWrap}>
        <div style={closingCard}>
          <div style={eyebrow}>Access</div>
          <h2 style={{ ...sectionTitle, marginBottom: 14 }}>Create your account to begin</h2>
          <p style={{ ...sectionText, maxWidth: 720, margin: '0 auto 22px' }}>
            Choose your membership, recharge Wonder Coins when needed, and access the full member
            platform in one place.
          </p>

          <div
            style={{
              fontFamily: F.sans,
              fontSize: 13,
              color: C.muted,
              lineHeight: 1.8,
              marginBottom: 24,
            }}
          >
            Available areas include {FEATURE_LABELS.gallery}, {FEATURE_LABELS.community},{' '}
            {FEATURE_LABELS.messages}, {FEATURE_LABELS.calls}, {FEATURE_LABELS.extras}, and{' '}
            {FEATURE_LABELS.shop}.
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/auth?mode=signup')} style={solidBtnLarge}>
              Enter {PLATFORM_NAME}
            </button>
            <button onClick={() => navigate('/auth?mode=login')} style={ghostBtnLarge}>
              Sign in
            </button>
          </div>
        </div>
      </section>

      <footer style={footer}>
        <div style={{ fontFamily: F.display, fontSize: 16, color: C.muted }}>
          {PLATFORM_NAME} · ps.jinaljoshi.in
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>
          © {new Date().getFullYear()} ·{' '}
          <a
            href="https://jinaljoshi.in"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: C.muted, textDecoration: 'none' }}
          >
            jinaljoshi.in
          </a>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, text }) {
  return (
    <div style={featureCard}>
      <div style={{ fontFamily: F.display, fontSize: 24, color: C.text, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.8 }}>
        {text}
      </div>
    </div>
  );
}

const topBar = {
  position: 'sticky',
  top: 0,
  zIndex: 50,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '18px 28px',
  background: 'rgba(13,12,10,0.92)',
  borderBottom: `1px solid ${C.border}`,
  backdropFilter: 'blur(12px)',
};

const heroSection = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '120px 24px 80px',
};

const heroInner = {
  width: '100%',
  maxWidth: 900,
  textAlign: 'center',
};

const sectionWrap = {
  padding: '80px 24px',
  maxWidth: 1120,
  margin: '0 auto',
};

const sectionHeader = {
  textAlign: 'center',
  marginBottom: 42,
};

const eyebrow = {
  fontFamily: F.mono,
  fontSize: 11,
  color: C.accent,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  marginBottom: 12,
};

const heroTitle = {
  fontFamily: F.display,
  fontWeight: 300,
  fontSize: 'clamp(40px, 7vw, 78px)',
  lineHeight: 1.05,
  margin: '0 0 22px',
  color: C.text,
};

const heroText = {
  fontFamily: F.sans,
  fontSize: 16,
  color: C.muted,
  lineHeight: 1.85,
  maxWidth: 760,
  margin: '0 auto 22px',
};

const noticeText = {
  fontFamily: F.sans,
  fontSize: 12,
  color: C.muted,
  lineHeight: 1.8,
  maxWidth: 620,
  margin: '0 auto 30px',
  opacity: 0.85,
};

const sectionTitle = {
  fontFamily: F.display,
  fontWeight: 300,
  fontSize: 'clamp(28px, 4vw, 50px)',
  margin: '0 0 10px',
  color: C.text,
};

const sectionText = {
  fontFamily: F.sans,
  fontSize: 15,
  color: C.muted,
  lineHeight: 1.8,
  maxWidth: 760,
  margin: '0 auto',
};

const featureGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
  gap: 16,
};

const featureCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 24,
};

const infoGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
};

const infoCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 24,
};

const coinLabelRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: F.display,
  fontSize: 22,
  color: C.accent,
  marginBottom: 12,
};

const infoTitle = {
  fontFamily: F.display,
  fontSize: 24,
  color: C.text,
  marginBottom: 10,
};

const infoText = {
  fontFamily: F.sans,
  fontSize: 14,
  color: C.muted,
  lineHeight: 1.8,
};

const tierGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
};

const tierCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 26,
};

const priceRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};

const priceValue = {
  fontFamily: F.display,
  fontSize: 30,
  lineHeight: 1,
};

const perkList = {
  fontFamily: F.sans,
  fontSize: 14,
  color: C.muted,
  lineHeight: 1.9,
  paddingLeft: 18,
  margin: '0 0 18px',
};

const closingCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: '36px 28px',
  textAlign: 'center',
};

const footer = {
  padding: '34px 28px 48px',
  borderTop: `1px solid ${C.border}`,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
};

const solidBtn = {
  background: C.accent,
  border: 'none',
  color: '#1A1714',
  fontFamily: F.sans,
  fontSize: 14,
  fontWeight: 700,
  padding: '12px 18px',
  borderRadius: 8,
  cursor: 'pointer',
};

const ghostBtn = {
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.text,
  fontFamily: F.sans,
  fontSize: 14,
  padding: '12px 18px',
  borderRadius: 8,
  cursor: 'pointer',
};

const solidBtnLarge = {
  ...solidBtn,
  padding: '13px 22px',
};

const ghostBtnLarge = {
  ...ghostBtn,
  padding: '13px 22px',
};