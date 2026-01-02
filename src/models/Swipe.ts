import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISwipe extends Document {
  userId: Types.ObjectId;
  targetUserId: Types.ObjectId;
  swipeType: 'like' | 'pass' | 'super_like';
}

const swipeSchema = new Schema<ISwipe>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    swipeType: { type: String, enum: ['like', 'pass', 'super_like'], required: true },
  },
  { timestamps: true }
);

swipeSchema.index({ userId: 1, targetUserId: 1 }, { unique: true });

export const Swipe = mongoose.model<ISwipe>('Swipe', swipeSchema);
