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
    otpCode: { type: String },
    otpExpiry: { type: Date },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
