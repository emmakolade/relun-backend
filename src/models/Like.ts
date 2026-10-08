import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * like: tapped in the app, and counts toward the free daily limit. request and
 * date: made for the user by a message request or an accepted date, which don't.
 */
export type LikeSource = 'like' | 'request' | 'date';

export interface ILike extends Document {
  userId: Types.ObjectId;
  targetUserId: Types.ObjectId;
  source: LikeSource;
  createdAt: Date;
  updatedAt: Date;
}

const likeSchema = new Schema<ILike>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: { type: String, enum: ['like', 'request', 'date'], default: 'like' },
  },
  { timestamps: true }
);

likeSchema.index({ userId: 1, targetUserId: 1 }, { unique: true });
// Counting today's likes for the daily limit.
likeSchema.index({ userId: 1, createdAt: -1 });

export const Like = mongoose.model<ILike>('Like', likeSchema);

// Two users are matched when both have liked each other. Chat is gated on this:
// without it, any authenticated user could message any userId they can guess.
export const isMatched = async (userId1: string, userId2: string): Promise<boolean> => {
  if (userId1 === userId2) return false;

  const mutualLikes = await Like.countDocuments({
    $or: [
      { userId: userId1, targetUserId: userId2 },
      { userId: userId2, targetUserId: userId1 },
    ],
  });

  return mutualLikes === 2;
};

// Every user this user has matched with, in two indexed queries rather than
// one per candidate.
export const getMatchedUserIds = async (userId: string): Promise<string[]> => {
  const [liked, likedBy] = await Promise.all([
    Like.find({ userId }).select('targetUserId').lean(),
    Like.find({ targetUserId: userId }).select('userId').lean(),
  ]);

  const likedIds = new Set(liked.map((like) => like.targetUserId.toString()));

  return likedBy.map((like) => like.userId.toString()).filter((id) => likedIds.has(id));
};
