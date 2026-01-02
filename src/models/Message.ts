import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  matchId: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  content: string;
  isRead: boolean;
  readAt?: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true }
);

export const Message = mongoose.model<IMessage>('Message', messageSchema);
