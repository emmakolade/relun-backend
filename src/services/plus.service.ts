import { Like } from '../models/Like';
import { DatePost, DATE_POST_GRACE_MS } from '../models/DatePost';
import { MessageRequest, MessageRequestPayment } from '../models/MessageRequest';
import { Plus, PlusPayment, IPlus, PlusSource } from '../models/Plus';
import { User } from '../models/User';
import {
  FREE_ACTIVE_DATES,
  FREE_DAILY_LIKES,
  FREE_WEEKLY_REQUESTS,
  PLUS_ACTIVE_DATES,
  PLUS_MONTHLY_REQUESTS,
  PlusPlan,
  PlusPlanId,
} from '../config/coins';
import { verifyPlaySubscription } from './playBilling.service';
import { notifyPlus } from './push.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Allowances reset on Lagos time (WAT, UTC+1, no daylight saving).
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
// A renewal can land a little after the period ends; don't drop Plus meanwhile.
const RENEWAL_GRACE_MS = DAY_MS;

const lagos = (date: Date) => new Date(date.getTime() + LAGOS_OFFSET_MS);

export const lagosDayStart = (now = new Date()): Date =>
  new Date(Math.floor(lagos(now).getTime() / DAY_MS) * DAY_MS - LAGOS_OFFSET_MS);

/** Monday 00:00 Lagos time. */
export const lagosWeekStart = (now = new Date()): Date => {
  const daysSinceMonday = (lagos(now).getUTCDay() + 6) % 7;
  return new Date(lagosDayStart(now).getTime() - daysSinceMonday * DAY_MS);
};

export const lagosMonthStart = (now = new Date()): Date => {
  const local = lagos(now);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - LAGOS_OFFSET_MS);
};

const nextLagosMonthStart = (now = new Date()): Date => {
  const local = lagos(now);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - LAGOS_OFFSET_MS);
};

// ---------- Plus status ----------

const isActive = (plus: Pick<IPlus, 'until'> | null | undefined): boolean =>
  !!plus && plus.until.getTime() > Date.now();

/**
 * The user's Plus row. A lapsed Play subscription is re-checked with Google
 * first, so a renewal shows up even if the app hasn't reported it yet.
 */
export const getPlus = async (userId: string): Promise<IPlus | null> => {
  const plus = await Plus.findOne({ userId });
  if (!plus || isActive(plus) || plus.source !== 'play' || !plus.playPurchaseToken) return plus;

  const result = await verifyPlaySubscription(plus.playPurchaseToken);
  if (result.ok && result.expiry && result.expiry.getTime() > plus.until.getTime()) {
    plus.until = result.expiry;
    plus.autoRenew = result.autoRenew;
    await plus.save();
  }
  return plus;
};

export const hasPlus = async (userId: string): Promise<boolean> => isActive(await getPlus(userId));

/** What the apps see. Null when the user has never had Plus or it has lapsed. */
export const plusView = (plus: IPlus | null) =>
  isActive(plus)
    ? {
        active: true,
        plan: plus!.plan,
        source: plus!.source,
        until: plus!.until,
        autoRenew: plus!.autoRenew,
      }
    : null;

/** Likes & Views: Plus includes it; anyone else needs a coin pass. */
export const canSeeInsights = async (userId: string): Promise<boolean> => {
  const user = await User.findById(userId).select('insightsUntil').lean();
  if (user?.insightsUntil && user.insightsUntil.getTime() > Date.now()) return true;
  return hasPlus(userId);
};

/**
 * Extends Plus for one Paystack charge (first payment, renewal or pass). The
 * unique reference means the same charge, seen by both the app and the
 * webhook, only counts once. Returns false if it was already counted.
 */
