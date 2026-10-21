import crypto from 'crypto';
import { Response } from 'express';
import { validationResult } from 'express-validator';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Plus, PlusPayment } from '../models/Plus';
import {
  PLUS_ACTIVE_DATES,
  PLUS_MONTHLY_REQUESTS,
  PLUS_PLANS,
  PLUS_PRODUCT_ID,
  findPlusPlan,
  findPlusPlanByPaystackCode,
  findPlusPlanByPlayBasePlan,
} from '../config/coins';
import {
  disableSubscription,
  fetchCustomer,
  initializeTransaction,
  isPaystackConfigured,
  metadataOf,
  planCodeOf,
  verifyTransaction,
  PaystackTransaction,
} from '../services/paystack.service';
import { verifyPlaySubscription } from '../services/playBilling.service';
import {
  dateAllowance,
  getPlus,
  grantPlusPayment,
  likeAllowance,
  plusView,
  requestAllowance,
  setPlayPlus,
} from '../services/plus.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plus status and what's left of the free allowances; the wallet includes this too. */
export const entitlements = async (userId: string) => {
  const plus = plusView(await getPlus(userId));
  const [likes, requests, dates] = await Promise.all([
    likeAllowance(userId, !!plus),
    requestAllowance(userId, !!plus),
    dateAllowance(userId, !!plus),
  ]);
  return {
    plus,
    // What Plus includes, so the apps never hard-code these numbers.
    plusPerks: { monthlyRequests: PLUS_MONTHLY_REQUESTS, activeDates: PLUS_ACTIVE_DATES },
    plans: PLUS_PLANS.map((plan) => ({
      id: plan.id,
      days: plan.days,
      amount: plan.amount,
      currency: plan.currency,
      // Auto-renew on the web needs a Paystack plan; passes always work.
      autoRenewAvailable: !!plan.paystackPlanCode,
      playProductId: PLUS_PRODUCT_ID,
      playBasePlanId: plan.playBasePlanId,
    })),
    allowances: {
      likes,
      requests: { limit: requests.limit, left: requests.left, resetAt: requests.resetAt },
      // Active date posts; no reset, a slot frees when a post passes or is deleted.
      dates: { limit: dates.limit, left: dates.left, resetAt: null },
    },
  };
};

// GET /api/plus
export const getPlusStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await entitlements(req.user!.id));
  } catch (error) {
    console.error('Get Plus error:', error);
    res.status(500).json({ error: 'Failed to load Relun Plus' });
  }
};

// ---------- Paystack (web) ----------

const paystackEmail = async (userId: string) => {
  const user = await User.findById(userId).select('email').lean();
  // Paystack requires an email; phone-only accounts get a stable placeholder.
  return user?.email || `${userId}@users.relun.app`;
};

type PlusCredit = { ok: true; granted: boolean } | { ok: false; status: number; error: string };

/**
 * Credits the first charge of a Plus purchase, from the app or the webhook.
 * Checks the amount against the plan, so a tampered client can't buy a month
 * for the price of a week.
 */
const creditPlusCharge = async (tx: PaystackTransaction): Promise<PlusCredit> => {
  if (tx.status !== 'success') return { ok: false, status: 402, error: 'Payment was not completed' };

  const meta = metadataOf(tx);
  const plan = findPlusPlan(meta.plan);
  if (meta.kind !== 'plus' || typeof meta.userId !== 'string' || !plan) {
    return { ok: false, status: 400, error: 'Unknown purchase' };
  }
  if (tx.amount !== plan.amount || tx.currency !== plan.currency) {
    console.error('[paystack] Plus amount mismatch', tx.reference, tx.amount, tx.currency);
    return { ok: false, status: 402, error: 'Payment amount does not match' };
  }

  const granted = await grantPlusPayment({
    userId: meta.userId,
    plan,
    source: meta.renew ? 'paystack' : 'paystack_pass',
    reference: `paystack:${tx.reference}`,
    amount: tx.amount,
    currency: tx.currency,
    paystackCustomerCode: tx.customer?.customer_code,
  });
  return { ok: true, granted };
};

