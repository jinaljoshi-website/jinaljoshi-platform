// ps/src/pages/Sitemap.jsx
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';
import { cfgNum } from '../data';

const SECTIONS = [
  {
    title:    'The Community',
    path:     '/platform/community',
    desc:     'A shared live space where everyone — you, other members, and Jinal — can speak freely, share moments, and interact in real time. No algorithms, no noise. Just a genuine space to be present together.',
    features: [
      'Live posts that appear instantly for everyone in the community',
      'Jinal participates directly — no representatives, no filters',
      'Welcome announcements when new members join',
      'Pinned posts for important updates from Jinal',
      'Fair use posting limits to keep the space meaningful',
    ],
    access: 'Community membership and above',
  },
  {
    title:    'Direct Messages',
    path:     '/platform/chat',
    desc:     'Write directly to Jinal. No AI, no team member, no intermediary. A real conversation, at your own pace. Every membership tier includes a monthly quota of free messages — with the option to continue beyond that.',
    features: [
      'Real-time delivery and read receipts',
      'Typing indicators on both sides',
      'Monthly free DM quota included with every membership',
      'Option to send photos and videos (with Jinal\'s permission)',
      'Custom chat backgrounds set by Jinal for your conversation',
    ],
    access: 'All members · Guests can send paid messages',
  },
  {
    title:    'Exclusive Content',
    path:     '/platform/gallery',
    desc:     'Extended photo sets, alternate edits, extended video cuts, and behind-the-scenes shoots — things that don\'t make it to public social media. Each set is curated and uploaded personally.',
    features: [
      'Photo sets and video sets organised by shoot or theme',
      'Monthly unlock credits included with your membership tier',
      'One-time token unlock option for individual sets',
      'Behind-the-scenes and early-access categories',
      'New content added regularly',
    ],
    access: 'Community membership and above · Guests can unlock with tokens',
  },
  {
    title:    'Virtual Connect',
    path:     '/platform/calls',
    desc:     'Request a private audio or video call. Propose a time, and if Jinal confirms, you\'ll get a "Join now" button right here. A real conversation — face to face or voice to voice.',
    features: [
      'Audio and video call options',
      'Priority video for longer, more personal sessions',
      'Primetime pricing during high-demand windows',
      'Camera and microphone tested before booking',
      'Call room created instantly once confirmed',
    ],
    access: 'All members · Token-priced per minute',
  },
  {
    title:    'Official Merchandise',
    path:     '/platform/shop',
    desc:     'Handpicked drops — outfits, accessories, and keepsakes. Limited quantities, shipped to you directly. Member pricing is always better than guest pricing.',
    features: [
      'Limited stock drops with live inventory counts',
      'Shipping address saved for future orders',
      'Order notifications sent to Jinal automatically',
      'Member discount applied site-wide',
    ],
    access: 'All members and guests · Members get discounted pricing',
  },
  {
    title:    'Personalised Requests',
    path:     '/platform/extras',
    desc:     'Ask for something made just for you — a birthday greeting, an anniversary message, a shoutout for someone special. Jinal fulfils these personally after confirming your request.',
    features: [
      'Birthday and anniversary video greetings',
      'Personalised shoutouts for you or a loved one',
      'Custom occasion requests',
      'Tokens charged only after Jinal confirms and fulfils',
      'Submitted requests tracked in your account',
    ],
    access: 'All members and guests',
  },
  {
    title:    'J Tokens',
    path:     '/platform/coins',
    desc:     'The currency of the platform. Buy as many or as few as you need. They never expire. The more you buy at once, the more you save.',
    features: [
      'Current token rate displayed at checkout — always up to date',
      'Bulk discounts apply automatically on larger purchases',
      'Custom amount — buy exactly what you need',
      'Full transaction history in your account',
      'Balance never expires',
    ],
    access: 'Available to all users',
  },
  {
    title:    'Membership',
    path:     '/platform/membership',
    desc:     'Choose the level of access that feels right for you. Every tier unlocks the community, monthly DM credits, content unlocks, and a site-wide discount. No auto-renewals — ever.',
    features: [
      'Four tiers: Community, Insider, Premium, Supreme',
      'Monthly, quarterly, and annual billing options',
      'Prepaid — no automatic charges',
      'Upgrade or extend at any time',
      'Benefits activate the moment you join',
    ],
    access: 'Open to all users',
  },
];