export const grantPlusPayment = async (params: {
  userId: string;
  plan: PlusPlan;
  source: Extract<PlusSource, 'paystack' | 'paystack_pass'>;
  reference: string;
  amount: number;
  currency: string;
  paystackCustomerCode?: string;
}): Promise<boolean> => {
  const { userId, plan, source } = params;
  try {
    await PlusPayment.create({
      reference: params.reference,
      userId,
      plan: plan.id,
      source,
      amount: params.amount,
      currency: params.currency,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }

  // Extends from whichever is later, now or the current end, so paying early
  // never wastes days.
  const current = await Plus.findOne({ userId }).select('until autoRenew').lean();
  const from = current && current.until.getTime() > Date.now() ? current.until.getTime() : Date.now();
  const renews = source === 'paystack';
  const until = new Date(from + plan.days * DAY_MS + (renews ? RENEWAL_GRACE_MS : 0));
  // A pass bought on top of a renewing plan just adds days; the plan keeps
  // its source so it can still be cancelled.
  const keepPlan = !renews && !!current?.autoRenew;

  await Plus.updateOne(
    { userId },
    {
      $set: {
        until,
        ...(keepPlan ? {} : { plan: plan.id, source, autoRenew: renews }),
        ...(params.paystackCustomerCode ? { paystackCustomerCode: params.paystackCustomerCode } : {}),
      },
    },
    { upsert: true }
  );
  void notifyPlus({ userId, renewed: !!current && current.until.getTime() > Date.now(), until });
  return true;
};

/** Records a verified Google Play subscription; Google's expiry is the truth. */
export const setPlayPlus = async (params: {
  userId: string;
  plan: PlusPlanId;
  until: Date;
  autoRenew: boolean;
  purchaseToken: string;
}) => {
  // The app re-reports its subscription on every launch; only a start or a
  // renewal (a later expiry) is news.
  const before = await Plus.findOne({ userId: params.userId }).select('until').lean();
  if (!before || params.until.getTime() > before.until.getTime() + 60 * 60 * 1000) {
    void notifyPlus({
      userId: params.userId,
      renewed: !!before && before.until.getTime() > Date.now() - 24 * 60 * 60 * 1000,
      until: params.until,
    });
  }
  return Plus.updateOne(
    { userId: params.userId },
    {
      $set: {
        plan: params.plan,
        source: 'play',
        until: params.until,
        autoRenew: params.autoRenew,
        playPurchaseToken: params.purchaseToken,
      },
    },
    { upsert: true }
  );
};

// ---------- Allowances ----------

export type LikeAllowance = {
  /** Null for Plus: no limit. */
  limit: number | null;
  left: number | null;
  resetAt: Date | null;
};

export const likeAllowance = async (userId: string, plus: boolean): Promise<LikeAllowance> => {
  if (plus) return { limit: null, left: null, resetAt: null };
  const since = lagosDayStart();
  const used = await Like.countDocuments({
    userId,
    createdAt: { $gte: since },
    source: { $nin: ['request', 'date'] },
  });
  return {
    limit: FREE_DAILY_LIKES,
    left: Math.max(0, FREE_DAILY_LIKES - used),
    resetAt: new Date(since.getTime() + DAY_MS),
  };
};

export type RequestAllowance = {
  limit: number;
  left: number;
  resetAt: Date;
  /** How the next free one is recorded. */
  paidWith: Extract<MessageRequestPayment, 'free' | 'plus'>;
};

/** Free users get FREE_WEEKLY_REQUESTS a week; Plus gets PLUS_MONTHLY_REQUESTS a month. */
export const requestAllowance = async (userId: string, plus: boolean): Promise<RequestAllowance> => {
  const paidWith = plus ? 'plus' : 'free';
  const limit = plus ? PLUS_MONTHLY_REQUESTS : FREE_WEEKLY_REQUESTS;
  const since = plus ? lagosMonthStart() : lagosWeekStart();
  const resetAt = plus ? nextLagosMonthStart() : new Date(since.getTime() + 7 * DAY_MS);
  const used = await MessageRequest.countDocuments({
    senderId: userId,
    paidWith,
    createdAt: { $gte: since },
  });
  return { limit, left: Math.max(0, limit - used), resetAt, paidWith };
};

/** Free date posts left: FREE_ACTIVE_DATES live at once, or PLUS_ACTIVE_DATES with Plus. */
export const dateAllowance = async (userId: string, plus: boolean) => {
  const limit = plus ? PLUS_ACTIVE_DATES : FREE_ACTIVE_DATES;
  const active = await DatePost.countDocuments({
    userId,
    status: 'active',
    scheduledFor: { $gte: new Date(Date.now() - DATE_POST_GRACE_MS) },
  });
  return { limit, left: Math.max(0, limit - active) };
};
