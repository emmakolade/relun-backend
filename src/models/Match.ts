import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMatch extends Document {
  user1Id: Types.ObjectId;
  user2Id: Types.ObjectId;
  isActive: boolean;
  unmatchedById?: Types.ObjectId;
  unmatchedAt?: Date;
}

const matchSchema = new Schema<IMatch>(
  {
    user1Id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    user2Id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    unmatchedById: { type: Schema.Types.ObjectId, ref: 'User' },
    unmatchedAt: Date,
  },
  { timestamps: true }
);

export const Match = mongoose.model<IMatch>('Match', matchSchema);
