// ─────────────────────────────────────────────
// PLATFORM CONSTANTS
// ─────────────────────────────────────────────

export const PLATFORM_NAME      = 'Personal Space';
export const PLATFORM_NAME_FULL = "Jinal Joshi's Personal Space";
export const ARTIST_NAME        = 'Jinal Joshi';
// ─────────────────────────────────────────────
// LIVE PRICING — hydrated from /api/public/config before the app renders.
// Nothing below defines a price. If config is unavailable we render nothing
// rather than a number that might be wrong.
// ─────────────────────────────────────────────
export let PRICING = null;

export function setPricing(config) {
  if (config) PRICING = config;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export function cfgNum(key) {
  return PRICING ? num(PRICING[key]) : null;
}

export function cfgStr(key) {
  return PRICING ? (PRICING[key] ?? null) : null;
}

export function tokenRateInr() {
  return cfgNum('token_rate_inr');
}

// ─────────────────────────────────────────────
// WHAT A TOKEN IS WORTH, IN THE FAN'S OWN MONEY
// ─────────────────────────────────────────────
//
// Prices are set in rupees, because that is what Jinal earns and what the tax
// is calculated on. But a fan in Malta reading "7 tokens · Rs 462" has to do
// arithmetic with a number that means nothing to them, so the rupee figure is
// converted for display into whatever they chose to pay in.
//
// Display only. The charge itself is quoted fresh by the server at the moment
// of purchase, so a rate that moved between page load and payment cannot make
// somebody pay a figure they were not shown.
export let DISPLAY_CURRENCY = null;

export function setDisplayCurrency(c) {
  DISPLAY_CURRENCY = c && c.currency && c.currency !== 'INR' ? c : null;
}

// An INR amount, written the way this fan would recognise it.
export function money(amountInr) {
  if (amountInr === null || amountInr === undefined) return null;
  const c = DISPLAY_CURRENCY;
  if (!c || !c.inrPerUnit) {
    return `\u20B9${Math.round(amountInr).toLocaleString('en-IN')}`;
  }
  // Rounded up, matching how the server quotes a real charge -- so the figure
  // shown is never lower than the figure billed.
  const f = Math.pow(10, c.decimals ?? 2);
  const value = Math.ceil((amountInr / c.inrPerUnit) * f) / f;
  return `${c.symbol || c.currency + ' '}${value.toFixed(c.decimals ?? 2)}`;
}

// What a number of tokens is worth, in their money.
export function tokensToMoney(tokens) {
  const rate = tokenRateInr();
  if (rate === null || tokens === null || tokens === undefined) return null;
  return money(tokens * rate);
}

export function guestMultiplier() {
  return cfgNum('guest_price_multiplier');
}

// Every economic value for a tier, straight from Studio.
export function tierEconomics(tierId) {
  if (!PRICING) return null;
  return {
    monthlyCost: cfgNum(`${tierId}_monthly_cost`),
    discountPct: cfgNum(`${tierId}_discount_pct`),
    // openCap: 0 means uncapped, which is how Supreme is exempted.
    openCap:     cfgNum(`tier_open_cap_${tierId}`),
    freeDMs:     cfgNum(`dm_free_per_month_${tierId}`),
    dailyDMCap:  cfgNum(`dm_daily_cap_${tierId}`),
    overageDM:   cfgNum(`dm_overage_cost_${tierId}`),
  };
}

// Which tiers get Selfie of the Day at no cost. Read from the same config the
// backend enforces, so the promise on the page and the rule in the code cannot
// drift apart.
function tierGetsSelfies(tierId) {
  // Falls back to supreme where the key is not exposed publicly. The backend is
  // the authority either way — this only decides whether the perk is listed, so
  // a missing key showing nothing would be worse than a fallback that is
  // currently correct. Add selfie_free_tiers to the public config whitelist and
  // this reads it instead.
  const raw = cfgStr('selfie_free_tiers') ?? 'supreme';
  return String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(tierId);
}

// Who each tier is for, in Jinal's voice. A spec sheet makes a reader compare
// four columns of numbers; a description tells them which one is theirs. The
// numbers still follow underneath — the prose sells, the figures reassure.
export const TIER_DESCRIPTIONS = {
  community: { line: 'If you are just finding your way here',
               sub:  'The community, and a first taste of what I post.' },
  insider:   { line: 'If you love being here',
               sub:  'Talk to me freely, and reach more of what I post.' },
  premium:   { line: 'If you belong here',
               sub:  'More of everything, and better prices across the platform.' },
  supreme:   { line: 'If you would rather not think about limits',
               sub:  'Everything, always. No caps, no counting, nothing held back.' },
};

export function tierDescription(tierId) {
  return TIER_DESCRIPTIONS[tierId] || null;
}

// Stated once, as policy, rather than repeated as a restriction inside every
// tier. A ceiling read four times sounds mean; read once it sounds reasonable.
// Read from the configured caps rather than written down.
//
// This said fifteen sets for everybody, which stopped being true the moment the
// tiers were given different allowances — Community ten, Insider fifteen,
// Premium twenty. A number typed into a sentence does not change when the
// setting does, and a promise that has quietly gone wrong is worse than one
// stated vaguely.
//
// Written so it reads on the homepage, where nobody has a tier yet and all four
// numbers have to be true at once.
function fairUsageText() {
  const caps = ['community', 'insider', 'premium']
    .map((t) => ({ tier: t, n: cfgNum(`tier_open_cap_${t}`) }))
    .filter((c) => c.n > 0);

  if (!caps.length) {
    return 'Each membership includes a number of sets a month at your own level. Beyond that they are a token or two each, and it resets on your membership date. Supreme has no limit at all.';
  }

  const named = caps
    .map((c) => `${c.tier.charAt(0).toUpperCase() + c.tier.slice(1)} ${c.n}`)
    .join(', ');

  return `Each membership includes a number of sets a month at your own level — ${named}, and Supreme as many as you like. Past your allowance it is 1 token a set up to 30, 3 tokens a set up to 50, and the set's own price beyond that. It resets on your membership date.`;
}

export const MEMBERSHIP_NOTES = [
  {
    title: 'Fair usage',
    get text() { return fairUsageText(); },
  },
  {
    title: 'Purchasable content',
    text: 'Some things I mark purchase-only. Those sit outside membership whatever your tier, including Supreme.',
  },
  {
    // The perk itself now names where the discount applies, so this only has to
    // cover the two places a reader might reasonably assume it does and be
    // wrong. Messages are priced by tier already; outfits are flat so a bid
    // means the same from everyone.
    title: 'Discounts',
    text: 'Messages are already priced by your tier, so no further discount applies there. One-of-One Outfits are flat-priced for everyone.',
  },
];

// Perk sentences generated from live values — never hardcoded prose.
export function tierPerks(tierId) {
  const e = tierEconomics(tierId);
  if (!e) return [];
  const perks = ['Community Chat Centre'];
  if (e.freeDMs !== null && e.dailyDMCap !== null) {
    perks.push(`${e.freeDMs} free messages a month · ${e.dailyDMCap} a day`);
  }
  // Access, not an allowance. A sentence that gets stronger as Jinal posts more,
  // where a fixed number of unlocks would get weaker.
  const uncapped = cfgNum(`tier_open_cap_${tierId}`) === 0;
  perks.push(uncapped
    ? 'Every set and selfie, as I post them'
    : `All ${TIERS[tierId]?.name || tierId} content, included`);
  if (tierGetsSelfies(tierId)) {
    perks.push('Selfie of the Day, free');
  }
  if (e.discountPct) {
    perks.push(`${e.discountPct}% additional off on Gallery, Merchandise & Calls`);
  }
  if (uncapped) {
    perks.push('No fair usage limit');
  }
  return perks;
}

export const SUPPORT_EMAIL      = 'support@jinaljoshi.in';

// ─────────────────────────────────────────────
// MEMBERSHIP TIERS
// ─────────────────────────────────────────────

// Display metadata only. Every economic value — price, discount, unlocks, DM
// allowances — lives in platform_config and is read via cfgNum()/tierEconomics().
// Nothing monetary belongs in this file.
export const TIERS = {
  guest:     { id: 'guest',     name: 'Guest',     color: '#6B6560' },
  community: { id: 'community', name: 'Community', color: '#C17D4A' },
  insider:   { id: 'insider',   name: 'Insider',   color: '#B8860B' },
  premium:   { id: 'premium',   name: 'Premium',   color: '#9B8F83' },
  supreme:   { id: 'supreme',   name: 'Supreme',   color: '#C17D4A' },
};

export const PAID_TIER_IDS = ['community', 'insider', 'premium', 'supreme'];
export const ALL_TIER_IDS  = ['guest', ...PAID_TIER_IDS];

// ─────────────────────────────────────────────
// PRICING HELPERS
// ─────────────────────────────────────────────

export function applyDiscount(baseTokens, discountPct) {
  if (!discountPct) return baseTokens;
  // Always round up — matches roundTokensUp() on the backend so the displayed
  // price and the charged price can never diverge.
  return Math.ceil(baseTokens * (1 - discountPct / 100));
}

// Best discount any tier currently offers, straight from Studio.
export function bestDiscountPct() {
  const pcts = ['community', 'insider', 'premium', 'supreme']
    .map((t) => cfgNum(`${t}_discount_pct`))
    .filter((v) => v !== null);
  return pcts.length ? Math.max(...pcts) : null;
}

export function bestMemberPrice(baseTokens) {
  const pct = bestDiscountPct();
  return pct === null ? null : applyDiscount(baseTokens, pct);
}

// ─────────────────────────────────────────────
// COMMUNITY CHAT
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────

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

// The last two amounts ARE Jinal's live bulk-discount thresholds, so the buttons
// themselves move when she changes them in Studio — a fan can never be offered a
// pack that just misses a discount tier. Returns [] if config is unavailable.
export function rechargePacks() {
  const t1 = cfgNum('recharge_discount_tier1_threshold');
  const t2 = cfgNum('recharge_discount_tier2_threshold');
  if (t1 === null || t2 === null) return [];
  return [
    { tokens: 10,  label: '10 Tokens'  },
    { tokens: 50,  label: '50 Tokens'  },
    { tokens: 100, label: '100 Tokens' },
    { tokens: t1,  label: `${t1} Tokens` },
    { tokens: t2,  label: `${t2} Tokens` },
  ];
}

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
  const rate = tokenRateInr();
  if (rate === null) return null;
  const base     = tokens * rate;
  const pct      = rechargeDiscount(tokens);
  const discount = pct ? Math.round(base * pct / 100) : 0;
  return { base, discount, final: base - discount, pct };
}



// ─────────────────────────────────────────────
// CONSENT
// ─────────────────────────────────────────────

export const CONSENT_VERSION = 'voluntary-payment-v1';
export const CONSENT_TEXT =
  "I am making this payment voluntarily, of my own free will and for my own benefit, " +
  "to support this creator's work. I understand this payment is final and non-refundable.";