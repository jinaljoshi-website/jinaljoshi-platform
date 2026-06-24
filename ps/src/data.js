// Platform data — tiers, pricing, terms
// Change prices and rules here. They apply across the whole portal.

export const TIERS = {
  none: {
    id: 'none',
    name: 'Visitor',
    color: '#8A8378',
    monthlyPrice: 0,
    freeSets: 0,
    unlocks: 0,
    messages: 0,
    overageFee: 12,
    description: 'Browse the public landing page only.',
    perks: ['Public homepage access'],
  },
  level2: {
    id: 'level2',
    name: 'Level 2',
    color: '#C17D4A',
    monthlyPrice: 9,
    freeSets: 1,
    unlocks: 0,
    messages: 5,
    overageFee: 8,
    description: 'A lighter membership with direct access and a monthly free pick.',
    perks: ['1 free set each month', '5 direct messages', 'Level 2 community access'],
  },
  level3: {
    id: 'level3',
    name: 'Level 3',
    color: '#8E5A2B',
    monthlyPrice: 24,
    freeSets: 0,
    unlocks: 3,
    messages: 20,
    overageFee: 5,
    description: 'More messages and multiple content unlocks every month.',
    perks: ['Unlock 3 sets monthly', '20 direct messages', 'Level 3 community access'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    color: '#5C1F2E',
    monthlyPrice: 59,
    freeSets: 0,
    unlocks: 10,
    messages: 100,
    overageFee: 2,
    description: 'Highest-access tier with generous monthly usage.',
    perks: ['Unlock 10 sets monthly', '100 direct messages', 'Premium community access'],
  },
};

export const TERMS = [
  { id: '1mo', months: 1, label: '1 month', discountPct: 0 },
  { id: '3mo', months: 3, label: '3 months', discountPct: 10 },
  { id: '12mo', months: 12, label: '12 months', discountPct: 20 },
];

export function termPrice(tier, term) {
  const full = tier.monthlyPrice * term.months;
  return Math.round(full * (1 - term.discountPct / 100));
}

export const TOKEN_RATE_INR = 66;
export const RECHARGE_PRESETS = [10, 25, 50, 100];

export const CONSENT_VERSION = 'voluntary-payment-v1';
export const CONSENT_TEXT =
  "I am making this payment voluntarily, of my own free will and for my own benefit, to support this creator's work. I understand this payment is final and non-refundable.";

export const SUPPORT_EMAIL = 'support@jinaljoshi.in';

export const GALLERY_SETS = [
  {
    id: 'set-001',
    title: 'Golden Hour Portraits',
    type: 'Photo set',
    mode: 'Unlock once',
    price_coins: 12,
  },
  {
    id: 'set-002',
    title: 'Studio Film Snippets',
    type: 'Video',
    mode: 'Members only',
    price_coins: 18,
  },
  {
    id: 'set-003',
    title: 'Behind the Scenes Album',
    type: 'Album',
    mode: 'Unlock once',
    price_coins: 15,
  },
];

export const CALL_OPTIONS = [
  {
    id: 'audio-10',
    title: 'Audio call',
    description: 'A private audio session for direct conversation.',
    coinsPerMin: 8,
  },
  {
    id: 'video-10',
    title: 'Video call',
    description: 'A private face-to-face video session with Jinal.',
    coinsPerMin: 15,
  },
  {
    id: 'priority-video',
    title: 'Priority video call',
    description: 'Longer-form video time with higher scheduling priority.',
    coinsPerMin: 22,
  },
];

export const SHOP_ITEMS = [
  {
    id: 'tee-black',
    title: 'Signature black tee',
    remaining: 18,
    price_coins: 20,
  },
  {
    id: 'poster-limited',
    title: 'Limited edition poster',
    remaining: 9,
    price_coins: 16,
  },
  {
    id: 'photo-card-set',
    title: 'Collector photo card set',
    remaining: 25,
    price_coins: 12,
  },
];

export const EXTRA_OPTIONS = [
  {
    id: 'shoutout',
    title: 'Personal shoutout',
    description: 'A short personalized recorded message.',
    price: 18,
  },
  {
    id: 'greeting',
    title: 'Custom greeting',
    description: 'A custom greeting for a birthday, anniversary, or special moment.',
    price: 25,
  },
  {
    id: 'priority-request',
    title: 'Priority custom request',
    description: 'A higher-priority personalized request with extra detail.',
    price: 40,
  },
];

export const COIN_PACKS = [
  {
    amount: 10,
    label: 'Starter pack',
  },
  {
    amount: 25,
    label: 'Popular recharge',
  },
  {
    amount: 50,
    label: 'High access pack',
  },
  {
    amount: 100,
    label: 'Best for regular members',
  },
];

export const PLATFORM_NAME = 'Personal Space';


export const TOKEN_DISCLAIMER =
  'Wonder Coins are the platform’s internal access currency. Recharge uses real money, but individual platform actions and purchases are made using Wonder Coins only. All purchases are final and non-refundable.';

export const FEATURE_LABELS = {
  messages: 'direct messaging',
  gallery: 'exclusive media access',
  community: 'member community',
  calls: 'virtual sessions',
  extras: 'personalised requests',
  shop: 'official merchandise',
};