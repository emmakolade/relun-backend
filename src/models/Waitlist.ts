import mongoose, { Schema, Document } from 'mongoose';

export const WAITLIST_PLATFORMS = ['android', 'ios'] as const;
export type WaitlistPlatform = (typeof WAITLIST_PLATFORMS)[number];

/** Someone who asked to hear when the native apps launch, from relun.chat. */
export interface IWaitlist extends Document {
  email: string;
  platform?: WaitlistPlatform;
  /** The page they signed up on, e.g. "/" or "/pricing". */
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

const waitlistSchema = new Schema<IWaitlist>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    platform: { type: String, enum: WAITLIST_PLATFORMS },
    source: { type: String, maxlength: 100 },
  },
  { timestamps: true }
);

export const Waitlist = mongoose.model<IWaitlist>('Waitlist', waitlistSchema);
