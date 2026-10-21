import mongoose, { Schema, Document, Types } from 'mongoose';
import type { PlusPlanId } from '../config/coins';

/**
 * paystack: an auto-renewing Paystack subscription. paystack_pass: a one-time
 * week or month paid by card, transfer or USSD. play: a Google Play subscription.
 */
export type PlusSource = 'paystack' | 'paystack_pass' | 'play';

/** A user's Relun Plus. One row per user; active while `until` is in the future. */
export interface IPlus extends Document {
  userId: Types.ObjectId;
  plan: PlusPlanId;
  source: PlusSource;
  until: Date;
  // Whether it renews by itself. A cancelled plan keeps working until `until`.
  autoRenew: boolean;
  paystackCustomerCode?: string;
  paystackSubscriptionCode?: string;
  // Paystack needs this alongside the code to cancel a subscription.
  paystackEmailToken?: string;
  playPurchaseToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const plusSchema = new Schema<IPlus>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    plan: { type: String, enum: ['weekly', 'monthly'], required: true },
    source: { type: String, enum: ['paystack', 'paystack_pass', 'play'], required: true },
    until: { type: Date, required: true },
    autoRenew: { type: Boolean, default: false },
    paystackCustomerCode: { type: String, index: true, sparse: true },
    paystackSubscriptionCode: String,
    paystackEmailToken: String,
    // Unique so one Play subscription can never give Plus to two accounts.
    playPurchaseToken: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

export const Plus = mongoose.model<IPlus>('Plus', plusSchema);

/**
 * Every Paystack charge that paid for Plus, first or renewal. The unique
 * reference makes a charge seen twice (app and webhook) extend Plus once.
 */
export interface IPlusPayment extends Document {
  reference: string;
  userId: Types.ObjectId;
  plan: PlusPlanId;
  source: PlusSource;
  amount: number;
  currency: string;
  // Set once when Paystack refunds the charge, so the refund is taken back once.
  refundedAt?: Date;
  createdAt: Date;
}

const plusPaymentSchema = new Schema<IPlusPayment>(
  {
    reference: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: ['weekly', 'monthly'], required: true },
    source: { type: String, enum: ['paystack', 'paystack_pass', 'play'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    refundedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const PlusPayment = mongoose.model<IPlusPayment>('PlusPayment', plusPaymentSchema);
