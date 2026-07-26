
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin, WonderCoinAmount } from '../components/WonderCoin';
import { tierPerks, cfgNum } from '../data';

const TIER_META = {
  community: { name: 'Community', color: '#C17D4A', description: 'Entry-level membership with community access and a monthly content unlock.' },
  insider:   { name: 'Insider',   color: '#B8860B', description: 'More messages, more unlocks, and a better discount on every purchase.' },
  premium:   { name: 'Premium',   color: '#9B8F83', description: 'Generous monthly allocations and a significant discount across the platform.' },
  supreme:   { name: 'Supreme',   color: '#C17D4A', description: 'The highest access tier: maximum unlocks, best discount, full DM access.' },
};


const OFFERINGS = [
  { id: 'community',   title: 'Member Community',      text: "A live space where we are one. All of you and me in one community where we interact daily, in real time." },
  { id: 'gallery',     title: 'Exclusive Content',     text: "There's only so much I can post on social media. Extended videos, alternate edits, more photos. Get all of them here. Only here!" },
  { id: 'bts',         title: 'Behind the Scenes',     text: "Experience my life behind the lens when I am shooting in a studio, beach, home or anywhere. Be with me at the shoots!" },
  { id: 'earlyAccess', title: 'Early Access',          text: "Public posts are planned and go live at a pre-decided time. Here, you see what might take a week to come live on social media." },
  { id: 'merchandise', title: 'Official Merchandise',  text: "You get the option to own select merchandise, handcrafted accessories and outfits. Regular drops!" },
  { id: 'extras',      title: 'Personalised Requests', text: "Special days! Get a video from me wishing you or your loved ones on special days." },
  { id: 'messages',    title: 'Direct Messaging',      text: "For those of you who wish to write to me directly. No AI, no representative. You speak with me." },
  { id: 'calls',       title: 'Virtual Connect',       text: "Book an audio or video session with Jinal. Propose a time, subject to your membership tier's call allowance." },
];

const HOW_IT_WORKS = [
  { title: 'J Token',                  text: "A wonderful currency that works inside the platform. Remember tokens from Play Zone? Same thing. One token works for everything: content, calls, messages, merchandise, memberships." },
  { title: 'Membership',               text: "Each item has an associated token value. A membership offers a discounted token price for every item you access. Multiple tiers to choose from. Explore what works best for you." },
  { title: 'No Cash Reward or Refund', text: "Tokens can never be redeemed for cash or refund. In case of a technical issue, get token credits by writing to support. All purchases are voluntary and final." },
  { title: 'Heavy Discounts',          text: "Memberships bring discounts on every purchase. Tokens can also be bought at a discounted price in bulk: 5% off on 500 tokens, 10% off on 1000. Save more, do more." },
];

