import crypto from 'crypto';
import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { CoinTransaction } from '../models/CoinTransaction';
import { COIN_COSTS, COIN_PACKAGES, SIGNUP_BONUS_REF, findPackageByProductId } from '../config/coins';
import { spendCoins, creditCoins, hasActiveInsights, InsufficientCoinsError } from '../services/wallet.service';
import { canSeeInsights } from '../services/plus.service';
import { notifyCoinsAdded } from '../services/push.service';
import { entitlements, handlePlusWebhook } from './plus.controller';
import { verifyPlayPurchase } from '../services/playBilling.service';
import {
  initializeTransaction,
  isPaystackConfigured,
  isValidWebhookSignature,
  metadataOf,
  planCodeOf,
  verifyTransaction,
  PaystackTransaction,
} from '../services/paystack.service';

const insufficient = (res: Response, error: InsufficientCoinsError) =>
  res.status(402).json({
    error: 'Not enough coins',
    code: 'INSUFFICIENT_COINS',
    required: error.required,
    balance: error.balance,
  });

// GET /api/coins
export const getWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [user, bonus, insightsActive, plus] = await Promise.all([
      User.findById(userId).select('coins insightsUntil').lean(),
      CoinTransaction.findOne({ userId, reason: 'bonus', announced: false })
        .sort({ createdAt: 1 })
        .select('amount refId')
        .lean(),
      canSeeInsights(userId),
      entitlements(userId),
    ]);

    res.json({
      balance: user?.coins ?? 0,
      // Likes & Views, from a coin pass or from Plus.
      insightsActive,
      insightsUntil: user?.insightsUntil ?? null,
      costs: COIN_COSTS,
      packages: COIN_PACKAGES,
      ...plus,
      // A bonus the user hasn't been told about yet; the app shows it once.
      pendingBonus: bonus
        ? {
            id: bonus._id,
            coins: bonus.amount,
            kind: bonus.refId === SIGNUP_BONUS_REF ? 'signup' : 'gift',
          }
        : null,
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ error: 'Failed to load coins' });
  }
};

// GET /api/coins/transactions
export const getTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const transactions = await CoinTransaction.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-purchaseToken')
      .lean();

    res.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
};

// POST /api/coins/purchases { productId, purchaseToken, platform }
export const confirmPurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { productId, purchaseToken, platform = 'android' } = req.body;
    const pkg = findPackageByProductId(productId);

    if (!pkg) {
      res.status(400).json({ error: 'Unknown product' });
      return;
    }

    if (platform !== 'android') {
      res.status(400).json({ error: 'Only Google Play purchases are supported for now' });
      return;
    }

    const verification = await verifyPlayPurchase(productId, purchaseToken);

    if (!verification.ok) {
      res.status(402).json({ error: verification.reason, code: 'PURCHASE_NOT_VERIFIED' });
      return;
    }

    const balance = await creditCoins({
      userId: req.user!.id,
      amount: pkg.coins,
      reason: 'purchase',
      productId,
      platform,
      purchaseToken,
      refId: verification.orderId,
    });

    if (balance === null) {
      // Already credited. Answer like a success so a client retry after a
      // dropped response still consumes the purchase and moves on.
      const existing = await CoinTransaction.findOne({ purchaseToken }).select('userId').lean();

      if (existing && existing.userId.toString() !== req.user!.id) {
        res.status(409).json({ error: 'This purchase belongs to another account' });
        return;
      }

      const user = await User.findById(req.user!.id).select('coins').lean();
      res.json({ credited: 0, balance: user?.coins ?? 0, alreadyProcessed: true });
      return;
    }

    void notifyCoinsAdded({ userId: req.user!.id, coins: pkg.coins });
    res.status(201).json({ credited: pkg.coins, balance, alreadyProcessed: false });
  } catch (error) {
    console.error('Confirm purchase error:', error);
    res.status(500).json({ error: 'Failed to confirm purchase' });
  }
};

// ---------- Paystack (web) ----------

const paystackToken = (reference: string) => `paystack:${reference}`;

type PaystackCredit =
  | { ok: true; credited: number; balance: number; alreadyProcessed: boolean }
  | { ok: false; status: number; error: string };

/**
 * Credits a verified Paystack charge once. Checks the amount and currency
 * against the package, so a tampered client can never buy 5000 coins for the
 * price of 100. The app and the webhook both land here; the unique purchase
 * token makes the second one a no-op.
 */
const creditPaystack = async (tx: PaystackTransaction): Promise<PaystackCredit> => {
  if (tx.status !== 'success') {
    return { ok: false, status: 402, error: 'Payment was not completed' };
  }

  const { userId, productId, kind } = metadataOf(tx);
  const pkg = typeof productId === 'string' ? findPackageByProductId(productId) : undefined;

  // A Plus charge or subscription renewal is never also a coin purchase, even
  // if its metadata names a pack at the same price.
  if (typeof userId !== 'string' || !pkg || kind === 'plus' || planCodeOf(tx)) {
    return { ok: false, status: 400, error: 'Unknown purchase' };
  }
  if (tx.amount !== pkg.paystackAmount || tx.currency !== pkg.paystackCurrency) {
    console.error('[paystack] Amount mismatch', tx.reference, tx.amount, tx.currency);
    return { ok: false, status: 402, error: 'Payment amount does not match' };
  }

  const balance = await creditCoins({
    userId,
    amount: pkg.coins,
    reason: 'purchase',
    productId: pkg.productId,
    platform: 'web',
    purchaseToken: paystackToken(tx.reference),
    refId: String(tx.id),
  });

  if (balance === null) {
    const user = await User.findById(userId).select('coins').lean();
    return { ok: true, credited: 0, balance: user?.coins ?? 0, alreadyProcessed: true };
  }
  void notifyCoinsAdded({ userId, coins: pkg.coins });
  return { ok: true, credited: pkg.coins, balance, alreadyProcessed: false };
};

