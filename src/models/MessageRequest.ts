import mongoose, { Schema, Document, Types } from 'mongoose';

export type MessageRequestStatus = 'pending' | 'accepted' | 'declined';

/** free: the weekly free one. plus: one of Plus's monthly ones. coins: bought. */
export type MessageRequestPayment = 'free' | 'plus' | 'coins';

/**
 * A paid message to someone the sender hasn't matched with. The receiver
 * replying (or liking back) accepts it and makes the two a match; declining
 * stops the sender from writing again. At most one per pair, ever.
 */
export interface IMessageRequest extends Document {
  conversationId: string;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  status: MessageRequestStatus;
  paidWith: MessageRequestPayment;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageRequestSchema = new Schema<IMessageRequest>(
  {
    conversationId: { type: String, required: true, unique: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    paidWith: { type: String, enum: ['free', 'plus', 'coins'], default: 'coins' },
    respondedAt: Date,
  },
  { timestamps: true }
);

messageRequestSchema.index({ receiverId: 1, status: 1 });
// Counting the free and Plus requests a sender has used this period.
messageRequestSchema.index({ senderId: 1, paidWith: 1, createdAt: -1 });

export const MessageRequest = mongoose.model<IMessageRequest>('MessageRequest', messageRequestSchema);
