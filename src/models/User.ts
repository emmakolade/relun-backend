import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email?: string;
  phone?: string;
  fullName?: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female';
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastActive?: Date;
  otpCode?: string;
  otpExpiry?: Date;
  otpAttempts?: number;
  coins: number;
  insightsUntil?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, unique: true, sparse: true, lowercase: true },
    phone: { type: String, unique: true, sparse: true },
    fullName: { type: String },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['male', 'female'] },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    lastActive: { type: Date },
    // Never returned unless asked for with select('+otpCode ...').
    otpCode: { type: String, select: false },
    otpExpiry: { type: Date, select: false },
    otpAttempts: { type: Number, select: false },
    // Coin balance. Only ever changed through services/wallet.service so every
    // change has a matching CoinTransaction row.
    coins: { type: Number, default: 0, min: 0 },
    // Who-liked-you / profile-views access is paid for in 30-day blocks.
    insightsUntil: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

// Admin stats: sign-ups per day and active-user counts.
userSchema.index({ createdAt: -1 });
userSchema.index({ lastActive: -1 });

export const User = mongoose.model<IUser>('User', userSchema);
