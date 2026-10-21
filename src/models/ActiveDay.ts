import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * One row per user per (Lagos) day they used the app. Feeds the daily active
 * users numbers on the admin page; rows expire after 400 days.
 */
export interface IActiveDay extends Document {
  day: string; // YYYY-MM-DD
  userId: Types.ObjectId;
  createdAt: Date;
}

const activeDaySchema = new Schema<IActiveDay>(
  {
    day: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activeDaySchema.index({ day: 1, userId: 1 }, { unique: true });
activeDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export const ActiveDay = mongoose.model<IActiveDay>('ActiveDay', activeDaySchema);