export default function Sitemap() {
  const navigate = useNavigate();
  const rate     = cfgNum('token_rate_inr');
  const t1       = cfgNum('recharge_discount_tier1_threshold');
  const p1       = cfgNum('recharge_discount_tier1_pct');
  const t2       = cfgNum('recharge_discount_tier2_threshold');
  const p2       = cfgNum('recharge_discount_tier2_pct');
  const loading  = rate === null || t1 === null || t2 === null;

  const packages = loading ? [] : [
    { tokens: 10,  discount: 0,        label: 'A message or two' },
    { tokens: 50,  discount: 0,        label: 'A week of chats' },
    { tokens: 100, discount: 0,        label: 'Content + messages' },
    { tokens: t1,  discount: p1 / 100, label: `${p1}% bulk discount`, highlight: true },
    { tokens: t2,  discount: p2 / 100, label: `${p2}% bulk discount`, highlight: true },
  ].map((p) => ({
    ...p,
    inr: Math.round(p.tokens * rate * (1 - p.discount)),
  }));

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
          <div style={eyebrow}>Everything in one place</div>
          <h1 style={title}>What's inside Personal Space</h1>
          <p style={subtitle}>
            A guide to every space, feature, and thing you can do here. Personal Space is built around one idea — giving you real, direct access to Jinal's world. No gatekeeping, no algorithms.
          </p>
        </div>

        <div style={grid}>
          {SECTIONS.map((s, i) => (
            <div key={i} style={card}>
              <div style={cardHeader}>
                <div style={cardTitle}>{s.title}</div>
                <div style={accessBadge}>{s.access}</div>
              </div>
              <p style={cardDesc}>{s.desc}</p>
              <ul style={featureList}>
                {s.features.map((f, j) => <li key={j} style={{ marginBottom: 6 }}>{f}</li>)}
              </ul>
              <button onClick={() => navigate(s.path)} style={visitBtn}>Visit →</button>
            </div>
          ))}
        </div>

        {/* Token pricing table — dynamic */}
        <div style={pricingSection}>
          <div style={eyebrow}>Token pricing</div>
          <h2 style={pricingTitle}>J Token packages</h2>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: '#9B8F83', marginBottom: 8, lineHeight: 1.7 }}>
            Tokens are the currency of Personal Space. Buy any amount — there are no mandatory packages.
            The prices below are calculated in real time at the current rate of{' '}
            <strong style={{ color: C.text }}>1 J Token = ₹{rate} incl. GST</strong>.
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: '#9B8F83', marginBottom: 24, lineHeight: 1.7 }}>
            Bulk discounts apply automatically at checkout — no coupon codes needed.
          </p>

          {loading ? (
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>Loading prices…</div>
          ) : (
            <div style={tokenGrid}>
              {packages.map((pkg) => (
                <div key={pkg.tokens} style={{ ...tokenCard, border: pkg.highlight ? `1px solid rgba(193,125,74,0.4)` : `1px solid rgba(242,235,224,0.08)` }}>
                  <div style={{ fontFamily: F.display, fontSize: 32, color: C.text, marginBottom: 4 }}>{pkg.tokens}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.1em', marginBottom: 8 }}>J TOKENS</div>
                  <div style={{ fontFamily: F.sans, fontSize: 20, color: C.text, fontWeight: 600, marginBottom: 4 }}>₹{pkg.inr.toLocaleString('en-IN')}</div>
                  <div style={{ fontFamily: F.sans, fontSize: 12, color: '#9B8F83' }}>incl. GST</div>
                  {pkg.highlight && (
                    <div style={{ fontFamily: F.sans, fontSize: 11, color: '#8FC88F', marginTop: 8, background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.2)', borderRadius: 4, padding: '3px 8px' }}>
                      {pkg.label}
                    </div>
                  )}
                  {!pkg.highlight && (
                    <div style={{ fontFamily: F.sans, fontSize: 11, color: '#9B8F83', marginTop: 8 }}>{pkg.label}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p style={{ fontFamily: F.sans, fontSize: 12, color: '#6B6560', marginTop: 20, textAlign: 'center' }}>
            Prices update automatically when the platform rate changes ·
            All purchases are voluntary, final &amp; non-refundable ·
            Tokens never expire
          </p>
        </div>

        <div style={footerNote}>Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi</div>
      </div>
    </div>
  );
}

const topBar       = { position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: 'rgba(13,12,10,0.94)', borderBottom: `1px solid rgba(242,235,224,0.08)`, backdropFilter: 'blur(12px)' };
const backBtn      = { background: 'transparent', border: `1px solid rgba(242,235,224,0.08)`, color: '#9B8F83', fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const page         = { maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' };
const header       = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)`, maxWidth: 720 };
const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(32px,5vw,56px)', color: C.text, margin: '0 0 16px' };
const subtitle     = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.75, margin: 0 };
const grid         = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 60 };
const card         = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: 26, display: 'flex', flexDirection: 'column' };
const cardHeader   = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' };
const cardTitle    = { fontFamily: F.display, fontSize: 24, color: C.text };
const accessBadge  = { fontFamily: F.mono, fontSize: 10, color: C.accent, background: 'rgba(193,125,74,0.1)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap', letterSpacing: '0.06em' };
const cardDesc     = { fontFamily: F.sans, fontSize: 14, color: '#9B8F83', lineHeight: 1.75, marginBottom: 16 };
const featureList  = { fontFamily: F.sans, fontSize: 13, color: '#9B8F83', lineHeight: 1.8, paddingLeft: 18, margin: '0 0 20px', flexGrow: 1 };
const visitBtn     = { background: 'transparent', border: `1px solid rgba(242,235,224,0.12)`, color: C.accent, fontFamily: F.sans, fontSize: 13, padding: '9px 16px', borderRadius: 8, cursor: 'pointer', alignSelf: 'flex-start' };
const pricingSection = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 12, padding: '36px 32px', marginBottom: 40 };
const pricingTitle = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(24px,3vw,38px)', color: C.text, margin: '0 0 12px' };
const tokenGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 };
const tokenCard    = { background: '#0D0C0A', borderRadius: 8, padding: '20px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const footerNote   = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', letterSpacing: '0.08em', textAlign: 'center', marginTop: 48 };