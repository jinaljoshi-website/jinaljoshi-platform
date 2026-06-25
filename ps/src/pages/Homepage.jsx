import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { TIERS, TERMS, termPrice } from '../data';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';

export default function Homepage() {
  const navigate    = useNavigate();
  const paidTiers   = ['community', 'insider', 'premium', 'supreme'].map((id) => TIERS[id]);
  const monthlyTerm = TERMS[0];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>

      {/* ── TOP BAR ── */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoin size={22} />
          <span style={{ fontFamily: F.display, fontSize: 19, color: C.text }}>Personal Space</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => navigate('/auth?mode=login')}  style={ghostBtn}>Sign in</button>
          <button onClick={() => navigate('/auth?mode=signup')} style={solidBtn}>Join now</button>
        </div>
      </div>

      {/* ── HERO ── */}
      <section style={hero}>
        <div style={heroInner}>
          <WonderCoin size={64} />

          <h1 style={heroTitle}>Jinal's Personal Space</h1>

          <p style={heroTagline}>
            A private platform; where I get to celebrate you !
            <br />
            <span style={{ fontFamily: F.mono, fontSize: 14, color: C.muted, letterSpacing: '0.06em' }}>~ Jinal J</span>
          </p>

          <p style={heroSub}>
            For the select few who wish to be a part of my journey and experience my world
            with a special lens. This is not a fan page. This is my space; and yours!
          </p>

          <div style={privateBadge}>
            Personally run & managed by Jinal Joshi · Not a multi-artist platform
          </div>

          {/* Offerings grid */}
          <div style={offeringsGrid}>
            {OFFERINGS.map((o) => (
              <div key={o.id} style={offeringCard}>
                <div style={offeringTitle}>{o.title}</div>
                <div style={offeringText}>{o.text}</div>
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <p style={disclaimer}>
            Personal Space is a private space with voluntary membership options. Creating an account
            confirms that you are an adult and accept the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={termsLink}>
              Terms of Use
            </a>
            . All purchases are final.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => navigate('/auth?mode=signup')} style={solidBtnLg}>
              Choose a plan &amp; join
            </button>
            <button onClick={() => navigate('/auth?mode=login')} style={ghostBtnLg}>
              Already a member
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <button onClick={() => navigate('/auth?mode=signup&guest=true')} style={guestLink}>
              Explore without a membership →
            </button>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6, opacity: 0.7 }}>
              Guest prices are higher. Membership always gets you more.
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={section}>
        <div style={sectionHead}>
          <div style={eyebrow}>How it works</div>
          <h2 style={sectionTitle}>Our Own World</h2>
        </div>
        <div style={stepsGrid}>
          <HowCard
            title="J Token"
            text="A wonderful currency that works inside the platform. Remember tokens from Play Zone? Same thing. One token works for everything — content, calls, messages, merchandise, memberships."
          />
          <HowCard
            title="Membership"
            text="Each item has an associated token value. A membership offers a discounted token price for every item you access. Multiple tiers to choose from. Explore what works best for you."
          />
          <HowCard
            title="No Cash Reward or Refund"
            text="Tokens can never be redeemed for cash or refund. In case of a technical issue, get token credits by writing to support. All purchases are voluntary and final."
          />
          <HowCard
            title="Heavy Discounts"
            text="Memberships bring discounts on every purchase. Tokens can also be bought at a discounted price in bulk — 5% off on 500 tokens, 10% off on 1000. Save more, do more."
          />
        </div>
      </section>

      {/* ── MEMBERSHIP ── */}
      <section style={section}>
        <div style={sectionHead}>
          <div style={eyebrow}>Membership</div>
          <h2 style={sectionTitle}>Choose your access</h2>
          <p style={sectionSubtext}>
            Community &nbsp;|&nbsp; Insider &nbsp;|&nbsp; Premium &nbsp;|&nbsp; Supreme
            <br />
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Prepaid. No Auto-Renewals.</span>
          </p>
        </div>
        <div style={tiersGrid}>
          {paidTiers.map((tier) => (
            <div key={tier.id} style={tierCard}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: tier.color, marginBottom: 14 }} />
              <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6 }}>{tier.name}</div>
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>{tier.description}</div>
              <div style={{ marginBottom: 4 }}>
                <WonderCoinAmount amount={termPrice(tier, monthlyTerm)} size={22} textColor={tier.color} fontSize={28} />
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 18 }}>
                per month · prepaid · no auto-renewal
              </div>
              <ul style={perkList}>
                {TIER_PERKS[tier.id].map((p) => <li key={p}>{p}</li>)}
              </ul>
              <button onClick={() => navigate('/auth?mode=signup')} style={{ ...solidBtn, width: '100%', marginTop: 'auto' }}>
                Select Tenure
              </button>
            </div>
          ))}
        </div>
        <div style={termNote}>
          Quarterly billing = 2.5 months charged, 3 months access. &nbsp;
          Annual billing = 9 months charged, 12 months access.
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={footer}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WonderCoin size={18} />
          <span style={{ fontFamily: F.display, fontSize: 15, color: C.muted }}>
            Personal Space · ps.jinaljoshi.in
          </span>
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'right' }}>
          <a href="/terms" style={{ color: C.muted, textDecoration: 'none', marginRight: 16 }}>Terms of Use</a>
          © {new Date().getFullYear()} ·{' '}
          <a href="https://jinaljoshi.in" target="_blank" rel="noopener noreferrer" style={{ color: C.muted, textDecoration: 'none' }}>
            jinaljoshi.in
          </a>
        </div>
      </footer>
    </div>
  );
}

