import { User } from '../models/User';
import { CoinTransaction, CoinReason } from '../models/CoinTransaction';

export class InsufficientCoinsError extends Error {
  constructor(
    public readonly required: number,
    public readonly balance: number
  ) {
    super('Not enough coins');
  }
}

type SpendParams = {
  userId: string;
  amount: number;
  reason: CoinReason;
  refId?: string;
};

/**
 * Takes coins atomically. The balance check and the decrement are one update,
 * so two taps on "Unlock" can never both succeed on a balance that covers one.
 */
export const spendCoins = async ({ userId, amount, reason, refId }: SpendParams) => {
  // A negative amount would pass the balance check and add coins.
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid coin amount');
  const user = await User.findOneAndUpdate(
    { _id: userId, coins: { $gte: amount } },
    { $inc: { coins: -amount } },
    { new: true }
  ).select('coins');

  if (!user) {
    const current = await User.findById(userId).select('coins').lean();
    throw new InsufficientCoinsError(amount, current?.coins ?? 0);
  }

  await CoinTransaction.create({
    userId,
    amount: -amount,
    balanceAfter: user.coins,
    reason,
    refId,
  });

  return user.coins;
};

type CreditParams = {
  userId: string;
  amount: number;
  reason: CoinReason;
  productId?: string;
  platform?: 'android' | 'ios' | 'web';
  purchaseToken?: string;
  refId?: string;
};

/**
 * Adds coins. When a purchase token is given, the transaction row is written
 * first: its unique index makes a replayed purchase fail before any coins move.
 * Returns null if this purchase token was already credited.
 */
export const creditCoins = async (params: CreditParams): Promise<number | null> => {
  // Only a refund of a store purchase may take coins back.
  if (!Number.isSafeInteger(params.amount) || (params.amount < 0 && !params.purchaseToken)) {
    throw new Error('Invalid coin amount');
  }
  let transactionId;

  try {
    const transaction = await CoinTransaction.create({ ...params, balanceAfter: 0 });
    transactionId = transaction._id;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return null;
    }
    throw error;
  }

  const user = await User.findByIdAndUpdate(
    params.userId,
    { $inc: { coins: params.amount } },
    { new: true }
  ).select('coins');

  const balance = user?.coins ?? 0;
  await CoinTransaction.updateOne({ _id: transactionId }, { balanceAfter: balance });

  return balance;
};

export const hasActiveInsights = (insightsUntil?: Date | null): boolean =>
  !!insightsUntil && insightsUntil.getTime() > Date.now();