// POST /api/coins/paystack/initialize { productId }
export const initializePaystack = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const pkg = findPackageByProductId(req.body.productId);
    if (!pkg) {
      res.status(400).json({ error: 'Unknown product' });
      return;
    }

    const userId = req.user!.id;
    const user = await User.findById(userId).select('email').lean();
    // Paystack requires an email; phone-only accounts get a stable placeholder.
    const email = user?.email || `${userId}@users.relun.app`;
    const reference = `relun_${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const tx = await initializeTransaction({
      email,
      amount: pkg.paystackAmount,
      currency: pkg.paystackCurrency,
      reference,
      metadata: { userId, productId: pkg.productId },
    });

    res.status(201).json({
      reference: tx.reference,
      accessCode: tx.access_code,
      authorizationUrl: tx.authorization_url,
    });
  } catch (error) {
    console.error('Paystack initialize error:', error);
    res.status(502).json({ error: 'Couldn’t start the payment. Try again.' });
  }
};

// POST /api/coins/paystack/verify { reference }
export const verifyPaystack = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const result = await creditPaystack(tx);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: 'PURCHASE_NOT_VERIFIED' });
      return;
    }

    res.status(result.alreadyProcessed ? 200 : 201).json({
      credited: result.credited,
      balance: result.balance,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    console.error('Paystack verify error:', error);
    res.status(502).json({ error: 'Couldn’t confirm the payment yet. Try again.' });
  }
};

/**
 * Takes back the coins of a refunded Paystack charge, once. The balance may go
 * below zero if they were already spent, which blocks further spending.
 */
const revokePaystackCoins = async (reference: string) => {
  const purchase = await CoinTransaction.findOne({ purchaseToken: paystackToken(reference) })
    .select('userId amount productId')
    .lean();
  if (!purchase || purchase.amount <= 0) return;

  await creditCoins({
    userId: purchase.userId.toString(),
    amount: -purchase.amount,
    reason: 'refund',
    productId: purchase.productId,
    platform: 'web',
    purchaseToken: `paystack-refund:${reference}`,
    refId: reference,
  });
};

// POST /api/coins/paystack/webhook (called by Paystack, not the app)
export const paystackWebhook = async (req: Request, res: Response): Promise<void> => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!isValidWebhookSignature(raw, req.header('x-paystack-signature'))) {
    res.sendStatus(401);
    return;
  }

  // Acknowledge right away; Paystack retries anything slower than a few seconds.
  res.sendStatus(200);

  try {
    const event = req.body as { event?: string; data?: { reference?: string; transaction_reference?: string } };
    // Plus charges, renewals, refunds and subscription changes.
    if (await handlePlusWebhook(event)) return;

    if (event.event === 'refund.processed' && event.data?.transaction_reference) {
      await revokePaystackCoins(String(event.data.transaction_reference));
      return;
    }
    if (event.event !== 'charge.success' || !event.data?.reference) return;

    // Re-fetch rather than trusting the payload's amount.
    const tx = await verifyTransaction(event.data.reference);
    const result = await creditPaystack(tx);
    if (!result.ok) console.warn('[paystack] Webhook not credited:', result.error, tx.reference);
  } catch (error) {
    console.error('Paystack webhook error:', error);
  }
};

// POST /api/coins/bonus/:id/seen
export const markBonusSeen = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: 'Invalid bonus id' });
      return;
    }
    await CoinTransaction.updateOne(
      { _id: req.params.id, userId: req.user!.id, reason: 'bonus' },
      { announced: true }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark bonus seen error:', error);
    res.status(500).json({ error: 'Failed to update' });
  }
};

// POST /api/coins/insights { days: 7 | 30 }
// Likes & Views for coins, for people who'd rather not subscribe to Plus.
export const buyInsights = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const days = Number(req.body?.days) === 7 ? 7 : 30;
    const balance = await spendCoins({
      userId,
      amount: days === 7 ? COIN_COSTS.insights7 : COIN_COSTS.insights30,
      reason: 'insights',
      refId: `${days}d`,
    });

    // Extends from whichever is later, now or the current expiry, so buying
    // early never wastes remaining days.
    const user = await User.findById(userId).select('insightsUntil');
    const start = hasActiveInsights(user?.insightsUntil) ? user!.insightsUntil! : new Date();
    const insightsUntil = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

    await User.updateOne({ _id: userId }, { insightsUntil });

    res.status(201).json({ insightsActive: true, insightsUntil, balance });
  } catch (error) {
    if (error instanceof InsufficientCoinsError) {
      insufficient(res, error);
      return;
    }
    console.error('Buy insights error:', error);
    res.status(500).json({ error: 'Failed to unlock insights' });
  }
};