function HowCard({ title, text }) {
  return (
    <div style={howCard}>
      <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 10 }}>{title}</div>
      <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.8 }}>{text}</div>
    </div>
  );
}

// ── OFFERINGS COPY ───────────────────────────────────────────────────────────

const OFFERINGS = [
  {
    id: 'community',
    title: 'Member Community',
    text: "A live space where we are One! All of you and me in one community where we interact daily. In real time!",
  },
  {
    id: 'merchandise',
    title: 'Official Merchandise',
    text: "You get the option to own select merchandise, handcrafted accessories and outfits. Regular drops!",
  },
  {
    id: 'messages',
    title: 'Direct Messaging',
    text: "For those of you who wish to write to me directly. No AI, No Representative. You speak with me!",
  },
  {
    id: 'calls',
    title: 'Virtual Connect',
    text: "Looking for direct access? Request a call — Audio or Video. Propose a time. Let's connect and allow me to know you better.",
  },
  {
    id: 'extras',
    title: 'Personalised Requests',
    text: "Special days! Get a video from me wishing you or your loved ones on special days.",
  },
  {
    id: 'gallery',
    title: 'Exclusive Content',
    text: "There's only so much I can post on social media. Extended videos, alternate edits, more photos. Get all of them in one place. Only here!",
  },
  {
    id: 'bts',
    title: 'Behind the Scenes',
    text: "Experience my life behind the lens when I am shooting in a studio, beach, home or anywhere. Be with me at the shoots!",
  },
  {
    id: 'earlyAccess',
    title: 'Early Access',
    text: "Public posts are planned and go live at a pre-decided time. Here, you see what might take a week to come live on Social Media.",
  },
];

// ── TIER PERKS ───────────────────────────────────────────────────────────────

const TIER_PERKS = {
  community: [
    'Community Chat Centre',
    '5 free Direct Messages · 2 Per Day max',
    'Unlock any One Set',
    '5% Discount site-wide',
    'All content posted to community',
  ],
  insider: [
    'Community Chat Centre',
    '30 free Direct Messages · 3 Per Day max',
    'Unlock any Four Sets',
    '10% Discount site-wide',
    'All content posted to community',
  ],
  premium: [
    'Community Chat Centre',
    '100 free Direct Messages · 5 Per Day max',
    'Unlock any Seven Sets',
    '15% Discount site-wide',
    'All content posted to community',
  ],
  supreme: [
    'Community Chat Centre',
    '250 free Direct Messages · 10 Per Day max',
    'Unlock any Ten Sets',
    '20% Discount site-wide',
    'All content posted to community',
  ],
};