export default function Homepage() {
  const navigate = useNavigate();

  const tokenRate  = cfgNum('token_rate_inr');
  const tierPrices = {
    community: cfgNum('community_monthly_cost'),
    insider:   cfgNum('insider_monthly_cost'),
    premium:   cfgNum('premium_monthly_cost'),
    supreme:   cfgNum('supreme_monthly_cost'),
  };
  const discountCfg = {
    tier1Threshold: cfgNum('recharge_discount_tier1_threshold'),
    tier1Pct:       cfgNum('recharge_discount_tier1_pct'),
    tier2Threshold: cfgNum('recharge_discount_tier2_threshold'),
    tier2Pct:       cfgNum('recharge_discount_tier2_pct'),
  };

  const tokenPackages = [
    { tokens: 10,   inr: 10   * tokenRate,           label: 'A message or two',   saving: null,    highlight: false },
    { tokens: 50,   inr: 50   * tokenRate,           label: 'A week of chats',    saving: null,    highlight: false },
    { tokens: 100,  inr: 100  * tokenRate,           label: 'Content + messages', saving: null,    highlight: false },
    {
      tokens: discountCfg.tier1Threshold,
      inr: Math.round(discountCfg.tier1Threshold * tokenRate * (1 - discountCfg.tier1Pct / 100)),
      label: 'More for less', saving: `${discountCfg.tier1Pct}% off`, highlight: true,
    },
    {
      tokens: discountCfg.tier2Threshold,
      inr: Math.round(discountCfg.tier2Threshold * tokenRate * (1 - discountCfg.tier2Pct / 100)),
      label: 'Best value', saving: `${discountCfg.tier2Pct}% off`, highlight: true,
    },
  ];

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
          <p style={heroSub}>
            For those who want to be part of my journey beyond social media. Updates, conversations, and moments I only share here.
          </p>
          <div style={privateBadge}>
            Personally run &amp; managed by Jinal Joshi
          </div>

          <div style={offeringsGrid}>
            {OFFERINGS.map((o) => (
              <div key={o.id} style={offeringCard}>
                <div style={offeringTitle}>{o.title}</div>
                <div style={offeringText}>{o.text}</div>
              </div>
            ))}
          </div>

          <p style={disclaimer}>
            Personal Space is an independent platform with optional membership tiers. By creating an account, you confirm that you are 18 years of age or older and agree to our{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={termsLink}>Terms of Use</a>.
            All purchases are voluntary and final.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => navigate('/auth?mode=signup')} style={solidBtnLg}>Choose a plan &amp; join</button>
            <button onClick={() => navigate('/auth?mode=login')}  style={ghostBtnLg}>Already a member</button>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button onClick={() => navigate('/platform/chat')} style={guestLink}>Explore without a membership →</button>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: '#9B8F83', marginTop: 6, opacity: 0.7 }}>
              Guest prices are higher. Membership always gets you more.
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY PERSONAL SPACE ── */}
      <section style={section}>
        <div style={sectionHead}>
          <div style={eyebrow}>Why Personal Space</div>
          <h2 style={sectionTitle}>A Different Kind of Space</h2>
          <p style={{ ...sectionSubtext, maxWidth: 700 }}>
            Most platforms today push creators toward more explicit content and more exposure. Personal Space was built differently. This is personal: a space to share the parts of my journey that don't fit into a public feed, and to actually hear from the people who care to be here. My own world, built on my own terms. And yours, if you choose to be part of it.
          </p>
          <p style={{ fontFamily: F.mono, fontSize: 14, color: '#9B8F83', letterSpacing: '0.06em', fontStyle: 'italic', marginTop: 14 }}>~ Jinal J</p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={section}>
        <div style={sectionHead}>
          <div style={eyebrow}>How it works</div>
          <h2 style={sectionTitle}>Our Own World</h2>
        </div>
        <div style={stepsGrid}>
          {HOW_IT_WORKS.map((h) => (
            <div key={h.title} style={howCard}>
              <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 10 }}>{h.title}</div>
              <div style={{ fontFamily: F.sans, fontSize: 14, color: '#9B8F83', lineHeight: 1.8 }}>{h.text}</div>
            </div>
          ))}
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
            <span style={{ fontFamily: F.sans, fontSize: 13, color: '#9B8F83' }}>Prepaid. No Auto-Renewals.</span>
          </p>
        </div>
        <div style={tiersGrid}>
          {['community', 'insider', 'premium', 'supreme'].map((id) => {
            const meta   = TIER_META[id];
            const tokens = tierPrices[id];
            const inr    = (tokens === null || tokenRate === null) ? null : tokens * tokenRate;
            return (
              <div key={id} style={tierCard}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, marginBottom: 14 }} />
                <div style={{ fontFamily: F.display, fontSize: 26, color: C.text, marginBottom: 6 }}>{meta.name}</div>
                <div style={{ fontFamily: F.sans, fontSize: 13, color: '#9B8F83', marginBottom: 16, lineHeight: 1.6 }}>{meta.description}</div>
                {tokens !== null && (
                  <div style={{ marginBottom: 2 }}>
                    <WonderCoinAmount amount={tokens} size={22} textColor={meta.color} fontSize={28} />
                  </div>
                )}
                {inr !== null && (
                  <div style={{ fontFamily: F.sans, fontSize: 20, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                    ₹{inr.toLocaleString('en-IN')}
                  </div>
                )}
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#9B8F83', marginBottom: 18 }}>
                  per month · prepaid · no auto-renewal
                </div>
                <ul style={perkList}>
                  {tierPerks(id).map((p) => <li key={p}>{p}</li>)}
                </ul>
                <button onClick={() => navigate('/auth?mode=signup')} style={{ ...solidBtn, width: '100%', marginTop: 'auto', background: meta.color }}>
                  Select Tenure
                </button>
              </div>
            );
          })}
        </div>
        <div style={termNote}>
          Quarterly billing = 2.5 months charged, 3 months access. &nbsp;
          Annual billing = 9 months charged, 12 months access.
        </div>
      </section>

      {/* ── TOKEN PRICING TABLE ── */}
      <section style={{ padding: '72px 24px', background: 'rgba(193,125,74,0.04)', borderTop: `1px solid rgba(193,125,74,0.1)`, borderBottom: `1px solid rgba(193,125,74,0.1)` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={sectionHead}>
            <div style={eyebrow}>J Tokens</div>
            <h2 style={sectionTitle}>Simple, transparent pricing</h2>
            <p style={sectionSubtext}>1 J Token = ₹{tokenRate} incl. GST. Buy any amount. The more you buy, the more you save.</p>
          </div>
          <div style={tokenGrid}>
            {tokenPackages.map((pkg) => (
              <div key={pkg.tokens} style={{ ...tokenCard, border: pkg.highlight ? `1px solid rgba(193,125,74,0.4)` : `1px solid rgba(242,235,224,0.08)` }}>
                <div style={{ fontFamily: F.display, fontSize: 34, color: C.text, marginBottom: 4 }}>{pkg.tokens}</div>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.12em', marginBottom: 10 }}>J TOKENS</div>
                <div style={{ fontFamily: F.sans, fontSize: 22, color: C.text, fontWeight: 700, marginBottom: 2 }}>₹{pkg.inr.toLocaleString('en-IN')}</div>
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#9B8F83', marginBottom: 8 }}>incl. GST</div>
                {pkg.saving && <div style={savingBadge}>{pkg.saving}</div>}
                <div style={{ fontFamily: F.sans, fontSize: 11, color: '#9B8F83', marginTop: 8 }}>{pkg.label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: '#6B6560', textAlign: 'center', marginTop: 20 }}>
            All token purchases are voluntary, final, and non-refundable · Tokens never expire · Bulk discounts applied automatically
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={footerWrap}>
        <div style={footerTop}>
          <div style={footerBrand}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <WonderCoin size={20} />
              <span style={{ fontFamily: F.display, fontSize: 18, color: C.text }}>Personal Space</span>
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: '#6B6560', lineHeight: 1.7 }}>
              An independently run platform,<br />personally managed by Jinal Joshi.<br />
              Regd. Office: 1B, 1st Floor, Parinee Crescenzo,<br />G Block, BKC, Bandra East, Mumbai - 400 051
            </div>
          </div>
          <div style={footerLinks}>
            <div style={footerCol}>
              <div style={footerColTitle}>Platform</div>
              <a href="/sitemap" style={footerLink}>What's inside</a>
              <a href="/auth?mode=signup" style={footerLink}>Join now</a>
              <a href="/auth?mode=login" style={footerLink}>Sign in</a>
            </div>
            <div style={footerCol}>
              <div style={footerColTitle}>Legal</div>
              <a href="/terms"    style={footerLink}>Terms of Use</a>
              <a href="/privacy"  style={footerLink}>Privacy Policy</a>
              <a href="/refund"   style={footerLink}>Refund Policy</a>
              <a href="/shipping" style={footerLink}>Shipping Policy</a>
              <a href="/contact"  style={footerLink}>Contact Us</a>
            </div>
            <div style={footerCol}>
              <div style={footerColTitle}>Support</div>
              <a href="mailto:support@jinaljoshi.in" style={footerLink}>support@jinaljoshi.in</a>
              <span style={{ ...footerLink, cursor: 'default' }}>Mumbai, India</span>
              <a href="https://jinaljoshi.in" target="_blank" rel="noopener noreferrer" style={footerLink}>jinaljoshi.in</a>
            </div>
          </div>
        </div>
        <div style={footerBottom}>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: '#6B6560' }}>
            © {new Date().getFullYear()} Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi
          </span>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: '#6B6560' }}>
            Secure, encrypted checkout
          </span>
        </div>
      </footer>
    </div>
  );
}

