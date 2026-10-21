// Coin prices, packages, free allowances and Relun Plus plans. Every number can
// be overridden from the environment, so prices change without a code change.
// The store product ids must match the products created in Google Play Console
// (and App Store Connect later).

// These are read once at import. Under tsx (npm run dev) imports run before
// server.ts calls dotenv.config(), so load .env here to see it either way.
import 'dotenv/config';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = Number(raw);
  // Never negative: a negative price would turn a spend into a credit.
  return raw !== undefined && raw !== '' && Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const COIN_COSTS = {
  // Messaging someone without a match. Never refunded, even if they decline.
  messageRequest: num('MESSAGE_REQUEST_COINS', 200),
  // Likes & Views passes for people who'd rather not subscribe. Priced a little
  // above the matching Plus plan, which includes them and more.
  insights7: num('INSIGHTS_7D_COINS', 700),
  insights30: num('INSIGHTS_30D_COINS', 1500),
  // A date post beyond the free active ones.
  datePost: num('DATE_POST_COINS', 100),
} as const;

// Messages a request sender may send before the other side replies or declines.
export const MESSAGE_REQUEST_LIMIT = 3;

// Free allowances. Likes reset daily, free message requests weekly and Plus
// message requests monthly, all on Lagos time.
export const FREE_DAILY_LIKES = num('FREE_DAILY_LIKES', 15);
export const FREE_WEEKLY_REQUESTS = num('FREE_WEEKLY_REQUESTS', 1);
export const PLUS_MONTHLY_REQUESTS = num('PLUS_MONTHLY_REQUESTS', 5);

// Date posts that can be live at once for free. Past or deleted ones free the slot.
export const FREE_ACTIVE_DATES = num('FREE_ACTIVE_DATES', 1);
export const PLUS_ACTIVE_DATES = num('PLUS_ACTIVE_DATES', 3);

export type CoinPackage = {
  id: string;
  productId: string;
  coins: number;
  // Shown only as a fallback; the app displays the store's localized price.
  priceUsd: number;
  best?: boolean;
  // Web purchases through Paystack, in the currency's minor unit (kobo for NGN).
  paystackAmount: number;
  paystackCurrency: string;
};

// Paystack prices. Override one with PAYSTACK_PRICE_COINS_500=100000 (minor units).
export const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'NGN';

const paystackPrice = (productId: string, fallback: number): number =>
  num(`PAYSTACK_PRICE_${productId.toUpperCase()}`, fallback);

// About N2 a coin, a little cheaper in the bigger packs.
export const COIN_PACKAGES: CoinPackage[] = [
  {
    id: 'coins_500',
    productId: 'coins_500',
    coins: 500,
    priceUsd: 0.99,
    paystackAmount: paystackPrice('coins_500', 100_000),
    paystackCurrency: PAYSTACK_CURRENCY,
  },
  {
    id: 'coins_1000',
    productId: 'coins_1000',
    coins: 1000,
    priceUsd: 1.99,
    best: true,
    paystackAmount: paystackPrice('coins_1000', 200_000),
    paystackCurrency: PAYSTACK_CURRENCY,
  },
  {
    id: 'coins_2500',
    productId: 'coins_2500',
    coins: 2500,
    priceUsd: 3.99,
    paystackAmount: paystackPrice('coins_2500', 450_000),
    paystackCurrency: PAYSTACK_CURRENCY,
  },
  {
    id: 'coins_6000',
    productId: 'coins_6000',
    coins: 6000,
    priceUsd: 7.99,
    paystackAmount: paystackPrice('coins_6000', 900_000),
    paystackCurrency: PAYSTACK_CURRENCY,
  },
];

export const findPackageByProductId = (productId: string): CoinPackage | undefined =>
  COIN_PACKAGES.find((pkg) => pkg.productId === productId);

// ---------- Relun Plus ----------

export type PlusPlanId = 'weekly' | 'monthly';

export type PlusPlan = {
  id: PlusPlanId;
  days: number;
  // Paystack price in the currency's minor unit (kobo for NGN).
  amount: number;
  currency: string;
  // Paystack plan for the auto-renewing version. One-time passes don't use it.
  paystackPlanCode: string | null;
  // Base plan of the Google Play subscription PLUS_PRODUCT_ID.
  playBasePlanId: string;
};

export const PLUS_PRODUCT_ID = process.env.PLAY_PLUS_PRODUCT_ID || 'relun_plus';

export const PLUS_PLANS: PlusPlan[] = [
  {
    id: 'weekly',
    days: 7,
    amount: num('PLUS_WEEKLY_PRICE', 120_000),
    currency: PAYSTACK_CURRENCY,
    paystackPlanCode: process.env.PAYSTACK_PLAN_WEEKLY || null,
    playBasePlanId: 'weekly',
  },
  {
    id: 'monthly',
    days: 30,
    amount: num('PLUS_MONTHLY_PRICE', 250_000),
    currency: PAYSTACK_CURRENCY,
    paystackPlanCode: process.env.PAYSTACK_PLAN_MONTHLY || null,
    playBasePlanId: 'monthly',
  },
];

export const findPlusPlan = (id: unknown): PlusPlan | undefined =>
  PLUS_PLANS.find((plan) => plan.id === id);

export const findPlusPlanByPaystackCode = (code: string | null | undefined): PlusPlan | undefined =>
  code ? PLUS_PLANS.find((plan) => plan.paystackPlanCode === code) : undefined;

export const findPlusPlanByPlayBasePlan = (basePlanId: string | null | undefined): PlusPlan | undefined =>
  basePlanId ? PLUS_PLANS.find((plan) => plan.playBasePlanId === basePlanId) : undefined;

// Coins given to brand-new accounts so the paid features can be tried.
export const SIGNUP_BONUS_COINS = num('SIGNUP_BONUS_COINS', 300);

// refId on bonus transactions, so the app can tell a welcome gift from a later one.
export const SIGNUP_BONUS_REF = 'signup';