// ── STYLES ───────────────────────────────────────────────────────────────────

const topBar = {
  position: 'sticky', top: 0, zIndex: 50,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 28px',
  background: 'rgba(13,12,10,0.94)',
  borderBottom: `1px solid ${C.border}`,
  backdropFilter: 'blur(12px)',
};

const hero      = { padding: '80px 24px 64px', display: 'flex', justifyContent: 'center' };
const heroInner = { width: '100%', maxWidth: 1060, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 };

const heroTitle = {
  fontFamily: F.display,
  fontWeight: 300,
  fontSize: 'clamp(42px, 6vw, 80px)',
  lineHeight: 1.06,
  color: C.text,
  margin: 0,
};

const heroTagline = {
  fontFamily: F.display,
  fontStyle: 'italic',
  fontSize: 'clamp(18px, 2.5vw, 26px)',
  color: C.muted,
  margin: 0,
  lineHeight: 1.6,
};

const heroSub = {
  fontFamily: F.sans,
  fontSize: 16,
  color: C.muted,
  lineHeight: 1.8,
  maxWidth: 680,
  margin: 0,
};

const privateBadge = {
  fontFamily: F.mono,
  fontSize: 11,
  color: C.accent,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  background: 'rgba(193,125,74,0.08)',
  border: `1px solid rgba(193,125,74,0.2)`,
  borderRadius: 999,
  padding: '6px 16px',
};

const offeringsGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
  width: '100%',
  textAlign: 'left',
};

const offeringCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '18px 20px',
};

const offeringTitle = { fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 8 };
const offeringText  = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.75 };

const disclaimer = {
  fontFamily: F.sans,
  fontSize: 12,
  color: C.muted,
  lineHeight: 1.7,
  maxWidth: 560,
  margin: 0,
  opacity: 0.85,
};

const termsLink = { color: C.accent, textDecoration: 'none' };

const guestLink = {
  background: 'none', border: 'none', color: C.muted,
  fontFamily: F.sans, fontSize: 13, cursor: 'pointer',
  textDecoration: 'underline', padding: 0,
};

const section     = { padding: '72px 24px', maxWidth: 1100, margin: '0 auto' };
const sectionHead = { textAlign: 'center', marginBottom: 40 };

const eyebrow = {
  fontFamily: F.mono, fontSize: 11, color: C.accent,
  letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10,
};

const sectionTitle = {
  fontFamily: F.display, fontWeight: 300,
  fontSize: 'clamp(28px, 4vw, 48px)', color: C.text, margin: '0 0 8px',
};

const sectionSubtext = {
  fontFamily: F.sans, fontSize: 15, color: C.muted,
  margin: '8px auto 0', maxWidth: 560, lineHeight: 1.8,
  textAlign: 'center',
};

const stepsGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
};

const howCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 24,
};

const tiersGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
};

const tierCard = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
};

const perkList = {
  fontFamily: F.sans, fontSize: 13, color: C.muted,
  lineHeight: 1.9, paddingLeft: 18, margin: '0 0 20px', flexGrow: 1,
};

const termNote = {
  fontFamily: F.sans, fontSize: 12, color: C.muted,
  textAlign: 'center', marginTop: 20, opacity: 0.75,
};

const footer = {
  padding: '32px 28px 48px',
  borderTop: `1px solid ${C.border}`,
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', flexWrap: 'wrap', gap: 12,
};

const solidBtn = {
  background: C.accent, border: 'none', color: '#1A1714',
  fontFamily: F.sans, fontSize: 14, fontWeight: 700,
  padding: '11px 18px', borderRadius: 8, cursor: 'pointer',
};

const solidBtnLg = { ...solidBtn, padding: '13px 24px', fontSize: 15 };

const ghostBtn = {
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.text, fontFamily: F.sans, fontSize: 14,
  padding: '11px 18px', borderRadius: 8, cursor: 'pointer',
};

const ghostBtnLg = { ...ghostBtn, padding: '13px 24px', fontSize: 15 };