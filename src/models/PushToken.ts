import mongoose, { Schema, Document, Types } from 'mongoose';

// 'expo' tokens come from the Expo app, 'fcm' tokens from the native Android app
// and from browsers (web push through Firebase Cloud Messaging).
export type PushProvider = 'expo' | 'fcm';

export interface IPushToken extends Document {
  userId: Types.ObjectId;
  token: string;
  platform?: 'ios' | 'android' | 'web';
  provider: PushProvider;
  createdAt: Date;
  updatedAt: Date;
}

const pushTokenSchema = new Schema<IPushToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Unique on the token, not on (user, token): a device handed to another
    // account must move rather than end up delivering to both.
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web'] },
    provider: { type: String, enum: ['expo', 'fcm'], default: 'expo' },
  },
  { timestamps: true }
);

// Expo tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx].
export const isExpoPushToken = (value: unknown): value is string =>
  typeof value === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value);

// FCM registration tokens are opaque; this only rejects obvious junk.
export const isFcmToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_:-]{100,4096}$/.test(value);

export const PushToken = mongoose.model<IPushToken>('PushToken', pushTokenSchema);