// POST /api/plus/paystack/initialize { plan, renew }
export const initializePlusPaystack = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    if (!isPaystackConfigured()) {
      res.status(503).json({ error: 'Payments are not available right now' });
      return;
    }

    const plan = findPlusPlan(req.body.plan);
    if (!plan) {
      res.status(400).json({ error: 'Unknown plan' });
      return;
    }
    const renew = req.body.renew === true;
    if (renew && !plan.paystackPlanCode) {
      res.status(503).json({ error: 'Auto-renew isn’t available yet. Buy a one-time pass instead.' });
      return;
    }

    const userId = req.user!.id;
    if (renew) {
      const current = await Plus.findOne({ userId }).select('source autoRenew until').lean();
      if (current?.autoRenew && current.until.getTime() > Date.now()) {
        res.status(409).json({ error: 'You already have Relun Plus renewing', code: 'ALREADY_SUBSCRIBED' });
        return;
      }
    }

    const reference = `relun_plus_${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tx = await initializeTransaction({
      email: await paystackEmail(userId),
      amount: plan.amount,
      currency: plan.currency,
      reference,
      metadata: { userId, kind: 'plus', plan: plan.id, renew },
      ...(renew && plan.paystackPlanCode ? { plan: plan.paystackPlanCode } : {}),
    });

    res.status(201).json({
      reference: tx.reference,
      accessCode: tx.access_code,
      authorizationUrl: tx.authorization_url,
    });
  } catch (error) {
    console.error('Plus Paystack initialize error:', error);
    res.status(502).json({ error: 'Couldn’t start the payment. Try again.' });
  }
};

// POST /api/plus/paystack/verify { reference }
export const verifyPlusPaystack = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const tx = await verifyTransaction(req.body.reference);
    if (metadataOf(tx).userId !== req.user!.id) {
      res.status(409).json({ error: 'This purchase belongs to another account' });
      return;
    }

    const result = await creditPlusCharge(tx);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: 'PURCHASE_NOT_VERIFIED' });
      return;
    }
    res.status(result.granted ? 201 : 200).json(await entitlements(req.user!.id));
  } catch (error) {
    console.error('Plus Paystack verify error:', error);
    res.status(502).json({ error: 'Couldn’t confirm the payment yet. Try again.' });
  }
};

type PaystackEvent = {
  event?: string;
  data?: {
    reference?: string;
    transaction_reference?: string;
    subscription_code?: string;
    email_token?: string;
    customer?: { customer_code?: string; email?: string };
    plan?: { plan_code?: string };
  };
};

/** The user behind a Paystack customer: by stored code, else by the email we gave Paystack. */
const userForCustomer = async (customer?: { customer_code?: string; email?: string }) => {
  if (customer?.customer_code) {
    const plus = await Plus.findOne({ paystackCustomerCode: customer.customer_code }).select('userId').lean();
    if (plus) return plus.userId.toString();
  }
  const email = customer?.email?.toLowerCase();
  if (!email) return null;
  const placeholder = /^([a-f0-9]{24})@users\.relun\.app$/.exec(email);
  if (placeholder) return placeholder[1];
  const user = await User.findOne({ email }).select('_id').lean();
  return user?._id.toString() ?? null;
};

/**
 * Plus events from the Paystack webhook (the coins controller receives it and
 * passes these on). Returns false for events that aren't about Plus.
 */
export const handlePlusWebhook = async (event: PaystackEvent): Promise<boolean> => {
  const data = event.data ?? {};

  if (event.event === 'charge.success' && data.reference) {
    // Re-fetch rather than trusting the payload's amount.
    const tx = await verifyTransaction(data.reference);
    if (metadataOf(tx).kind === 'plus') {
      const result = await creditPlusCharge(tx);
      if (!result.ok) console.warn('[paystack] Plus not granted:', result.error, tx.reference);
      return true;
    }

    // A renewal: Paystack charges the saved card with no metadata of ours.
    const plan = findPlusPlanByPaystackCode(planCodeOf(tx));
    if (!plan) return false;
    const userId = await userForCustomer(tx.customer);
    if (!userId || tx.status !== 'success' || tx.amount !== plan.amount || tx.currency !== plan.currency) {
      console.warn('[paystack] Plus renewal not granted', tx.reference, userId, tx.amount);
      return true;
    }
    await grantPlusPayment({
      userId,
      plan,
      source: 'paystack',
      reference: `paystack:${tx.reference}`,
      amount: tx.amount,
      currency: tx.currency,
      paystackCustomerCode: tx.customer?.customer_code,
    });
    return true;
  }

  if (event.event === 'subscription.create') {
    const userId = await userForCustomer(data.customer);
    if (!userId || !findPlusPlanByPaystackCode(data.plan?.plan_code)) return true;
    // Kept so the user can cancel from the app.
    await Plus.updateOne(
      { userId },
      {
        $set: {
          paystackSubscriptionCode: data.subscription_code,
          paystackEmailToken: data.email_token,
          ...(data.customer?.customer_code ? { paystackCustomerCode: data.customer.customer_code } : {}),
        },
      }
    );
    return true;
  }

  if (event.event === 'refund.processed' && data.transaction_reference) {
    // Claimed once, so a repeated webhook can't take the days back twice.
    const payment = await PlusPayment.findOneAndUpdate(
      { reference: `paystack:${String(data.transaction_reference)}`, refundedAt: { $exists: false } },
      { $set: { refundedAt: new Date() } }
    ).lean();
    if (!payment) return false;
    const plan = findPlusPlan(payment.plan);
    const plus = await Plus.findOne({ userId: payment.userId });
    if (plan && plus) {
      // Removes the refunded period, never ending earlier than now.
      plus.until = new Date(Math.max(Date.now(), plus.until.getTime() - plan.days * DAY_MS));
      await plus.save();
    }
    return true;
  }

  if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
    if (data.subscription_code) {
      await Plus.updateOne({ paystackSubscriptionCode: data.subscription_code }, { $set: { autoRenew: false } });
    }
    return true;
  }

  return false;
};

// ---------- Google Play (Android) ----------

// POST /api/plus/play { purchaseToken, basePlanId }
export const confirmPlayPlus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const userId = req.user!.id;
    const { purchaseToken } = req.body;

    const owner = await Plus.findOne({ playPurchaseToken: purchaseToken }).select('userId').lean();
    if (owner && owner.userId.toString() !== userId) {
      res.status(409).json({ error: 'This subscription belongs to another account' });
      return;
    }

    const result = await verifyPlaySubscription(purchaseToken);
    if (!result.ok) {
      res.status(402).json({ error: result.reason, code: 'PURCHASE_NOT_VERIFIED' });
      return;
    }
    // expiry is null only when verification was skipped in development.
    const verified = result.expiry !== null;
    if (verified ? result.productId !== PLUS_PRODUCT_ID : result.productId && result.productId !== PLUS_PRODUCT_ID) {
      res.status(400).json({ error: 'Unknown subscription' });
      return;
    }

    // Google says which base plan was bought; the app's word is only used
    // when verification is skipped in development.
    const plan = verified
      ? findPlusPlanByPlayBasePlan(result.basePlanId)
      : findPlusPlanByPlayBasePlan(String(req.body.basePlanId ?? ''));
    if (!plan) {
      res.status(400).json({ error: 'Unknown plan' });
      return;
    }

    try {
      await setPlayPlus({
        userId,
        plan: plan.id,
        until: result.expiry ?? new Date(Date.now() + plan.days * DAY_MS),
        autoRenew: result.autoRenew,
        purchaseToken,
      });
    } catch (error) {
      // The unique token index: another account claimed it at the same moment.
      if ((error as { code?: number }).code === 11000) {
        res.status(409).json({ error: 'This subscription belongs to another account' });
        return;
      }
      throw error;
    }
    res.json(await entitlements(userId));
  } catch (error) {
    console.error('Confirm Play Plus error:', error);
    res.status(500).json({ error: 'Failed to confirm subscription' });
  }
};

// ---------- Cancel ----------

// POST /api/plus/cancel. Stops renewing; Plus lasts until the paid period ends.
export const cancelPlus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const plus = await Plus.findOne({ userId });

    if (!plus || !plus.autoRenew || plus.until.getTime() <= Date.now()) {
      res.status(400).json({ error: 'Nothing to cancel', code: 'NOT_RENEWING' });
      return;
    }
    if (plus.source === 'play') {
      res.status(409).json({ error: 'Manage this subscription in Google Play', code: 'MANAGE_IN_PLAY' });
      return;
    }

    let code = plus.paystackSubscriptionCode;
    let token = plus.paystackEmailToken;
    // The subscription.create webhook may not have arrived; ask Paystack.
    if ((!code || !token) && plus.paystackCustomerCode) {
      const customer = await fetchCustomer(plus.paystackCustomerCode);
      const sub = customer.subscriptions?.find(
        (s) => s.status === 'active' && findPlusPlanByPaystackCode(s.plan?.plan_code)
      );
      code = sub?.subscription_code;
      token = sub?.email_token;
    }
    if (!code || !token) {
      res.status(502).json({ error: 'Couldn’t find your subscription. Try again in a minute.' });
      return;
    }

    await disableSubscription(code, token);
    plus.autoRenew = false;
    plus.paystackSubscriptionCode = code;
    plus.paystackEmailToken = token;
    await plus.save();

    res.json(await entitlements(userId));
  } catch (error) {
    console.error('Cancel Plus error:', error);
    res.status(502).json({ error: 'Couldn’t cancel right now. Try again.' });
  }
};
