import mongoose, { Schema, Document, Types } from 'mongoose';

// chat_unlock is no longer charged (chats with matches are free) but stays for old rows.
export const COIN_REASONS = ['purchase', 'chat_unlock', 'insights', 'bonus', 'refund', 'message_request', 'date_post'] as const;
export type CoinReason = (typeof COIN_REASONS)[number];

export interface ICoinTransaction extends Document {
  userId: Types.ObjectId;
  // Positive for credits, negative for spends.
  amount: number;
  balanceAfter: number;
  reason: CoinReason;
  // What the coins were spent on, e.g. the other user's id for a chat unlock.
  refId?: string;
  productId?: string;
  platform?: 'android' | 'ios' | 'web';
  // Store purchase token. Unique so a retried purchase can never be credited twice.
  purchaseToken?: string;
  // Bonuses only: false until the app has shown the "you got coins" sheet.
  announced?: boolean;
  createdAt: Date;
}

const coinTransactionSchema = new Schema<ICoinTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, enum: COIN_REASONS, required: true },
    refId: String,
    productId: String,
    platform: { type: String, enum: ['android', 'ios', 'web'] },
    purchaseToken: { type: String, unique: true, sparse: true },
    announced: Boolean,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

coinTransactionSchema.index({ userId: 1, createdAt: -1 });
coinTransactionSchema.index({ userId: 1, announced: 1 }, { partialFilterExpression: { announced: false } });

export const CoinTransaction = mongoose.model<ICoinTransaction>(
  'CoinTransaction',
  coinTransactionSchema
);
