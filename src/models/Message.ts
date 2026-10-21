import mongoose, { Schema, Document, Types } from 'mongoose';

export const MAX_MESSAGE_LENGTH = 5000;
export const MESSAGE_TYPES = ['text', 'image', 'video', 'audio'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface IMessage extends Document {
  conversationId: string;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  content: string;
  messageType: MessageType;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: String, required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, maxlength: MAX_MESSAGE_LENGTH },
    messageType: { type: String, enum: MESSAGE_TYPES, default: 'text' },
    isRead: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true }
);

// Paginating a conversation's history, newest first.
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Unread counts and mark-as-read. Without this, counting unread scans the collection.
messageSchema.index({ receiverId: 1, isRead: 1 });
// The $or in getConversations needs both branches indexed to avoid a collection scan.
messageSchema.index({ senderId: 1, createdAt: -1 });
// Admin stats: messages per day.
messageSchema.index({ createdAt: -1 });

// Helper function to generate a deterministic conversation ID from two user IDs
export const getConversationId = (userId1: string, userId2: string): string => {
  return [userId1, userId2].sort().join('_');
};

export const Message = mongoose.model<IMessage>('Message', messageSchema);