// ── STYLES ───────────────────────────────────────────────────────────────────
const topBar        = { position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: 'rgba(13,12,10,0.94)', borderBottom: `1px solid rgba(242,235,224,0.08)`, backdropFilter: 'blur(12px)' };
const hero          = { padding: '80px 24px 64px', display: 'flex', justifyContent: 'center' };
const heroInner     = { width: '100%', maxWidth: 1060, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 };
const heroTitle     = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(42px,6vw,80px)', lineHeight: 1.06, color: C.text, margin: 0 };
const heroTagline   = { fontFamily: F.display, fontStyle: 'italic', fontSize: 'clamp(18px,2.5vw,26px)', color: '#9B8F83', margin: 0, lineHeight: 1.6 };
const heroSub       = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.8, maxWidth: 680, margin: 0 };
const privateBadge  = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(193,125,74,0.08)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 999, padding: '6px 16px' };
const offeringsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 14, width: '100%', textAlign: 'left' };
const offeringCard  = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: '18px 20px' };
const offeringTitle = { fontFamily: F.display, fontSize: 20, color: C.text, marginBottom: 8 };
const offeringText  = { fontFamily: F.sans, fontSize: 13, color: '#9B8F83', lineHeight: 1.75 };
const disclaimer    = { fontFamily: F.sans, fontSize: 12, color: '#9B8F83', lineHeight: 1.7, maxWidth: 560, margin: 0, opacity: 0.85 };
const termsLink     = { color: C.accent, textDecoration: 'none' };
const guestLink     = { background: 'none', border: 'none', color: '#9B8F83', fontFamily: F.sans, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 };
const section       = { padding: '72px 24px', maxWidth: 1100, margin: '0 auto' };
const sectionHead   = { textAlign: 'center', marginBottom: 40 };
const eyebrow       = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 };
const sectionTitle  = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,4vw,48px)', color: C.text, margin: '0 0 8px' };
const sectionSubtext = { fontFamily: F.sans, fontSize: 15, color: '#9B8F83', margin: '8px auto 0', maxWidth: 560, lineHeight: 1.8, textAlign: 'center' };
const stepsGrid     = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 };
const howCard       = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: 24 };
const tiersGrid     = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 };
const tierCard      = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: 24, display: 'flex', flexDirection: 'column' };
const perkList      = { fontFamily: F.sans, fontSize: 13, color: '#9B8F83', lineHeight: 1.9, paddingLeft: 18, margin: '0 0 20px', flexGrow: 1 };
const termNote      = { fontFamily: F.sans, fontSize: 12, color: '#9B8F83', textAlign: 'center', marginTop: 20, opacity: 0.75 };
const tokenGrid     = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 };
const tokenCard     = { background: '#0D0C0A', borderRadius: 10, padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const savingBadge   = { fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: '#8FC88F', background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.25)', borderRadius: 4, padding: '3px 8px' };
const solidBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '11px 18px', borderRadius: 8, cursor: 'pointer' };
const solidBtnLg    = { ...solidBtn, padding: '13px 24px', fontSize: 15 };
const ghostBtn      = { background: 'transparent', border: `1px solid rgba(242,235,224,0.15)`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '11px 18px', borderRadius: 8, cursor: 'pointer' };
const ghostBtnLg    = { ...ghostBtn, padding: '13px 24px', fontSize: 15 };
const footerWrap    = { background: '#0A0908', borderTop: `1px solid rgba(242,235,224,0.08)`, padding: '48px 28px 32px' };
const footerTop     = { maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', marginBottom: 40, paddingBottom: 40, borderBottom: `1px solid rgba(242,235,224,0.06)` };
const footerBrand   = { maxWidth: 260 };
const footerLinks   = { display: 'flex', gap: 48, flexWrap: 'wrap' };
const footerCol     = { display: 'flex', flexDirection: 'column', gap: 10 };
const footerColTitle = { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 };
const footerLink    = { fontFamily: F.sans, fontSize: 13, color: '#6B6560', textDecoration: 'none', cursor: 'pointer' };
const footerBottom  = { maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 };