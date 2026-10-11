// ─────────────────────────────────────────────
// PLATFORM CONSTANTS
// ─────────────────────────────────────────────

export const PLATFORM_NAME      = 'Personal Space';
export const PLATFORM_NAME_FULL = "Jinal Joshi's Personal Space";
export const ARTIST_NAME        = 'Jinal Joshi';

// Two kinds of physical thing, and they are not the same business.
//
// An RBI merchant category covers one kind of trade, and digital content and
// physical retail are two — which is why both were switched off when a payment
// provider raised it.
//
// But a one-of-one outfit is not retail. There is a single one of each, it was
// worn on a shoot that is already on the platform, and it is bought by somebody
// who saw it there. It is closer to a signed print than to a shop, and it
// belongs beside the custom requests rather than in a catalogue.
//
// Printed merchandise is the other thing: made to order, unlimited, and never
// touched by her. That is a shop, and it is going to its own subdomain with its
// own merchant account.
export const OUTFITS = true;
export const MERCH   = false;

// Kept so the pages and routes that ask about physical goods in general still
// have an answer. True when either kind is on.
export const PHYSICAL_GOODS = OUTFITS || MERCH;
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

  // The bands, read rather than written down. These were 1 and 3 in the
  // sentence and configurable in the settings, which is how a sentence and a
  // price quietly disagree.
  const b2Until = cfgNum('tier_open_band2_until') ?? 30;
  const b2Cost  = cfgNum('tier_open_band2_cost')  ?? 1;
  const b3Until = cfgNum('tier_open_band3_until') ?? 50;
  const b3Cost  = cfgNum('tier_open_band3_cost')  ?? 3;
  const tok = (n) => `${n} token${n === 1 ? '' : 's'}`;

  return `Each membership includes a number of sets a month at your own level — ${named}, and Supreme as many as you like. Past your allowance it is ${tok(b2Cost)} a set up to ${b2Until}, ${tok(b3Cost)} a set up to ${b3Until}, and the set's own price beyond that. It resets on your membership date.`;
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
    // Names the one place a reader might reasonably assume the discount applies
    // and be wrong: messages are priced by tier already.
    title: 'Discounts',
    text: 'Messages are already priced by your tier, so no further discount applies there.',
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
    perks.push(`${e.discountPct}% additional off on Gallery & Calls`);
  }
  if (uncapped) {
    perks.push('No fair usage limit');
  }
  return perks;
}

// Term maths, in one place. These lived inside Membership.jsx, which was fine
// while that page was the only thing selling a membership. The comparison
// table sells one too, and two copies of a multiplier is how a page comes to
// quote a saving the server does not give.
export function termMultiplier(termId) {
  if (termId === 'quarterly') return cfgNum('quarterly_billing_months');
  if (termId === 'annual')    return cfgNum('annual_billing_months');
  return 1;
}

export function termMonths(termId) {
  if (termId === 'quarterly') return 3;
  if (termId === 'annual')    return 12;
  return 1;
}

export function termSaving(termId) {
  const charged = termMultiplier(termId);
  const months  = termMonths(termId);
  if (charged === null || months <= 1) return null;
  return `Save ${Math.round((1 - charged / months) * 100)}%`;
}

// The same four memberships as a grid rather than four cards.
//
// Cards are read one at a time, so a reader compares by memory and usually
// doesn't bother. A row compares for them. Every value here comes from the
// same tierEconomics() the cards use, so the table and the cards cannot say
// different things — which is the only reason this is worth having rather
// than a second hand-written list.
//
// A value is either a string to print, true for a tick, or false for a dash.
export function tierComparisonRows(tiers = ['community', 'insider', 'premium', 'supreme']) {
  const econ = Object.fromEntries(tiers.map((t) => [t, tierEconomics(t)]));
  if (tiers.some((t) => !econ[t])) return [];

  const uncapped = (t) => econ[t].openCap === 0;
  const tok      = (n) => `${n} token${n === 1 ? '' : 's'}`;
  const row      = (key, label, help, fn) => ({
    key, label, help,
    values: Object.fromEntries(tiers.map((t) => [t, fn(t)])),
  });

  const b2Until = cfgNum('tier_open_band2_until') ?? 30;
  const b2Cost  = cfgNum('tier_open_band2_cost')  ?? 1;
  const b3Until = cfgNum('tier_open_band3_until') ?? 50;
  const b3Cost  = cfgNum('tier_open_band3_cost')  ?? 3;

  return [
    row('sets', 'Sets included each month',
        'Everything at your own level opens without spending anything, up to this many a month. It resets on your own renewal date, not the 1st.',
        (t) => (uncapped(t) ? 'Unlimited' : `${econ[t].openCap}`)),

    row('beyond', 'Once that runs out',
        'The price climbs in steps rather than jumping to the full one, so a busy month is not punished.',
        (t) => (uncapped(t) ? 'Never does' : `${tok(b2Cost)} to ${b2Until}, ${tok(b3Cost)} to ${b3Until}`)),

    row('messages', 'Messages each month',
        'Included messages, and how many of them you can send in a single day.',
        (t) => (econ[t].freeDMs === null ? false : `${econ[t].freeDMs} · ${econ[t].dailyDMCap} a day`)),

    row('extraMessages', 'Messages after that',
        'Messages are priced by tier already, so the gallery discount does not apply here.',
        (t) => (econ[t].overageDM === null ? false : `${tok(econ[t].overageDM)} each`)),

    row('discount', 'Off the gallery and calls',
        'Applies to anything you buy outright — sets above your level, purchase-only sets, and call minutes.',
        (t) => (econ[t].discountPct ? `${econ[t].discountPct}%` : false)),

    row('selfies', 'Selfie of the Day',
        'The daily selfie, free rather than a token.',
        (t) => tierGetsSelfies(t)),

    row('chat', 'Community Chat Centre',
        'The shared room, open to every member.',
        () => true),

    row('fairUsage', 'Fair usage limit',
        'Whether a monthly ceiling applies to you at all.',
        (t) => (uncapped(t) ? 'None' : 'Applies')),
  ];
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
  { id: 'content',     label: 'Content',          subtitle: 'BTS, Videos, Photos & Albums' },
  { id: 'greetings',   label: 'Custom Greetings', subtitle: 'Birthday, Anniversary & Special Moments' },
];

// ─────────────────────────────────────────────
// HOMEPAGE
// ─────────────────────────────────────────────

export const HOMEPAGE_OFFERINGS = [
  { id: 'community',   title: 'Member Community',      text: 'A live space where members and Jinal interact freely. Ask, share, react — in real time.' },
  { id: 'messages',    title: 'Direct Messaging',      text: 'Your membership includes a monthly DM quota with a daily cap. Go over? One token per message.' },
  { id: 'calls',       title: 'Virtual Sessions',      text: 'Book a private audio or video call. Token-priced, member-discounted.' },
  { id: 'extras',      title: 'Personalised Requests', text: 'Custom video greetings for birthdays, anniversaries, or any moment worth celebrating.' },
  { id: 'gallery',     title: 'Exclusive Content',     text: 'BTS footage, extended cuts, photo sets and albums — unlockable with monthly credits or tokens.' },
  { id: 'bts',         title: 'Behind the Scenes',     text: "What happens off-camera, on set, and in between. A side of Jinal you won't see anywhere else." },
  { id: 'earlyAccess', title: 'Early Access',          text: 'First look at upcoming projects, drops, and announcements before they go public.' },
];

export const FEATURE_LABELS = {
  community:   'member community',
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