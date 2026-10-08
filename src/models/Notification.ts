import mongoose, { Schema, Document, Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'match',
  'like',
  'view',
  'message_request',
  'date_request',
  'date_accepted',
  'plus',
  'coins',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The in-app notification list behind the bell. Chat messages aren't here;
 * they have their own badge on the Messages tab.
 */
export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  // The other person, if any. Hidden for likes and views without Likes & Views.
  actorId?: Types.ObjectId;
  title: string;
  body: string;
  // Where a tap goes, e.g. { userId } or { dateId }.
  data?: Record<string, string>;
  readAt?: Date;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
// Old notifications clean themselves up after 60 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
