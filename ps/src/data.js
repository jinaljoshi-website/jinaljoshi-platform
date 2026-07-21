// ─────────────────────────────────────────────
// PLATFORM CONSTANTS
// ─────────────────────────────────────────────

export const PLATFORM_NAME      = 'Personal Space';
export const PLATFORM_NAME_FULL = "Jinal Joshi's Personal Space";
export const ARTIST_NAME        = 'Jinal Joshi';
export const TOKEN_RATE_INR     = 66;
export const SUPPORT_EMAIL      = 'support@jinaljoshi.in';

export const TOKEN_DISCLAIMER =
  "J Tokens are the platform's internal currency. Tokens are purchased with INR at ₹66 each. " +
  'All platform actions — content, messages, calls, merchandise, memberships — are priced in tokens. ' +
  'Purchases are final and non-refundable.';

// ─────────────────────────────────────────────
// MEMBERSHIP TIERS
// ─────────────────────────────────────────────

export const TIERS = {
  guest: {
    id: 'guest',
    name: 'Guest',
    color: '#6B6560',
    monthlyTokens: 0,
    freeDMsPerMonth: 0,
    dailyDMCap: 0,
    overageDMCost: 2,
    setUnlocksPerMonth: 0,
    discountPct: 0,
    communityChatCost: 2,
    description: 'Explore without a membership. All prices are 2× the member rate.',
    perks: [
      'Browse the platform',
      'Community chat (2 tokens/day)',
      'Purchase content at 2× price',
    ],
  },
  community: {
    id: 'community',
    name: 'Community',
    color: '#C17D4A',
    monthlyTokens: 10,
    freeDMsPerMonth: 5,
    dailyDMCap: 2,
    overageDMCost: 2,
    setUnlocksPerMonth: 1,
    discountPct: 5,
    communityChatCost: 0,
    description: 'Entry-level membership with community access and a monthly content unlock.',
    perks: [
      'Community chat — free, fair use limits apply',
      '5 free direct messages (2/day cap)',
      '1 set unlock per month',
      '5% discount on all token purchases',
      'Community posts free to view',
    ],
  },
  insider: {
    id: 'insider',
    name: 'Insider',
    color: '#A8834E',
    monthlyTokens: 30,
    freeDMsPerMonth: 30,
    dailyDMCap: 3,
    overageDMCost: 1,
    setUnlocksPerMonth: 4,
    discountPct: 10,
    communityChatCost: 0,
    description: 'More messages, more unlocks, and a better discount on every purchase.',
    perks: [
      'Community chat — free, fair use limits apply',
      '30 free direct messages (3/day cap)',
      '4 set unlocks per month',
      '10% discount on all token purchases',
      'Community posts free to view',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    color: '#8C6B3E',
    monthlyTokens: 75,
    freeDMsPerMonth: 100,
    dailyDMCap: 5,
    overageDMCost: 1,
    setUnlocksPerMonth: 7,
    discountPct: 15,
    communityChatCost: 0,
    description: 'Generous monthly allocations and a significant discount across the platform.',
    perks: [
      'Community chat — free, fair use limits apply',
      '100 free direct messages (5/day cap)',
      '7 set unlocks per month',
      '15% discount on all token purchases',
      'Community posts free to view',
    ],
  },
  supreme: {
    id: 'supreme',
    name: 'Supreme',
    color: '#9C5A5A',
    monthlyTokens: 150,
    freeDMsPerMonth: 250,
    dailyDMCap: 10,
    overageDMCost: 1,
    setUnlocksPerMonth: 10,
    discountPct: 20,
    communityChatCost: 0,
    description: 'The highest access tier — maximum unlocks, best discount, full DM access.',
    perks: [
      'Community chat — free, fair use limits apply',
      '250 free direct messages (10/day cap)',
      '10 set unlocks per month',
      '20% discount on all token purchases',
      'Community posts free to view',
    ],
  },
};

export const PAID_TIER_IDS = ['community', 'insider', 'premium', 'supreme'];
export const ALL_TIER_IDS  = ['guest', ...PAID_TIER_IDS];

// ─────────────────────────────────────────────
// BILLING TERMS
// ─────────────────────────────────────────────

export const TERMS = [
  { id: 'monthly',   label: 'Monthly',   months: 1,  billingMonths: 1,   savingLabel: null },
  { id: 'quarterly', label: 'Quarterly', months: 3,  billingMonths: 2.5, savingLabel: 'Save 15 days' },
  { id: 'annual',    label: 'Annual',    months: 12, billingMonths: 9,   savingLabel: 'Save 3 months' },
];

// ─────────────────────────────────────────────
// MEMBERSHIP PRICING HELPERS
// ─────────────────────────────────────────────

export function membershipCost(tierId, termId) {
  const tier = TIERS[tierId];
  const term = TERMS.find((t) => t.id === termId);
  if (!tier || !term) return 0;
  return Math.round(tier.monthlyTokens * term.billingMonths);
}

// Legacy alias used by Membership.jsx
export function termPrice(tier, term) {
  if (!tier || !term) return 0;
  return Math.round(tier.monthlyTokens * term.billingMonths);
}

export function applyDiscount(baseTokens, discountPct) {
  if (!discountPct) return baseTokens;
  const raw = baseTokens * (1 - discountPct / 100);
  return raw % 1 >= 0.5 ? Math.ceil(raw) : Math.floor(raw);
}

export function guestPrice(baseTokens) {
  return baseTokens * 2;
}

export function bestMemberPrice(baseTokens) {
  return applyDiscount(baseTokens, TIERS.supreme.discountPct);
}

export function upgradeCost(oldTierId, newTierId, daysRemaining) {
  const oldMonthly = TIERS[oldTierId]?.monthlyTokens || 0;
  const newMonthly = TIERS[newTierId]?.monthlyTokens || 0;
  const rawCredit  = (oldMonthly / 30) * daysRemaining;
  const credit     = rawCredit % 1 >= 0.5 ? Math.ceil(rawCredit) : Math.floor(rawCredit);
  return Math.max(0, newMonthly - credit);
}

// ─────────────────────────────────────────────
// COMMUNITY CHAT
// ─────────────────────────────────────────────

export const COMMUNITY_CHAT = {
  paidMemberCost: 0,
  guestCostPerDay: 2,
  maxPerHour: 25,
  maxPerDay: 50,
};

// ─────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────

export const COMMUNITY_POST_GUEST_PRICE = 5;

export const OFFERING_CATEGORIES = [
  { id: 'access',      label: 'Access',          subtitle: 'Chat & Calls' },
  { id: 'merchandise', label: 'Merchandise',      subtitle: 'Outfits, Drops & Accessories' },
  { id: 'content',     label: 'Content',          subtitle: 'BTS, Videos, Photos & Albums' },
  { id: 'greetings',   label: 'Custom Greetings', subtitle: 'Birthday, Anniversary & Special Moments' },
];

// ─────────────────────────────────────────────
// HOMEPAGE
// ─────────────────────────────────────────────

export const HOMEPAGE_OFFERINGS = [
  { id: 'community',   title: 'Member Community',      text: 'A live space where members and Jinal interact freely. Ask, share, react — in real time.' },
  { id: 'merchandise', title: 'Official Merchandise',  text: 'Outfits, accessories and limited drops — available exclusively to members first.' },
  { id: 'messages',    title: 'Direct Messaging',      text: 'Your membership includes a monthly DM quota with a daily cap. Go over? One token per message.' },
  { id: 'calls',       title: 'Virtual Sessions',      text: 'Book a private audio or video call. Token-priced, member-discounted.' },
  { id: 'extras',      title: 'Personalised Requests', text: 'Custom video greetings for birthdays, anniversaries, or any moment worth celebrating.' },
  { id: 'gallery',     title: 'Exclusive Content',     text: 'BTS footage, extended cuts, photo sets and albums — unlockable with monthly credits or tokens.' },
  { id: 'bts',         title: 'Behind the Scenes',     text: "What happens off-camera, on set, and in between. A side of Jinal you won't see anywhere else." },
  { id: 'earlyAccess', title: 'Early Access',          text: 'First look at upcoming projects, drops, and announcements before they go public.' },
];

export const FEATURE_LABELS = {
  community:   'member community',
  merchandise: 'official merchandise',
  messages:    'direct messaging',
  calls:       'virtual sessions',
  extras:      'personalised requests',
  gallery:     'exclusive media access',
  bts:         'behind the scenes',
  earlyAccess: 'early access',
};

// ─────────────────────────────────────────────
// GALLERY SETS
// ─────────────────────────────────────────────

export const GALLERY_SETS = [
  { id: 'set-001', title: 'Golden Hour Portraits',   type: 'Photo set', mode: 'Unlock once',  price_coins: 12, minTier: 'community', useUnlockCredit: true },
  { id: 'set-002', title: 'Studio Film Snippets',    type: 'Video',     mode: 'Members only', price_coins: 18, minTier: 'insider',   useUnlockCredit: true },
  { id: 'set-003', title: 'Behind the Scenes Album', type: 'Album',     mode: 'Unlock once',  price_coins: 15, minTier: 'community', useUnlockCredit: true },
];

// ─────────────────────────────────────────────
// CALLS
// ─────────────────────────────────────────────

export const CALL_OPTIONS = [
  { id: 'audio',          title: 'Audio Call',     description: 'A private audio session for direct conversation.',        coinsPerMin: 8  },
  { id: 'video',          title: 'Video Call',      description: 'A private face-to-face video session with Jinal.',        coinsPerMin: 15 },
  { id: 'priority-video', title: 'Priority Video',  description: 'Longer-form video time with higher scheduling priority.', coinsPerMin: 22 },
];

// ─────────────────────────────────────────────
// SHOP
// ─────────────────────────────────────────────

export const SHOP_ITEMS = [
  { id: 'tee-black',      title: 'Signature black tee',      remaining: 18, price_coins: 20 },
  { id: 'poster-limited', title: 'Limited edition poster',   remaining: 9,  price_coins: 16 },
  { id: 'photo-card-set', title: 'Collector photo card set', remaining: 25, price_coins: 12 },
];

// ─────────────────────────────────────────────
// EXTRAS
// ─────────────────────────────────────────────

export const EXTRA_OPTIONS = [
  { id: 'greeting-birthday',    title: 'Birthday Greeting',       description: 'A personalised video wishing you on your birthday.',       price: 18 },
  { id: 'greeting-anniversary', title: 'Anniversary Greeting',    description: 'A custom video for a special anniversary.',                 price: 25 },
  { id: 'shoutout',             title: 'Personal Shoutout',       description: 'A short recorded shoutout with your name and message.',     price: 18 },
  { id: 'priority-request',     title: 'Priority Custom Request', description: 'A higher-priority personalised request with extra detail.', price: 40 },
];

// ─────────────────────────────────────────────
// TOKEN RECHARGE PACKS
// ─────────────────────────────────────────────

export const RECHARGE_PACKS = [
  { tokens: 10,   discountPct: 0,  label: '10 Tokens'   },
  { tokens: 50,   discountPct: 0,  label: '50 Tokens'   },
  { tokens: 100,  discountPct: 0,  label: '100 Tokens'  },
  { tokens: 500,  discountPct: 5,  label: '500 Tokens'  },
  { tokens: 1000, discountPct: 10, label: '1000 Tokens' },
];

// Mutable at runtime — these defaults match today's values, but Jinal can change the real
// thresholds/percentages from Studio. Coins.jsx fetches the live config on load and calls
// setDiscountConfig(), so pricing throughout the app reflects it without a page reload.
export let discountConfig = {
  tier1Threshold: 500,
  tier1Pct: 5,
  tier2Threshold: 1000,
  tier2Pct: 10,
};

export function setDiscountConfig(cfg) {
  if (!cfg) return;
  discountConfig = { ...discountConfig, ...cfg };
}

// For any token amount, calculate discount automatically
export function rechargeDiscount(tokens) {
  if (tokens >= discountConfig.tier2Threshold) return discountConfig.tier2Pct;
  if (tokens >= discountConfig.tier1Threshold) return discountConfig.tier1Pct;
  return 0;
}

export function rechargePrice(tokens) {
  const base     = tokens * TOKEN_RATE_INR;
  const pct      = rechargeDiscount(tokens);
  const discount = pct ? Math.round(base * pct / 100) : 0;
  return { base, discount, final: base - discount, pct };
}

// Alias used by Coins.jsx
export const COIN_PACKS = RECHARGE_PACKS.map((p) => ({
  amount: p.tokens,
  label:  p.label,
  inr:    p.tokens * TOKEN_RATE_INR,
}));

// ─────────────────────────────────────────────
// CONSENT
// ─────────────────────────────────────────────

export const CONSENT_VERSION = 'voluntary-payment-v1';
export const CONSENT_TEXT =
  "I am making this payment voluntarily, of my own free will and for my own benefit, " +
  "to support this creator's work. I understand this payment is final and non-refundable.";